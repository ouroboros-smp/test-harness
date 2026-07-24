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
    static final String KINSHIP_V2_KEY =
            "ouroboros:civilization/principal-directory/v2";
    private static final String GROUP_PRINCIPAL = "kinship:family-42";
    private static final String AVAILABILITY_FILE =
            "harness-parcels-patrol.properties";
    private static final String FIXTURES_FILE =
            "harness-parcels-fixtures.properties";
    private final CopyOnWriteArrayList<Consumer<Map<String, Object>>> patrolSubscribers =
            new CopyOnWriteArrayList<>();
    private final CopyOnWriteArrayList<Consumer<Map<String, Object>>> kinshipSubscribers =
            new CopyOnWriteArrayList<>();
    private Path availabilityFile;
    private volatile boolean patrolAvailable;
    private volatile UUID kinshipMember;
    private volatile boolean kinshipSessionAvailable;
    private volatile boolean patrolFixtureEnabled = true;
    private volatile boolean kinshipFixtureEnabled = true;

    @Override
    public void onInitialize() {
        HarnessAdapters.register(this);
        Path configDir = FabricLoader.getInstance().getConfigDir();
        availabilityFile = configDir.resolve(AVAILABILITY_FILE);
        patrolAvailable = readAvailability(availabilityFile);
        // Composed scenarios install the packaged Patrol or Kinship jar next to this
        // adapter; the deterministic fixture for that peer must then stay unpublished
        // so the real mod owns its ObjectShare key.
        Path fixturesFile = configDir.resolve(FIXTURES_FILE);
        patrolFixtureEnabled = readFixtureFlag(fixturesFile, "publish-patrol");
        kinshipFixtureEnabled = readFixtureFlag(fixturesFile, "publish-kinship");
        var share = FabricLoader.getInstance().getObjectShare();
        if (patrolFixtureEnabled) {
            if (share.get(PATROL_V3_KEY) != null) {
                throw new IllegalStateException("Patrol v3 provider is already published");
            }
            Function<UUID, Map<String, Object>> status =
                    player -> ParcelsAdapterContracts.patrolStatus(player, patrolAvailable);
            Function<Consumer<Map<String, Object>>, AutoCloseable> subscribe = listener -> {
                patrolSubscribers.add(listener);
                return () -> patrolSubscribers.remove(listener);
            };
            share.put(PATROL_V3_KEY, Map.of(
                    "protocolVersion", 3,
                    "eventSchemaVersion", 1,
                    "status", status,
                    "subscribe", subscribe));
        }
        if (kinshipFixtureEnabled) {
            if (share.get(KINSHIP_V2_KEY) != null) {
                throw new IllegalStateException("Kinship v2 provider is already published");
            }
            Function<UUID, Map<String, Object>> kinshipStatus = player ->
                    ParcelsAdapterContracts.kinshipStatus(
                            player,
                            kinshipMember == null ? new UUID(0L, 0L) : kinshipMember,
                            GROUP_PRINCIPAL,
                            kinshipSessionAvailable);
            Function<Consumer<Map<String, Object>>, AutoCloseable> kinshipSubscribe = listener -> {
                kinshipSubscribers.add(listener);
                return () -> kinshipSubscribers.remove(listener);
            };
            share.put(KINSHIP_V2_KEY, Map.of(
                    "protocolVersion", 2,
                    "eventSchemaVersion", 1,
                    "status", kinshipStatus,
                    "subscribe", kinshipSubscribe));
        }
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
            case "seed-group-claim" -> seedGroupClaim(arguments);
            case "kinship-session" -> kinshipSession(arguments);
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
        seedClaim(structureId, roomId, "player:" + ownerId, x, y, z);
        JsonObject result = claimResult(structureId, roomId, x, y, z);
        result.addProperty("ownerId", ownerId.toString());
        return result;
    }

    private JsonObject seedGroupClaim(JsonObject arguments) throws Exception {
        UUID structureId = requiredUuid(arguments, "structureId");
        UUID roomId = requiredUuid(arguments, "roomId");
        String memberUsername = requiredString(arguments, "memberUsername");
        UUID memberId = ParcelsAdapterContracts.offlinePlayerId(memberUsername);
        int x = requiredInt(arguments, "x");
        int y = requiredInt(arguments, "y");
        int z = requiredInt(arguments, "z");
        seedClaim(structureId, roomId, GROUP_PRINCIPAL, x, y, z);
        JsonObject result = claimResult(structureId, roomId, x, y, z);
        result.addProperty("groupPrincipal", GROUP_PRINCIPAL);
        result.addProperty("memberId", memberId.toString());
        return result;
    }

    private static void seedClaim(
            UUID structureId,
            UUID roomId,
            String owner,
            int x,
            int y,
            int z) throws Exception {
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
            statement.setString(3, owner);
            statement.setString(4, "");
            statement.setString(5,
                    ParcelsAdapterContracts.legacyRoom(roomId, x, y, z, x, y, z));
            if (statement.executeUpdate() != 1) {
                throw new IllegalStateException("direct claim fixture was not persisted");
            }
        }
    }

    private static JsonObject claimResult(
            UUID structureId, UUID roomId, int x, int y, int z) {
        JsonObject result = new JsonObject();
        result.addProperty("structureId", structureId.toString());
        result.addProperty("roomId", roomId.toString());
        result.addProperty("x", x);
        result.addProperty("y", y);
        result.addProperty("z", z);
        return result;
    }

    private JsonObject kinshipSession(JsonObject arguments) {
        if (!kinshipFixtureEnabled) {
            throw new IllegalStateException(
                    "the Kinship fixture is disabled by " + FIXTURES_FILE);
        }
        UUID member = ParcelsAdapterContracts.offlinePlayerId(
                requiredString(arguments, "playerUsername"));
        boolean available = requiredBoolean(arguments, "available");
        kinshipMember = member;
        kinshipSessionAvailable = available;
        Map<String, Object> event = Map.ofEntries(
                Map.entry("eventType", "kinship.administration_changed"),
                Map.entry("action", "administration_changed"),
                Map.entry("aggregateId", member.toString()),
                Map.entry("aggregateRevision", 8L),
                Map.entry("data", Map.of(
                        "playerId", member.toString(),
                        "previousPrincipal", GROUP_PRINCIPAL,
                        "principal", GROUP_PRINCIPAL,
                        "previousCanAdminister", false,
                        "canAdminister", false)));
        int delivered = kinshipSubscribers.size();
        kinshipSubscribers.forEach(listener -> listener.accept(event));
        JsonObject result = new JsonObject();
        result.addProperty("available", available);
        result.addProperty("memberId", member.toString());
        result.addProperty("groupPrincipal", GROUP_PRINCIPAL);
        result.addProperty("delivered", delivered);
        result.addProperty("subscribersAfter", kinshipSubscribers.size());
        return result;
    }

    private JsonObject patrolAvailable(JsonObject arguments) throws Exception {
        if (!patrolFixtureEnabled) {
            throw new IllegalStateException(
                    "the Patrol fixture is disabled by " + FIXTURES_FILE);
        }
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
        int delivered = patrolSubscribers.size();
        patrolSubscribers.forEach(listener -> listener.accept(event));
        JsonObject result = new JsonObject();
        result.addProperty("available", available);
        result.addProperty("playerId", player.toString());
        result.addProperty("delivered", delivered);
        result.addProperty("subscribersAfter", patrolSubscribers.size());
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

    private static boolean readFixtureFlag(Path path, String key) {
        if (!Files.exists(path)) return true;
        try {
            return ParcelsAdapterContracts.fixtureFlag(
                    Files.readAllLines(path, StandardCharsets.UTF_8), key);
        } catch (Exception failure) {
            throw new IllegalStateException(
                    "failed to read harness Parcels fixture flags", failure);
        }
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
