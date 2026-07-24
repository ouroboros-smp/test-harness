package com.ouroboros.harness.adapter.parcels;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.ouroboros.harness.bridge.HarnessAdapter;
import com.ouroboros.harness.bridge.HarnessAdapters;
import eu.pb4.common.protection.api.CommonProtection;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.DriverManager;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.function.Consumer;
import java.util.function.Function;
import net.fabricmc.api.ModInitializer;
import net.fabricmc.loader.api.FabricLoader;
import net.minecraft.core.BlockPos;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.server.players.NameAndId;

/** Harness-only direct-claim fixture, Patrol v3 peer, and protection probe. */
public final class ParcelsHarnessAdapterMod implements ModInitializer, HarnessAdapter {
    static final String PATROL_V3_KEY = "ouroboros:civilization/patrol-conflict/v3";
    private static final String AVAILABILITY_FILE =
            "harness-parcels-patrol.properties";
    private final CopyOnWriteArrayList<Consumer<Map<String, Object>>> subscribers =
            new CopyOnWriteArrayList<>();
    private Path availabilityFile;
    private volatile boolean patrolAvailable;

    @Override
    public void onInitialize() {
        HarnessAdapters.register(this);
        availabilityFile = FabricLoader.getInstance().getConfigDir().resolve(AVAILABILITY_FILE);
        patrolAvailable = readAvailability(availabilityFile);
        var share = FabricLoader.getInstance().getObjectShare();
        if (share.get(PATROL_V3_KEY) != null) {
            throw new IllegalStateException("Patrol v3 provider is already published");
        }
        Function<UUID, Map<String, Object>> status =
                player -> ParcelsAdapterContracts.patrolStatus(player, patrolAvailable);
        Function<Consumer<Map<String, Object>>, AutoCloseable> subscribe = listener -> {
            subscribers.add(listener);
            return () -> subscribers.remove(listener);
        };
        share.put(PATROL_V3_KEY, Map.of(
                "protocolVersion", 3,
                "eventSchemaVersion", 1,
                "status", status,
                "subscribe", subscribe));
    }

    @Override
    public String id() {
        return "parcels";
    }

    @Override
    public JsonElement invoke(
            MinecraftServer server, String operation, JsonObject arguments) throws Exception {
        return switch (operation) {
            case "offline-id" -> offlineId(arguments);
            case "seed-direct-claim" -> seedDirectClaim(arguments);
            case "patrol-available" -> patrolAvailable(arguments);
            case "protection" -> protection(server, arguments);
            default -> throw new IllegalArgumentException(
                    "unknown Parcels adapter operation: " + operation);
        };
    }

    private static JsonObject offlineId(JsonObject arguments) {
        String username = requiredString(arguments, "username");
        JsonObject result = new JsonObject();
        result.addProperty("username", username);
        result.addProperty("id", ParcelsAdapterContracts.offlinePlayerId(username).toString());
        return result;
    }

    private JsonObject seedDirectClaim(JsonObject arguments) throws Exception {
        UUID structureId = requiredUuid(arguments, "structureId");
        UUID roomId = requiredUuid(arguments, "roomId");
        String username = requiredString(arguments, "ownerUsername");
        UUID ownerId = ParcelsAdapterContracts.offlinePlayerId(username);
        int x = requiredInt(arguments, "x");
        int y = requiredInt(arguments, "y");
        int z = requiredInt(arguments, "z");
        Path database = FabricLoader.getInstance().getConfigDir()
                .resolve("parcels").resolve("parcels.db");
        Class.forName("org.sqlite.JDBC");
        try (var connection =
                        DriverManager.getConnection("jdbc:sqlite:" + database.toAbsolutePath());
                var timeout = connection.createStatement();
                var statement = connection.prepareStatement("""
                        INSERT INTO claims(
                          structure_id,world,owner,residents,rooms,phase,
                          activation_at,grace_until,source_revision,
                          geometry_revision,geometry_attempt,revision)
                        VALUES(?,?,?,?,?,'ACTIVE',0,0,1,-1,'',3)
                        ON CONFLICT(structure_id) DO UPDATE SET
                          world=excluded.world,owner=excluded.owner,
                          residents=excluded.residents,rooms=excluded.rooms,
                          phase=excluded.phase,activation_at=excluded.activation_at,
                          grace_until=excluded.grace_until,
                          source_revision=excluded.source_revision,
                          geometry_revision=excluded.geometry_revision,
                          geometry_attempt=excluded.geometry_attempt,
                          revision=excluded.revision
                        """)) {
            timeout.execute("PRAGMA busy_timeout=5000");
            statement.setString(1, structureId.toString());
            statement.setString(2, "minecraft:overworld");
            statement.setString(3, "player:" + ownerId);
            statement.setString(4, "");
            statement.setString(5,
                    ParcelsAdapterContracts.legacyRoom(roomId, x, y, z, x, y, z));
            if (statement.executeUpdate() != 1) {
                throw new IllegalStateException("direct claim fixture was not persisted");
            }
        }
        JsonObject result = new JsonObject();
        result.addProperty("structureId", structureId.toString());
        result.addProperty("roomId", roomId.toString());
        result.addProperty("ownerId", ownerId.toString());
        result.addProperty("x", x);
        result.addProperty("y", y);
        result.addProperty("z", z);
        return result;
    }

    private JsonObject patrolAvailable(JsonObject arguments) throws Exception {
        boolean available = requiredBoolean(arguments, "available");
        UUID player = ParcelsAdapterContracts.offlinePlayerId(
                requiredString(arguments, "playerUsername"));
        patrolAvailable = available;
        Files.createDirectories(availabilityFile.getParent());
        Files.writeString(availabilityFile,
                "available=" + available + System.lineSeparator(),
                StandardCharsets.UTF_8);
        Map<String, Object> event = Map.of(
                "eventId", UUID.randomUUID().toString(),
                "eventType", "harness-patrol-availability",
                "aggregateId", player.toString(),
                "playerId", player.toString(),
                "revision", 1L);
        int delivered = subscribers.size();
        subscribers.forEach(listener -> listener.accept(event));
        JsonObject result = new JsonObject();
        result.addProperty("available", available);
        result.addProperty("playerId", player.toString());
        result.addProperty("delivered", delivered);
        result.addProperty("subscribersAfter", subscribers.size());
        return result;
    }

    private static JsonObject protection(
            MinecraftServer server, JsonObject arguments) {
        ServerPlayer player = requiredPlayer(
                server, requiredString(arguments, "player"));
        ServerLevel level = server.overworld();
        BlockPos pos = new BlockPos(
                requiredInt(arguments, "x"),
                requiredInt(arguments, "y"),
                requiredInt(arguments, "z"));
        NameAndId profile = new NameAndId(player.getUUID(), player.getPlainTextName());
        JsonObject result = new JsonObject();
        result.addProperty("bound", CommonProtection.isProtected(level, pos));
        result.addProperty(
                "break", CommonProtection.canBreakBlock(level, pos, profile, player));
        result.addProperty(
                "place", CommonProtection.canPlaceBlock(level, pos, profile, player));
        result.addProperty(
                "interact", CommonProtection.canInteractBlock(level, pos, profile, player));
        result.addProperty(
                "explosion", CommonProtection.canExplodeBlock(
                        level, pos, null, profile, player));
        return result;
    }

    private static ServerPlayer requiredPlayer(MinecraftServer server, String name) {
        ServerPlayer player = server.getPlayerList().getPlayerByName(name);
        if (player == null) {
            throw new IllegalArgumentException("player is not online: " + name);
        }
        return player;
    }

    private static boolean readAvailability(Path path) {
        if (!Files.exists(path)) return true;
        try {
            for (String line : Files.readAllLines(path, StandardCharsets.UTF_8)) {
                if (line.startsWith("available=")) {
                    String value = line.substring("available=".length()).trim();
                    if ("true".equals(value)) return true;
                    if ("false".equals(value)) return false;
                }
            }
            throw new IllegalStateException("malformed harness Patrol availability");
        } catch (Exception failure) {
            throw new IllegalStateException(
                    "failed to read harness Patrol availability", failure);
        }
    }

    private static String requiredString(JsonObject arguments, String name) {
        if (!arguments.has(name) || !arguments.get(name).isJsonPrimitive()) {
            throw new IllegalArgumentException(name + " is required");
        }
        String value = arguments.get(name).getAsString();
        if (value.isBlank()) throw new IllegalArgumentException(name + " is required");
        return value;
    }

    private static UUID requiredUuid(JsonObject arguments, String name) {
        try {
            return UUID.fromString(requiredString(arguments, name));
        } catch (IllegalArgumentException malformed) {
            throw new IllegalArgumentException(name + " must be a UUID", malformed);
        }
    }

    private static int requiredInt(JsonObject arguments, String name) {
        try {
            return new BigDecimal(requiredString(arguments, name)).intValueExact();
        } catch (ArithmeticException | NumberFormatException malformed) {
            throw new IllegalArgumentException(name + " must be an exact integer", malformed);
        }
    }

    private static boolean requiredBoolean(JsonObject arguments, String name) {
        if (!arguments.has(name) || !arguments.get(name).isJsonPrimitive()
                || !arguments.get(name).getAsJsonPrimitive().isBoolean()) {
            throw new IllegalArgumentException(name + " must be a boolean");
        }
        return arguments.get(name).getAsBoolean();
    }
}
