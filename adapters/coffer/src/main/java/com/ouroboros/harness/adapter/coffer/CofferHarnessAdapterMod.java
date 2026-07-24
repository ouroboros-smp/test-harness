package com.ouroboros.harness.adapter.coffer;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonNull;
import com.google.gson.JsonObject;
import com.mojang.serialization.JsonOps;
import com.ouroboros.coffer.api.CofferApi;
import com.ouroboros.coffer.core.AccessScope;
import com.ouroboros.coffer.core.ContainerPolicy;
import com.ouroboros.coffer.core.FlagType;
import com.ouroboros.coffer.core.LockType;
import com.ouroboros.coffer.core.OwnershipMode;
import com.ouroboros.coffer.fabric.CofferMod;
import com.ouroboros.coffer.fabric.interop.CofferInterop;
import com.ouroboros.coffer.fabric.storage.StoredLock;
import com.ouroboros.harness.bridge.HarnessAdapter;
import com.ouroboros.harness.bridge.HarnessAdapters;
import eu.pb4.common.protection.api.CommonProtection;
import net.fabricmc.api.ModInitializer;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerLifecycleEvents;
import net.fabricmc.loader.api.FabricLoader;
import net.minecraft.core.BlockPos;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.server.players.NameAndId;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.level.block.ChestBlock;
import net.minecraft.world.level.block.entity.BlockEntity;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.level.block.state.properties.ChestType;
import net.minecraft.world.phys.AABB;

import java.io.IOException;
import java.io.Reader;
import java.io.Writer;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Properties;
import java.util.Set;
import java.util.UUID;
import java.util.function.Consumer;
import java.util.function.Function;

public final class CofferHarnessAdapterMod implements ModInitializer, HarnessAdapter {
    static final Set<String> SUPPORTED_OPERATIONS = Operation.names();
    private static final Map<String, String> PROVIDER_KEYS = Map.of(
            "structures", "ouroboros:civilization/structure-registry/v1",
            "principals", "ouroboros:civilization/principal-directory/v1",
            "continuity", CofferInterop.CONTINUITY_KEY);
    private final Map<String, Object> originalProviders = new HashMap<>();
    private final Set<String> capturedProviders = new HashSet<>();
    private final Path providerControlState =
            FabricLoader.getInstance().getConfigDir().resolve("harness-coffer-provider-controls.properties");

    @Override
    public void onInitialize() {
        HarnessAdapters.register(this);
        ServerLifecycleEvents.SERVER_STARTED.register(this::applyPersistedProviderControls);
    }

    @Override
    public String id() {
        return "coffer";
    }

    @Override
    public JsonElement invoke(MinecraftServer server, String operation, JsonObject arguments) {
        Operation descriptor = Operation.required(operation);
        descriptor.validate(arguments);
        if (descriptor == Operation.PROVIDER_CONTROL) {
            return providerControl(server, arguments);
        }
        ServerLevel level = server.overworld();
        BlockPos pos = requiredPosition(server, arguments);
        return descriptor.invoke(server, level, pos, arguments);
    }

    static void validateOperation(String operation, JsonObject arguments) {
        Operation.required(operation).validate(arguments);
    }

    private JsonObject providerControl(MinecraftServer server, JsonObject arguments) {
        String provider = CofferAdapterJson.requiredString(arguments, "provider");
        String mode = CofferAdapterJson.requiredString(arguments, "mode");
        if ("all".equals(provider)) {
            restoreAllProviders();
            saveProviderControls(new Properties());
            return providerControlResult(provider, mode);
        }

        UUID player = arguments.has("player")
                ? requiredPlayer(server, arguments.get("player").getAsString()).getUUID()
                : null;
        if ("original".equals(mode)) {
            restoreProvider(provider);
        } else {
            captureAndPublish(provider, mode, player);
        }
        Properties controls = loadProviderControls();
        updateProviderControl(controls, provider, mode, player);
        saveProviderControls(controls);
        return providerControlResult(provider, mode);
    }

    private void applyPersistedProviderControls(MinecraftServer server) {
        Properties controls = loadProviderControls();
        for (String provider : PROVIDER_KEYS.keySet().stream().sorted().toList()) {
            String mode = controls.getProperty("mode." + provider);
            if (mode == null) continue;
            String encodedPlayer = controls.getProperty("player." + provider);
            UUID player = encodedPlayer == null ? null : UUID.fromString(encodedPlayer);
            captureAndPublish(provider, mode, player);
        }
    }

    private void captureAndPublish(String provider, String mode, UUID player) {
        String key = PROVIDER_KEYS.get(provider);
        if (capturedProviders.add(provider)) {
            originalProviders.put(provider, FabricLoader.getInstance().getObjectShare().get(key));
        }
        Object replacement = CivilizationProviderControl.replacement(
                provider, mode, originalProviders.get(provider), player);
        publishProvider(key, replacement);
    }

    private void restoreProvider(String provider) {
        if (!capturedProviders.remove(provider)) return;
        publishProvider(PROVIDER_KEYS.get(provider), originalProviders.remove(provider));
    }

    private void restoreAllProviders() {
        for (String provider : Set.copyOf(capturedProviders)) {
            restoreProvider(provider);
        }
    }

    private static void publishProvider(String key, Object provider) {
        if (provider == null) {
            FabricLoader.getInstance().getObjectShare().remove(key);
        } else {
            FabricLoader.getInstance().getObjectShare().put(key, provider);
        }
    }

    private static JsonObject providerControlResult(String provider, String mode) {
        JsonObject result = new JsonObject();
        result.addProperty("provider", provider);
        result.addProperty("mode", mode);
        return result;
    }

    private Properties loadProviderControls() {
        Properties controls = new Properties();
        if (!Files.exists(providerControlState)) return controls;
        try (Reader reader = Files.newBufferedReader(providerControlState)) {
            controls.load(reader);
            return controls;
        } catch (IOException e) {
            throw new IllegalStateException("failed to read harness provider controls", e);
        }
    }

    private void saveProviderControls(Properties controls) {
        try {
            if (controls.isEmpty()) {
                Files.deleteIfExists(providerControlState);
                return;
            }
            Files.createDirectories(providerControlState.getParent());
            try (Writer writer = Files.newBufferedWriter(providerControlState)) {
                controls.store(writer, "test-harness Coffer provider fault controls");
            }
        } catch (IOException e) {
            throw new IllegalStateException("failed to persist harness provider controls", e);
        }
    }

    private static void updateProviderControl(
            Properties controls, String provider, String mode, UUID player) {
        String modeKey = "mode." + provider;
        String playerKey = "player." + provider;
        if ("original".equals(mode)) {
            controls.remove(modeKey);
            controls.remove(playerKey);
            return;
        }
        controls.setProperty(modeKey, mode);
        if (player == null) {
            controls.remove(playerKey);
        } else {
            controls.setProperty(playerKey, player.toString());
        }
    }

    private static JsonObject bind(
            MinecraftServer server,
            ServerLevel level,
            BlockPos pos,
            JsonObject arguments) {
        LockType type = CofferAdapterJson.lockType(arguments);
        ServerPlayer owner = requiredPlayer(server, CofferAdapterJson.requiredString(arguments, "ownerPlayer"));
        Optional<ItemStack> key = Optional.empty();
        if (type == LockType.KEY) {
            ServerPlayer keyPlayer = requiredPlayer(server, CofferAdapterJson.requiredString(arguments, "keyFromPlayer"));
            ItemStack held = keyPlayer.getMainHandItem();
            if (held.isEmpty()) throw new IllegalArgumentException("keyFromPlayer must hold a selected key item");
            key = Optional.of(held.copy());
        }
        return mutationResult(level, pos, CofferApi.bind(level, pos, type, owner.getUUID(), key));
    }

    private static JsonObject setTrusted(
            MinecraftServer server,
            ServerLevel level,
            BlockPos pos,
            JsonObject arguments) {
        Set<UUID> trusted = new HashSet<>();
        for (String name : CofferAdapterJson.playerNames(arguments, "players")) {
            UUID player = requiredPlayer(server, name).getUUID();
            if (!trusted.add(player)) throw new IllegalArgumentException("duplicate trusted player: " + name);
        }
        return mutationResult(level, pos, CofferApi.setTrusted(level, pos, Set.copyOf(trusted)));
    }

    private static JsonObject setFlag(ServerLevel level, BlockPos pos, JsonObject arguments) {
        FlagType flag = CofferAdapterJson.flagType(arguments);
        Optional<Boolean> value = CofferAdapterJson.optionalBoolean(arguments, "value");
        return mutationResult(level, pos, CofferApi.setFlag(level, pos, flag, value));
    }

    private static JsonObject setPolicy(ServerLevel level, BlockPos pos, JsonObject arguments) {
        OwnershipMode ownershipMode = CofferAdapterJson.ownershipMode(arguments);
        Set<AccessScope> accessScopes = CofferAdapterJson.accessScopes(arguments);
        return mutationResult(level, pos, CofferApi.setContainerPolicy(
                level, pos, new ContainerPolicy(ownershipMode, accessScopes)));
    }

    private static JsonObject canOpen(MinecraftServer server, BlockPos pos, JsonObject arguments) {
        ServerPlayer player = requiredPlayer(server, CofferAdapterJson.requiredString(arguments, "player"));
        JsonObject result = new JsonObject();
        result.addProperty("player", player.getPlainTextName());
        result.addProperty("allowed", CofferApi.canOpen(player, pos));
        return result;
    }

    private static JsonObject protection(
            MinecraftServer server,
            ServerLevel level,
            BlockPos pos,
            JsonObject arguments) {
        ServerPlayer player = requiredPlayer(server, CofferAdapterJson.requiredString(arguments, "player"));
        NameAndId profile = new NameAndId(player.getUUID(), player.getPlainTextName());
        JsonObject result = new JsonObject();
        result.addProperty("bound", CommonProtection.isProtected(level, pos));
        result.addProperty("area", CommonProtection.isAreaProtected(level, new AABB(pos)));
        result.addProperty("interact", CommonProtection.canInteractBlock(level, pos, profile, player));
        result.addProperty("break", CommonProtection.canBreakBlock(level, pos, profile, player));
        result.addProperty("explosion", CommonProtection.canExplodeBlock(level, pos, null, profile, player));
        result.addProperty("placement", CommonProtection.canPlaceBlock(level, pos, profile, player));
        return result;
    }

    @SuppressWarnings("unchecked")
    private static JsonElement inspectRegistry(ServerLevel level, BlockPos pos) {
        Object published = FabricLoader.getInstance().getObjectShare().get(CofferInterop.REGISTRY_KEY);
        if (!(published instanceof Map<?, ?> registry)) {
            throw new IllegalStateException("Coffer ObjectShare registry is not published");
        }
        Object rawInspect = registry.get("inspect");
        if (!(rawInspect instanceof Function<?, ?> function)) {
            throw new IllegalStateException("Coffer ObjectShare registry has no inspect function");
        }
        Map<String, Object> request = new LinkedHashMap<>();
        request.put("world", level.dimension().identifier().toString());
        request.put("x", pos.getX());
        request.put("y", pos.getY());
        request.put("z", pos.getZ());
        Object response = ((Function<Map<String, Object>, ?>) function).apply(Map.copyOf(request));
        return toJson(response);
    }

    @SuppressWarnings("unchecked")
    private static JsonElement civilization(
            MinecraftServer server, ServerLevel level, BlockPos pos, JsonObject arguments) {
        ServerPlayer player = requiredPlayer(
                server, CofferAdapterJson.requiredString(arguments, "player"));
        Map<?, ?> structures = requiredProtocol(
                "ouroboros:civilization/structure-registry/v1", "structure registry");
        Map<?, ?> principals = requiredProtocol(
                "ouroboros:civilization/principal-directory/v1", "principal directory");
        if (!(structures.get("at") instanceof Function<?, ?> rawAt)
                || !(principals.get("resolve") instanceof Function<?, ?> rawResolve)
                || !(principals.get("isMember") instanceof java.util.function.BiPredicate<?, ?> rawMember)
                || !(principals.get("canAdminister") instanceof java.util.function.BiPredicate<?, ?> rawAdmin)) {
            throw new IllegalStateException("civilization providers are malformed");
        }
        Map<String, Object> request = Map.of(
                "world", level.dimension().identifier().toString(),
                "x", pos.getX(), "y", pos.getY(), "z", pos.getZ());
        Map<String, Object> structure = ((Function<Map<String, Object>, Map<String, Object>>) rawAt)
                .apply(request);
        String resolved = ((Function<UUID, String>) rawResolve).apply(player.getUUID());
        JsonObject result = new JsonObject();
        result.addProperty("player", player.getPlainTextName());
        result.addProperty("principal", resolved);
        result.add("structure", toJson(structure));
        Object owner = structure == null ? null : structure.get("owner");
        if (owner instanceof String ownerPrincipal) {
            result.addProperty("member", ((java.util.function.BiPredicate<String, UUID>) rawMember)
                    .test(ownerPrincipal, player.getUUID()));
            result.addProperty("canAdminister", ((java.util.function.BiPredicate<String, UUID>) rawAdmin)
                    .test(ownerPrincipal, player.getUUID()));
        } else {
            result.addProperty("member", false);
            result.addProperty("canAdminister", false);
        }
        return result;
    }

    private static Map<?, ?> requiredProtocol(String key, String label) {
        Object value = FabricLoader.getInstance().getObjectShare().get(key);
        if (!(value instanceof Map<?, ?> protocol)
                || !(protocol.get("protocolVersion") instanceof Number version)
                || version.intValue() != 1) {
            throw new IllegalStateException(label + " v1 is not published");
        }
        return protocol;
    }

    private static JsonObject inspectPair(ServerLevel level, BlockPos pos) {
        JsonObject result = new JsonObject();
        result.add("lock", inspectOptional(level, pos));
        result.add("pair", pairSnapshot(level, pos));
        return result;
    }

    private static JsonObject mutationResult(ServerLevel level, BlockPos pos, boolean updated) {
        return CofferAdapterJson.mutationResult(updated, inspectOptional(level, pos), pairSnapshot(level, pos));
    }

    private static JsonObject inspectRequired(ServerLevel level, BlockPos pos) {
        JsonElement snapshot = inspectOptional(level, pos);
        if (snapshot.isJsonNull()) throw new IllegalArgumentException("no Coffer lock at " + pos.toShortString());
        return snapshot.getAsJsonObject();
    }

    private static JsonElement inspectOptional(ServerLevel level, BlockPos pos) {
        BlockEntity blockEntity = level.getBlockEntity(pos);
        if (blockEntity == null) return JsonNull.INSTANCE;
        StoredLock stored = CofferMod.store().read(blockEntity).orElse(null);
        if (stored == null) return JsonNull.INSTANCE;
        JsonElement key = stored.key()
                .map(item -> ItemStack.CODEC.encodeStart(
                        level.registryAccess().createSerializationContext(JsonOps.INSTANCE), item).getOrThrow())
                .orElse(JsonNull.INSTANCE);
        return CofferAdapterJson.lockSnapshot(
                stored.lock(), stored.flags(), stored.containerPolicy(), key);
    }

    private static JsonArray pairSnapshot(ServerLevel level, BlockPos pos) {
        JsonArray pair = new JsonArray();
        for (BlockPos member : pairPositions(level, pos)) {
            JsonElement lock = inspectOptional(level, member);
            pair.add(CofferAdapterJson.pairEntry(
                    member.getX(), member.getY(), member.getZ(),
                    BuiltInRegistries.BLOCK.getKey(level.getBlockState(member).getBlock()).toString(),
                    lock));
        }
        return pair;
    }

    private static List<BlockPos> pairPositions(ServerLevel level, BlockPos pos) {
        BlockState state = level.getBlockState(pos);
        if (state.getBlock() instanceof ChestBlock && state.getValue(ChestBlock.TYPE) != ChestType.SINGLE) {
            return List.of(pos, ChestBlock.getConnectedBlockPos(pos, state));
        }
        return List.of(pos);
    }

    private static JsonElement toJson(Object value) {
        if (value == null) return JsonNull.INSTANCE;
        if (value instanceof JsonElement json) return json;
        if (value instanceof Boolean bool) return new com.google.gson.JsonPrimitive(bool);
        if (value instanceof Number number) return new com.google.gson.JsonPrimitive(number);
        if (value instanceof Character character) return new com.google.gson.JsonPrimitive(character);
        if (value instanceof String string) return new com.google.gson.JsonPrimitive(string);
        if (value instanceof Map<?, ?> map) {
            JsonObject result = new JsonObject();
            map.forEach((key, element) -> result.add(String.valueOf(key), toJson(element)));
            return result;
        }
        if (value instanceof Iterable<?> iterable) {
            JsonArray result = new JsonArray();
            iterable.forEach(element -> result.add(toJson(element)));
            return result;
        }
        return new com.google.gson.JsonPrimitive(String.valueOf(value));
    }

    private static ServerPlayer requiredPlayer(MinecraftServer server, String name) {
        return CofferAdapterJson.requiredOnlinePlayer(
                name, server.getPlayerList()::getPlayerByName);
    }

    private static int optionalInt(JsonObject object, String name) {
        return object.has(name) ? object.get(name).getAsInt() : 0;
    }

    private static BlockPos requiredPosition(MinecraftServer server, JsonObject arguments) {
        if (arguments.has("relativeTo")) {
            BlockPos origin = requiredPlayer(server, arguments.get("relativeTo").getAsString()).blockPosition();
            return origin.offset(
                    optionalInt(arguments, "x"),
                    optionalInt(arguments, "y"),
                    optionalInt(arguments, "z"));
        }
        return new BlockPos(
                CofferAdapterJson.requiredInt(arguments, "x"),
                CofferAdapterJson.requiredInt(arguments, "y"),
                CofferAdapterJson.requiredInt(arguments, "z"));
    }

    @FunctionalInterface
    private interface Invocation {
        JsonElement invoke(MinecraftServer server, ServerLevel level, BlockPos pos, JsonObject arguments);
    }

    private enum Operation {
        INSPECT("inspect", arguments -> { }, (server, level, pos, arguments) -> inspectRequired(level, pos)),
        INSPECT_PAIR("inspect-pair", arguments -> { },
                (server, level, pos, arguments) -> inspectPair(level, pos)),
        BIND("bind", arguments -> {
            LockType type = CofferAdapterJson.lockType(arguments);
            CofferAdapterJson.requiredString(arguments, "ownerPlayer");
            if (type == LockType.KEY) CofferAdapterJson.requiredString(arguments, "keyFromPlayer");
        }, CofferHarnessAdapterMod::bind),
        SET_TRUSTED("set-trusted", arguments -> CofferAdapterJson.playerNames(arguments, "players"),
                CofferHarnessAdapterMod::setTrusted),
        SET_FLAG("set-flag", arguments -> {
            CofferAdapterJson.flagType(arguments);
            CofferAdapterJson.optionalBoolean(arguments, "value");
        }, (server, level, pos, arguments) -> setFlag(level, pos, arguments)),
        SET_POLICY("set-policy", arguments -> {
            CofferAdapterJson.ownershipMode(arguments);
            CofferAdapterJson.accessScopes(arguments);
        }, (server, level, pos, arguments) -> setPolicy(level, pos, arguments)),
        CLEAR("clear", arguments -> { },
                (server, level, pos, arguments) -> mutationResult(level, pos, CofferApi.clear(level, pos))),
        CAN_OPEN("can-open", Operation::validatePlayer,
                (server, level, pos, arguments) -> canOpen(server, pos, arguments)),
        PROTECTION("protection", Operation::validatePlayer, CofferHarnessAdapterMod::protection),
        INSPECT_REGISTRY("inspect-registry", arguments -> { },
                (server, level, pos, arguments) -> inspectRegistry(level, pos)),
        CIVILIZATION("civilization", Operation::validatePlayer, CofferHarnessAdapterMod::civilization),
        PROVIDER_CONTROL("provider-control", Operation::validateProviderControl,
                (server, level, pos, arguments) -> {
                    throw new AssertionError("provider-control is invoked without a position");
                });

        private static final Map<String, Operation> BY_NAME = java.util.Arrays.stream(values())
                .collect(java.util.stream.Collectors.toUnmodifiableMap(Operation::serializedName, value -> value));
        private final String serializedName;
        private final Consumer<JsonObject> validator;
        private final Invocation invocation;

        Operation(String serializedName, Consumer<JsonObject> validator, Invocation invocation) {
            this.serializedName = serializedName;
            this.validator = validator;
            this.invocation = invocation;
        }

        static Operation required(String name) {
            Operation operation = BY_NAME.get(name);
            if (operation == null) {
                throw new IllegalArgumentException("unknown Coffer adapter operation: " + name);
            }
            return operation;
        }

        static Set<String> names() {
            return BY_NAME.keySet();
        }

        private static void validatePlayer(JsonObject arguments) {
            CofferAdapterJson.requiredString(arguments, "player");
        }

        private static void validateProviderControl(JsonObject arguments) {
            String provider = CofferAdapterJson.requiredString(arguments, "provider");
            String mode = CofferAdapterJson.requiredString(arguments, "mode");
            Set<String> modes = switch (provider) {
                case "all" -> Set.of("original");
                case "structures" -> Set.of(
                        "original", "missing", "malformed", "resident", "transferred");
                case "principals" -> Set.of(
                        "original", "missing", "malformed", "throwing", "stale");
                case "continuity" -> Set.of(
                        "original", "missing", "malformed",
                        "restore-throwing", "acknowledge-throwing");
                default -> throw new IllegalArgumentException("unknown provider: " + provider);
            };
            if (!modes.contains(mode)) {
                throw new IllegalArgumentException(
                        "unsupported provider control: " + provider + "/" + mode);
            }
            if (Set.of("resident", "transferred").contains(mode)) {
                CofferAdapterJson.requiredString(arguments, "player");
            }
        }

        String serializedName() {
            return serializedName;
        }

        void validate(JsonObject arguments) {
            validator.accept(arguments);
        }

        JsonElement invoke(MinecraftServer server, ServerLevel level, BlockPos pos, JsonObject arguments) {
            return invocation.invoke(server, level, pos, arguments);
        }
    }
}
