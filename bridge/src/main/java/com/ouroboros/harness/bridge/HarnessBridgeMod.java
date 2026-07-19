package com.ouroboros.harness.bridge;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.HashMap;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.Callable;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import net.fabricmc.api.ModInitializer;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerLifecycleEvents;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerTickEvents;
import net.fabricmc.fabric.api.networking.v1.ServerPlayConnectionEvents;
import net.fabricmc.fabric.api.util.TriState;
import net.fabricmc.loader.api.FabricLoader;
import net.fabricmc.loader.api.ModContainer;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.resources.Identifier;
import net.minecraft.server.MinecraftServer;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.Container;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.effect.MobEffectInstance;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/** Fabric entrypoint for the authenticated, loopback-only test bridge. */
public final class HarnessBridgeMod implements ModInitializer {
    public static final String MOD_ID = "ouro_harness_bridge";
    private static final Logger LOGGER = LoggerFactory.getLogger(MOD_ID);
    private static final Gson GSON = new GsonBuilder().disableHtmlEscaping().create();
    private static final int MAX_REQUEST_BODY_BYTES = 1_048_576;

    private final HarnessMetrics metrics = new HarnessMetrics();
    private final HarnessPermissions permissions = new HarnessPermissions();
    private volatile MinecraftServer minecraftServer;
    private volatile HttpServer httpServer;
    private String token;
    private Path eventsPath;

    @Override
    public void onInitialize() {
        token = requiredEnvironment("OURO_HARNESS_TOKEN");
        int port = parsePort(requiredEnvironment("OURO_HARNESS_PORT"));
        String eventValue = System.getenv("OURO_HARNESS_EVENTS");
        eventsPath = eventValue == null || eventValue.isBlank() ? null : Path.of(eventValue).toAbsolutePath();

        permissions.register();
        ServerTickEvents.START_SERVER_TICK.register(ignored -> metrics.startTick());
        ServerTickEvents.END_SERVER_TICK.register(ignored -> metrics.endTick());
        ServerPlayConnectionEvents.JOIN.register((handler, sender, server) ->
                event("player_join", object("name", handler.player.getName().getString(), "uuid", handler.player.getUUID().toString())));
        ServerPlayConnectionEvents.DISCONNECT.register((handler, server) ->
                event("player_disconnect", object("name", handler.player.getName().getString(), "uuid", handler.player.getUUID().toString())));
        ServerLifecycleEvents.SERVER_STARTED.register(server -> start(server, port));
        ServerLifecycleEvents.SERVER_STOPPING.register(server -> stop());
    }

    private void start(MinecraftServer server, int port) {
        minecraftServer = server;
        try {
            HttpServer created = HttpServer.create(new InetSocketAddress("127.0.0.1", port), 0);
            created.createContext("/", this::handle);
            created.setExecutor(Executors.newVirtualThreadPerTaskExecutor());
            created.start();
            httpServer = created;
            event("bridge_ready", object("port", port));
            LOGGER.info("OURO_HARNESS_BRIDGE_READY port={}", port);
        } catch (IOException exception) {
            throw new IllegalStateException("Unable to start harness bridge on loopback port " + port, exception);
        }
    }

    private void stop() {
        HttpServer current = httpServer;
        httpServer = null;
        if (current != null) current.stop(0);
        minecraftServer = null;
        HarnessAdapters.clear();
    }

    private void handle(HttpExchange exchange) throws IOException {
        try {
            if (!authorized(exchange)) {
                send(exchange, 401, error("unauthorized", "A valid bearer token is required"));
                return;
            }
            URI uri = exchange.getRequestURI();
            String path = uri.getPath();
            String method = exchange.getRequestMethod();
            Map<String, String> query = query(uri.getRawQuery());
            JsonObject body = readBody(exchange);

            JsonElement response;
            if (method.equals("GET") && path.equals("/v1/health")) response = health();
            else if (method.equals("GET") && path.equals("/v1/metrics")) response = metrics();
            else if (method.equals("GET") && path.equals("/v1/mods")) response = mods();
            else if (method.equals("GET") && path.equals("/v1/players")) response = onServer(this::players);
            else if (method.equals("GET") && path.equals("/v1/player/state")) response = onServer(() -> playerState(required(query, "name")));
            else if (method.equals("PUT") && path.equals("/v1/player/inventory")) response = onServer(() -> setInventory(body));
            else if (method.equals("POST") && path.equals("/v1/command")) response = onServer(() -> command(body));
            else if (method.equals("GET") && path.equals("/v1/world/block")) response = onServer(() -> block(query));
            else if (method.equals("POST") && path.equals("/v1/world/block")) response = onServer(() -> setBlock(body));
            else if (method.equals("POST") && path.equals("/v1/player/damage")) response = onServer(() -> damage(body));
            else if (method.equals("POST") && path.equals("/v1/permissions")) response = onServer(() -> setPermission(body));
            else if (method.equals("GET") && path.equals("/v1/entities")) response = onServer(() -> entities(query));
            else if (method.equals("GET") && path.equals("/v1/block-entity")) response = onServer(() -> blockEntity(query));
            else if (method.equals("POST") && path.equals("/v1/ticks/wait")) response = waitTicks(body);
            else if (method.equals("POST") && path.startsWith("/v1/adapters/")) response = adapter(path, body);
            else {
                send(exchange, 404, error("not_found", method + " " + path));
                return;
            }
            send(exchange, 200, response);
        } catch (PayloadTooLargeException exception) {
            sendSafely(exchange, 413, error("payload_too_large", exception.getMessage()));
        } catch (IllegalArgumentException exception) {
            sendSafely(exchange, 400, error("bad_request", exception.getMessage()));
        } catch (Exception exception) {
            LOGGER.error("Harness bridge request failed", exception);
            sendSafely(exchange, 500, error("internal_error", exception.toString()));
        } finally {
            exchange.close();
        }
    }

    private JsonObject health() {
        JsonObject value = object(
                "status", minecraftServer == null ? "starting" : "ready",
                "minecraft", "26.2",
                "ticks", metrics.ticks());
        value.addProperty("serverThread", minecraftServer != null && minecraftServer.isSameThread());
        return value;
    }

    private JsonObject metrics() {
        MinecraftServer server = requireServer();
        return metrics.snapshot(server.getPlayerList().getPlayerCount());
    }

    private JsonObject mods() {
        JsonObject result = new JsonObject();
        for (ModContainer container : FabricLoader.getInstance().getAllMods()) {
            String id = container.getMetadata().getId();
            result.add(id, object(
                    "id", id,
                    "name", container.getMetadata().getName(),
                    "version", container.getMetadata().getVersion().getFriendlyString()));
        }
        return result;
    }

    private JsonArray players() {
        JsonArray result = new JsonArray();
        for (ServerPlayer player : requireServer().getPlayerList().getPlayers()) result.add(playerState(player));
        return result;
    }

    private JsonObject playerState(String name) {
        ServerPlayer player = findPlayer(name);
        return playerState(player);
    }

    private JsonObject playerState(ServerPlayer player) {
        JsonObject result = object(
                "name", player.getName().getString(),
                "uuid", player.getUUID().toString(),
                "health", player.getHealth(),
                "gameMode", player.gameMode.getGameModeForPlayer().getName(),
                "dimension", player.level().dimension().identifier().toString(),
                "x", player.getX(),
                "y", player.getY(),
                "z", player.getZ(),
                "experienceLevel", player.experienceLevel,
                "experienceProgress", player.experienceProgress,
                "totalExperience", player.totalExperience,
                "deadOrDying", player.isDeadOrDying());
        JsonArray inventory = new JsonArray();
        Container container = player.getInventory();
        for (int slot = 0; slot < container.getContainerSize(); slot++) {
            ItemStack stack = container.getItem(slot);
            JsonObject item = object("slot", slot, "empty", stack.isEmpty());
            if (!stack.isEmpty()) {
                item.addProperty("item", BuiltInRegistries.ITEM.getKey(stack.getItem()).toString());
                item.addProperty("count", stack.getCount());
                item.addProperty("components", stack.getComponents().toString());
            }
            inventory.add(item);
        }
        result.add("inventory", inventory);
        JsonArray effects = new JsonArray();
        for (MobEffectInstance effect : player.getActiveEffects()) {
            effects.add(object(
                    "id", effect.getEffect().unwrapKey()
                            .map(key -> key.identifier().toString())
                            .orElse("unknown"),
                    "amplifier", effect.getAmplifier(),
                    "durationTicks", effect.getDuration(),
                    "ambient", effect.isAmbient(),
                    "visible", effect.isVisible()));
        }
        result.add("effects", effects);
        return result;
    }

    private JsonObject setInventory(JsonObject body) {
        ServerPlayer player = findPlayer(requiredString(body, "player"));
        int slot = requiredInt(body, "slot");
        Container inventory = player.getInventory();
        if (slot < 0 || slot >= inventory.getContainerSize()) {
            throw new IllegalArgumentException("slot must be between 0 and " + (inventory.getContainerSize() - 1));
        }
        String itemId = optionalString(body, "item").orElse("minecraft:air");
        int count = body.has("count") ? body.get("count").getAsInt() : 1;
        Identifier id = Identifier.tryParse(itemId);
        if (id == null || !BuiltInRegistries.ITEM.containsKey(id)) throw new IllegalArgumentException("unknown item: " + itemId);
        Item item = BuiltInRegistries.ITEM.getValue(id);
        ItemStack stack = itemId.equals("minecraft:air") || count == 0 ? ItemStack.EMPTY : new ItemStack(item, count);
        if (body.has("customData") && body.get("customData").isJsonObject() && !stack.isEmpty()) {
            CompoundTag tag = compound(body.getAsJsonObject("customData"));
            stack.set(net.minecraft.core.component.DataComponents.CUSTOM_DATA,
                    net.minecraft.world.item.component.CustomData.of(tag));
        }
        if (body.has("bundle") && body.get("bundle").isJsonArray() && !stack.isEmpty()) {
            java.util.List<net.minecraft.world.item.ItemStackTemplate> contents = new java.util.ArrayList<>();
            for (JsonElement element : body.getAsJsonArray("bundle")) {
                if (!element.isJsonObject()) throw new IllegalArgumentException("bundle entries must be objects");
                JsonObject nested = element.getAsJsonObject();
                String nestedId = requiredString(nested, "item");
                Identifier nestedIdentifier = Identifier.tryParse(nestedId);
                if (nestedIdentifier == null || !BuiltInRegistries.ITEM.containsKey(nestedIdentifier)) {
                    throw new IllegalArgumentException("unknown nested bundle item: " + nestedId);
                }
                ItemStack nestedStack = new ItemStack(
                        BuiltInRegistries.ITEM.getValue(nestedIdentifier),
                        nested.has("count") ? nested.get("count").getAsInt() : 1);
                if (nested.has("customData") && nested.get("customData").isJsonObject()) {
                    nestedStack.set(net.minecraft.core.component.DataComponents.CUSTOM_DATA,
                            net.minecraft.world.item.component.CustomData.of(compound(nested.getAsJsonObject("customData"))));
                }
                contents.add(net.minecraft.world.item.ItemStackTemplate.fromNonEmptyStack(nestedStack));
            }
            stack.set(net.minecraft.core.component.DataComponents.BUNDLE_CONTENTS,
                    new net.minecraft.world.item.component.BundleContents(contents));
        }
        inventory.setItem(slot, stack);
        player.inventoryMenu.broadcastChanges();
        event("inventory_set", object("player", player.getName().getString(), "slot", slot, "item", itemId, "count", count));
        return object("ok", true, "state", playerState(player));
    }

    private JsonObject command(JsonObject body) {
        String value = requiredString(body, "command").replaceFirst("^/", "");
        String actor = optionalString(body, "actor").orElse(null);
        CommandSourceStack source;
        if (actor == null || actor.equals("console")) {
            source = requireServer().createCommandSourceStack();
        } else {
            source = findPlayer(actor).createCommandSourceStack();
        }
        var parsed = requireServer().getCommands().getDispatcher().parse(value, source);
        requireServer().getCommands().performCommand(parsed, value);
        event("command", object("actor", actor == null ? "console" : actor, "command", value));
        return object("ok", true, "command", value);
    }

    private JsonObject setBlock(JsonObject body) {
        String block = requiredString(body, "block");
        int x = requiredInt(body, "x");
        int y = requiredInt(body, "y");
        int z = requiredInt(body, "z");
        return command(object("command", "setblock " + x + " " + y + " " + z + " " + block));
    }

    private JsonObject block(Map<String, String> query) {
        int x = Integer.parseInt(required(query, "x"));
        int y = Integer.parseInt(required(query, "y"));
        int z = Integer.parseInt(required(query, "z"));
        String dimension = query.getOrDefault("dimension", "minecraft:overworld");
        ServerLevel level = null;
        for (ServerLevel candidate : requireServer().getAllLevels()) {
            if (candidate.dimension().identifier().toString().equals(dimension)) level = candidate;
        }
        if (level == null) throw new IllegalArgumentException("unknown dimension: " + dimension);
        var state = level.getBlockState(new net.minecraft.core.BlockPos(x, y, z));
        return object(
                "block", BuiltInRegistries.BLOCK.getKey(state.getBlock()).toString(),
                "state", state.toString(),
                "dimension", dimension,
                "x", x,
                "y", y,
                "z", z);
    }

    private JsonObject damage(JsonObject body) {
        String player = requiredString(body, "player");
        double amount = body.has("amount") ? body.get("amount").getAsDouble() : 1000.0;
        String type = optionalString(body, "type").orElse("generic");
        String by = optionalString(body, "by").orElse(null);
        String command = "damage " + player + " " + amount + " " + type;
        if (by != null) command += " by " + by;
        return command(object("command", command));
    }

    private JsonObject setPermission(JsonObject body) {
        ServerPlayer player = findPlayer(requiredString(body, "player"));
        String permission = requiredString(body, "permission");
        TriState decision = switch (requiredString(body, "decision").toLowerCase()) {
            case "allow", "true" -> TriState.TRUE;
            case "deny", "false" -> TriState.FALSE;
            case "default", "unset" -> TriState.DEFAULT;
            default -> throw new IllegalArgumentException("decision must be allow, deny, or default");
        };
        permissions.set(player.getUUID(), permission, decision);
        return object("ok", true, "player", player.getName().getString(), "permission", permission, "decision", decision.name());
    }

    private JsonArray entities(Map<String, String> query) {
        String type = query.get("type");
        String dimension = query.get("dimension");
        JsonArray result = new JsonArray();
        for (ServerLevel level : requireServer().getAllLevels()) {
            if (dimension != null && !level.dimension().identifier().toString().equals(dimension)) continue;
            for (Entity entity : level.getAllEntities()) {
                String id = BuiltInRegistries.ENTITY_TYPE.getKey(entity.getType()).toString();
                if (type != null && !type.equals(id)) continue;
                result.add(object(
                        "uuid", entity.getUUID().toString(),
                        "type", id,
                        "dimension", level.dimension().identifier().toString(),
                        "x", entity.getX(),
                        "y", entity.getY(),
                        "z", entity.getZ(),
                        "removed", entity.isRemoved()));
            }
        }
        return result;
    }

    private JsonObject blockEntity(Map<String, String> query) {
        int x = Integer.parseInt(required(query, "x"));
        int y = Integer.parseInt(required(query, "y"));
        int z = Integer.parseInt(required(query, "z"));
        String dimension = query.getOrDefault("dimension", "minecraft:overworld");
        ServerLevel level = null;
        for (ServerLevel candidate : requireServer().getAllLevels()) {
            if (candidate.dimension().identifier().toString().equals(dimension)) level = candidate;
        }
        if (level == null) throw new IllegalArgumentException("unknown dimension: " + dimension);
        var blockEntity = level.getBlockEntity(new net.minecraft.core.BlockPos(x, y, z));
        if (blockEntity == null) throw new IllegalArgumentException("no block entity at " + x + "," + y + "," + z);
        CompoundTag tag = blockEntity.saveWithFullMetadata(requireServer().registryAccess());
        return object(
                "type", BuiltInRegistries.BLOCK_ENTITY_TYPE.getKey(blockEntity.getType()).toString(),
                "snbt", tag.toString());
    }

    private JsonObject waitTicks(JsonObject body) throws InterruptedException {
        int count = requiredInt(body, "ticks");
        if (count < 0 || count > 72_000) throw new IllegalArgumentException("ticks must be between 0 and 72000");
        long target = metrics.ticks() + count;
        if (!metrics.await(target, Math.max(15_000, count * 250L))) throw new IllegalArgumentException("tick wait timed out");
        return object("ok", true, "target", target, "ticks", metrics.ticks());
    }

    private JsonElement adapter(String path, JsonObject body) throws Exception {
        String[] parts = path.substring("/v1/adapters/".length()).split("/", 2);
        if (parts.length != 2 || parts[0].isBlank() || parts[1].isBlank()) {
            throw new IllegalArgumentException("adapter path must include id and operation");
        }
        HarnessAdapter adapter = HarnessAdapters.find(parts[0])
                .orElseThrow(() -> new IllegalArgumentException("adapter is not installed: " + parts[0]));
        return onServer(() -> adapter.invoke(requireServer(), parts[1], body));
    }

    private <T> T onServer(Callable<T> task) throws Exception {
        MinecraftServer server = requireServer();
        if (server.isSameThread()) return task.call();
        CompletableFuture<T> future = new CompletableFuture<>();
        server.execute(() -> {
            try {
                future.complete(task.call());
            } catch (Throwable error) {
                future.completeExceptionally(error);
            }
        });
        return future.get(15, TimeUnit.SECONDS);
    }

    private ServerPlayer findPlayer(String name) {
        ServerPlayer player = requireServer().getPlayerList().getPlayerByName(name);
        if (player == null) throw new IllegalArgumentException("player is not online: " + name);
        return player;
    }

    private MinecraftServer requireServer() {
        MinecraftServer server = minecraftServer;
        if (server == null) throw new IllegalStateException("Minecraft server is not ready");
        return server;
    }

    private boolean authorized(HttpExchange exchange) {
        String header = exchange.getRequestHeaders().getFirst("Authorization");
        if (header == null || !header.startsWith("Bearer ")) return false;
        return MessageDigest.isEqual(token.getBytes(StandardCharsets.UTF_8),
                header.substring("Bearer ".length()).getBytes(StandardCharsets.UTF_8));
    }

    private JsonObject readBody(HttpExchange exchange) throws IOException {
        byte[] value = exchange.getRequestBody().readNBytes(MAX_REQUEST_BODY_BYTES + 1);
        if (value.length > MAX_REQUEST_BODY_BYTES) {
            throw new PayloadTooLargeException("request body exceeds " + MAX_REQUEST_BODY_BYTES + " bytes");
        }
        if (value.length == 0) return new JsonObject();
        JsonElement parsed = JsonParser.parseString(new String(value, StandardCharsets.UTF_8));
        if (!parsed.isJsonObject()) throw new IllegalArgumentException("request body must be a JSON object");
        return parsed.getAsJsonObject();
    }

    private void send(HttpExchange exchange, int status, JsonElement value) throws IOException {
        byte[] bytes = GSON.toJson(value).getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().set("Content-Type", "application/json; charset=utf-8");
        exchange.getResponseHeaders().set("Cache-Control", "no-store");
        exchange.sendResponseHeaders(status, bytes.length);
        try (OutputStream output = exchange.getResponseBody()) {
            output.write(bytes);
        }
    }

    private void sendSafely(HttpExchange exchange, int status, JsonElement value) {
        try {
            send(exchange, status, value);
        } catch (IOException ignored) {
            // The client may have disconnected after the server-side operation failed.
        }
    }

    private static final class PayloadTooLargeException extends IllegalArgumentException {
        private PayloadTooLargeException(String message) {
            super(message);
        }
    }

    private void event(String type, JsonObject data) {
        data.addProperty("type", type);
        data.addProperty("at", Instant.now().toString());
        Path path = eventsPath;
        if (path == null) return;
        synchronized (this) {
            try {
                Files.createDirectories(path.getParent());
                Files.writeString(path, GSON.toJson(data) + System.lineSeparator(), StandardCharsets.UTF_8,
                        StandardOpenOption.CREATE, StandardOpenOption.APPEND);
            } catch (IOException exception) {
                LOGGER.warn("Unable to append harness event to {}", path, exception);
            }
        }
    }

    private static Map<String, String> query(String raw) {
        Map<String, String> result = new HashMap<>();
        if (raw == null || raw.isBlank()) return result;
        for (String pair : raw.split("&")) {
            String[] parts = pair.split("=", 2);
            String key = java.net.URLDecoder.decode(parts[0], StandardCharsets.UTF_8);
            String value = parts.length == 2 ? java.net.URLDecoder.decode(parts[1], StandardCharsets.UTF_8) : "";
            result.put(key, value);
        }
        return result;
    }

    private static String required(Map<String, String> values, String key) {
        String value = values.get(key);
        if (value == null || value.isBlank()) throw new IllegalArgumentException("missing query parameter: " + key);
        return value;
    }

    private static String requiredString(JsonObject object, String key) {
        if (!object.has(key) || !object.get(key).isJsonPrimitive()) throw new IllegalArgumentException("missing string field: " + key);
        return object.get(key).getAsString();
    }

    private static Optional<String> optionalString(JsonObject object, String key) {
        return object.has(key) && !object.get(key).isJsonNull() ? Optional.of(object.get(key).getAsString()) : Optional.empty();
    }

    private static int requiredInt(JsonObject object, String key) {
        if (!object.has(key)) throw new IllegalArgumentException("missing integer field: " + key);
        return object.get(key).getAsInt();
    }

    private static String requiredEnvironment(String key) {
        String value = System.getenv(key);
        if (value == null || value.isBlank()) throw new IllegalStateException(key + " must be set when the harness bridge is installed");
        return value;
    }

    private static int parsePort(String value) {
        int port = Integer.parseInt(value);
        if (port < 1 || port > 65535) throw new IllegalArgumentException("OURO_HARNESS_PORT is outside 1..65535");
        return port;
    }

    private static JsonObject object(Object... values) {
        JsonObject result = new JsonObject();
        for (int index = 0; index < values.length; index += 2) {
            String name = String.valueOf(values[index]);
            Object value = values[index + 1];
            if (value instanceof JsonElement json) result.add(name, json);
            else if (value instanceof Number number) result.addProperty(name, number);
            else if (value instanceof Boolean bool) result.addProperty(name, bool);
            else if (value == null) result.add(name, null);
            else result.addProperty(name, String.valueOf(value));
        }
        return result;
    }

    private static JsonObject error(String code, String message) {
        return object("error", code, "message", message == null ? code : message);
    }

    private static CompoundTag compound(JsonObject source) {
        CompoundTag result = new CompoundTag();
        for (Map.Entry<String, JsonElement> entry : source.entrySet()) {
            JsonElement value = entry.getValue();
            if (value.isJsonObject()) result.put(entry.getKey(), compound(value.getAsJsonObject()));
            else if (value.isJsonPrimitive() && value.getAsJsonPrimitive().isBoolean()) result.putBoolean(entry.getKey(), value.getAsBoolean());
            else if (value.isJsonPrimitive() && value.getAsJsonPrimitive().isNumber()) result.putDouble(entry.getKey(), value.getAsDouble());
            else result.putString(entry.getKey(), value.getAsString());
        }
        return result;
    }
}
