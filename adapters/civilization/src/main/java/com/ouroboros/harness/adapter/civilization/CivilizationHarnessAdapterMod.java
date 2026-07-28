package com.ouroboros.harness.adapter.civilization;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonNull;
import com.google.gson.JsonObject;
import com.google.gson.JsonPrimitive;
import com.ouroboros.harness.bridge.HarnessAdapter;
import com.ouroboros.harness.bridge.HarnessAdapters;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.Consumer;
import java.util.function.Function;
import net.fabricmc.api.ModInitializer;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerTickEvents;
import net.fabricmc.loader.api.FabricLoader;
import net.fabricmc.loader.api.ObjectShare;
import net.minecraft.server.MinecraftServer;

/**
 * Harness-only observer of the versioned civilization protocols shared by Rooms and Parcels.
 *
 * <p>The adapter intentionally has no compile-time dependency on either production mod. A passing
 * assertion therefore proves that their packaged jars publish and consume the public ObjectShare
 * boundary rather than succeeding through a test-only implementation hook.
 */
public final class CivilizationHarnessAdapterMod implements ModInitializer, HarnessAdapter {
    private static final String STRUCTURES_KEY =
            "ouroboros:civilization/structure-registry/v3";
    private static final String HULLS_KEY =
            "ouroboros:civilization/structure-hulls/v1";
    private static final String CLAIMS_KEY =
            "ouroboros:civilization/parcels-claims/v3";
    private static final int PAGE_LIMIT = 64;
    private static final AtomicBoolean observingStructures = new AtomicBoolean();
    private static final List<Map<String, Object>> structureEvents =
            new CopyOnWriteArrayList<>();

    @Override
    public void onInitialize() {
        HarnessAdapters.register(this);
        ServerTickEvents.END_SERVER_TICK.register(ignored -> observeStructureEvents());
    }

    @Override
    public String id() {
        return "civilization";
    }

    @Override
    public JsonElement invoke(MinecraftServer server, String operation, JsonObject arguments) {
        return switch (operation) {
            case "inspect" -> inspect(FabricLoader.getInstance().getObjectShare());
            default -> throw new IllegalArgumentException(
                    "unknown Civilization adapter operation: " + operation);
        };
    }

    private static JsonObject inspect(ObjectShare share) {
        Protocol structures = protocol(share, STRUCTURES_KEY, 3);
        Protocol claims = protocol(share, CLAIMS_KEY, 3);
        Protocol hulls = protocol(share, HULLS_KEY, 1);

        List<Map<String, Object>> structureItems = structures.page();
        List<Map<String, Object>> claimItems = claims.page();
        Map<String, Map<String, Object>> structuresById = byId(structureItems);
        Map<String, Map<String, Object>> claimsById = byId(claimItems);
        Set<String> matchedIds = new LinkedHashSet<>(structuresById.keySet());
        matchedIds.retainAll(claimsById.keySet());

        int multiroomStructures = (int) structureItems.stream()
                .filter(structure -> longValue(structure.get("roomCount")) >= 2)
                .count();
        int multiroomClaims = (int) claimItems.stream()
                .filter(claim -> longValue(claim.get("roomCount")) >= 2)
                .count();
        int ownershipMatches = 0;
        int readyHulls = 0;
        for (String id : matchedIds) {
            Map<String, Object> structure = structuresById.get(id);
            Map<String, Object> claim = claimsById.get(id);
            String principal = stringValue(
                    structure.containsKey("principal")
                            ? structure.get("principal")
                            : structure.get("owner"));
            if (!principal.isEmpty() && principal.equals(stringValue(claim.get("owner")))) {
                ownershipMatches++;
            }
            if (!hulls.get(id).isEmpty()) readyHulls++;
        }

        JsonObject result = new JsonObject();
        result.addProperty("structureProtocolVersion", structures.version());
        result.addProperty("hullProtocolVersion", hulls.version());
        result.addProperty("claimProtocolVersion", claims.version());
        result.addProperty("structureCount", structureItems.size());
        result.addProperty("claimCount", claimItems.size());
        result.addProperty("matchedCount", matchedIds.size());
        result.addProperty("multiroomStructureCount", multiroomStructures);
        result.addProperty("multiroomClaimCount", multiroomClaims);
        result.addProperty("ownershipMatchCount", ownershipMatches);
        result.addProperty("readyHullCount", readyHulls);
        result.add("matchedIds", toJson(new ArrayList<>(matchedIds)));
        result.add("structures", toJson(structureItems));
        result.add("claims", toJson(claimItems));
        result.add("structureGeometry", toJson(structures.geometryDiagnostics(structureItems)));
        result.add("structureEvents", toJson(structureEvents));
        return result;
    }

    @SuppressWarnings("unchecked")
    private static void observeStructureEvents() {
        if (observingStructures.get()) return;
        Object raw = FabricLoader.getInstance().getObjectShare().get(STRUCTURES_KEY);
        if (!(raw instanceof Map<?, ?> protocol)
                || !(protocol.get("subscribe") instanceof Consumer<?> rawSubscribe)) return;
        if (!observingStructures.compareAndSet(false, true)) return;
        ((Consumer<Consumer<Map<String, Object>>>) rawSubscribe).accept(event -> {
            if (structureEvents.size() < 64) structureEvents.add(new LinkedHashMap<>(event));
        });
    }

    private static Map<String, Map<String, Object>> byId(
            List<Map<String, Object>> items) {
        Map<String, Map<String, Object>> byId = new LinkedHashMap<>();
        for (Map<String, Object> item : items) {
            String id = stringValue(item.get("id"));
            if (!id.isEmpty()) byId.put(id, item);
        }
        return byId;
    }

    @SuppressWarnings("unchecked")
    private static Protocol protocol(ObjectShare share, String key, int expectedVersion) {
        Object raw = share.get(key);
        if (!(raw instanceof Map<?, ?> values)) {
            throw new IllegalStateException("missing ObjectShare protocol: " + key);
        }
        Object version = values.get("protocolVersion");
        if (!(version instanceof Number number) || number.intValue() != expectedVersion) {
            throw new IllegalStateException(
                    "unexpected ObjectShare protocol version for " + key + ": " + version);
        }
        return new Protocol(
                key,
                expectedVersion,
                (Map<String, Object>) values);
    }

    private static long longValue(Object value) {
        return value instanceof Number number ? number.longValue() : -1L;
    }

    private static String stringValue(Object value) {
        return value instanceof String text ? text : "";
    }

    private static JsonElement toJson(Object value) {
        if (value == null) return JsonNull.INSTANCE;
        if (value instanceof String text) return new JsonPrimitive(text);
        if (value instanceof Number number) return new JsonPrimitive(number);
        if (value instanceof Boolean flag) return new JsonPrimitive(flag);
        if (value instanceof Map<?, ?> map) {
            JsonObject object = new JsonObject();
            map.forEach((key, entry) -> object.add(String.valueOf(key), toJson(entry)));
            return object;
        }
        if (value instanceof Iterable<?> iterable) {
            JsonArray array = new JsonArray();
            iterable.forEach(entry -> array.add(toJson(entry)));
            return array;
        }
        return new JsonPrimitive(String.valueOf(value));
    }

    private record Protocol(String key, int version, Map<String, Object> values) {
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> page() {
            Object raw = values.get("page");
            if (!(raw instanceof Function<?, ?>)) {
                throw new IllegalStateException("protocol has no page function: " + key);
            }
            Function<Map<String, Object>, Map<String, Object>> page =
                    (Function<Map<String, Object>, Map<String, Object>>) raw;
            Map<String, Object> response = page.apply(
                    Map.of("after", "", "limit", PAGE_LIMIT));
            Object rawItems = response.get("items");
            if (!(rawItems instanceof List<?> list)) {
                throw new IllegalStateException("protocol returned no items page: " + key);
            }
            List<Map<String, Object>> items = new ArrayList<>();
            for (Object item : list) {
                if (!(item instanceof Map<?, ?> map)) {
                    throw new IllegalStateException("protocol returned a non-map item: " + key);
                }
                items.add((Map<String, Object>) map);
            }
            return List.copyOf(items);
        }

        @SuppressWarnings("unchecked")
        Map<String, Object> get(String id) {
            Object raw = values.get("get");
            if (!(raw instanceof Function<?, ?>)) {
                throw new IllegalStateException("protocol has no get function: " + key);
            }
            Object result = ((Function<String, ?>) raw).apply(id);
            return result instanceof Map<?, ?> map
                    ? (Map<String, Object>) map
                    : Map.of();
        }

        @SuppressWarnings("unchecked")
        List<Map<String, Object>> geometryDiagnostics(List<Map<String, Object>> structures) {
            if (version != 3
                    || !(values.get("roomPage") instanceof Function<?, ?> rawRoomPage)
                    || !(values.get("geometryPage") instanceof Function<?, ?> rawGeometryPage)) {
                return List.of();
            }
            Function<Map<String, Object>, Map<String, Object>> roomPage =
                    (Function<Map<String, Object>, Map<String, Object>>) rawRoomPage;
            Function<Map<String, Object>, Map<String, Object>> geometryPage =
                    (Function<Map<String, Object>, Map<String, Object>>) rawGeometryPage;
            List<Map<String, Object>> diagnostics = new ArrayList<>();
            for (Map<String, Object> structure : structures) {
                String structureId = stringValue(structure.get("id"));
                long revision = longValue(structure.get("revision"));
                long expectedRooms = longValue(structure.get("roomCount"));
                String roomCursor = "";
                long receivedRooms = 0;
                long expectedCells = 0;
                long receivedCells = 0;
                boolean valid = !structureId.isEmpty() && revision >= 0 && expectedRooms >= 0;
                while (valid && receivedRooms < expectedRooms) {
                    Map<String, Object> response = roomPage.apply(Map.of(
                            "structureId", structureId, "revision", revision,
                            "after", roomCursor, "limit", 1));
                    Object rawItems = response.get("items");
                    if (!(rawItems instanceof List<?> items) || items.size() != 1
                            || !(items.getFirst() instanceof Map<?, ?> rawRoom)) {
                        valid = false;
                        break;
                    }
                    Map<String, Object> room = (Map<String, Object>) rawRoom;
                    String roomId = stringValue(room.get("id"));
                    long roomCells = longValue(room.get("cellCount"));
                    if (roomId.isEmpty() || roomCells < 1) {
                        valid = false;
                        break;
                    }
                    expectedCells += roomCells;
                    String cellCursor = "";
                    long roomReceived = 0;
                    while (valid && roomReceived < roomCells) {
                        Map<String, Object> geometry = geometryPage.apply(Map.of(
                                "structureId", structureId, "revision", revision,
                                "roomId", roomId, "after", cellCursor, "limit", 4096));
                        Object rawCells = geometry.get("items");
                        Object rawNext = geometry.get("nextCursor");
                        if (!(rawCells instanceof List<?> cells) || cells.isEmpty()
                                || !(rawNext instanceof String next)) {
                            valid = false;
                            break;
                        }
                        roomReceived += cells.size();
                        receivedCells += cells.size();
                        cellCursor = next;
                        if (cellCursor.isEmpty() && roomReceived != roomCells) valid = false;
                    }
                    if (roomReceived != roomCells || !cellCursor.isEmpty()) valid = false;
                    Object rawNextRoom = response.get("nextCursor");
                    if (!(rawNextRoom instanceof String nextRoom)) valid = false;
                    else roomCursor = nextRoom;
                    receivedRooms++;
                }
                if (receivedRooms != expectedRooms || !roomCursor.isEmpty()) valid = false;
                diagnostics.add(Map.of(
                        "structureId", structureId,
                        "revision", revision,
                        "expectedRooms", expectedRooms,
                        "receivedRooms", receivedRooms,
                        "expectedCells", expectedCells,
                        "receivedCells", receivedCells,
                        "valid", valid));
            }
            return List.copyOf(diagnostics);
        }
    }
}
