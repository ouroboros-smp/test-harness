package com.ouroboros.harness.adapter.rooms;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.ouroboros.harness.bridge.HarnessAdapter;
import com.ouroboros.harness.bridge.HarnessAdapters;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.Function;
import net.fabricmc.api.ModInitializer;
import net.fabricmc.loader.api.FabricLoader;
import net.minecraft.server.MinecraftServer;

/** Harness-only strict reader for the packaged Rooms structure-hulls/v1 protocol. */
public final class RoomsHarnessAdapterMod implements ModInitializer, HarnessAdapter {
    private static final String KEY = "ouroboros:civilization/structure-hulls/v1";

    @Override
    public void onInitialize() {
        HarnessAdapters.register(this);
    }

    @Override
    public String id() {
        return "rooms";
    }

    @Override
    public JsonElement invoke(
            MinecraftServer server, String operation, JsonObject arguments) {
        return switch (operation) {
            case "protocol" -> protocol();
            case "snapshot" -> snapshot(requiredUuid(arguments, "structureId"));
            case "contains" -> contains(
                    requiredUuid(arguments, "structureId"),
                    requiredCoordinate(arguments, "x"),
                    requiredCoordinate(arguments, "y"),
                    requiredCoordinate(arguments, "z"));
            default -> throw new IllegalArgumentException(
                    "unknown Rooms adapter operation: " + operation);
        };
    }

    private JsonObject protocol() {
        Object raw = FabricLoader.getInstance().getObjectShare().get(KEY);
        JsonObject result = new JsonObject();
        result.addProperty("installed", raw instanceof Map<?, ?>);
        if (raw instanceof Map<?, ?> protocol) {
            result.addProperty(
                    "protocolVersion",
                    protocol.get("protocolVersion") instanceof Integer
                            ? (Integer) protocol.get("protocolVersion")
                            : -1);
            result.addProperty(
                    "eventSchemaVersion",
                    protocol.get("eventSchemaVersion") instanceof Integer
                            ? (Integer) protocol.get("eventSchemaVersion")
                            : -1);
            result.addProperty("hasGet", protocol.get("get") instanceof Function<?, ?>);
            result.addProperty("hasSpanPage", protocol.get("spanPage") instanceof Function<?, ?>);
            result.addProperty(
                    "hasSubscribe",
                    protocol.get("subscribe") instanceof java.util.function.Consumer<?>);
        }
        return result;
    }

    @SuppressWarnings("unchecked")
    private JsonObject snapshot(UUID structureId) {
        Object raw = FabricLoader.getInstance().getObjectShare().get(KEY);
        if (!(raw instanceof Map<?, ?> protocol)
                || !(protocol.get("protocolVersion") instanceof Integer version)
                || version != 1
                || !(protocol.get("get") instanceof Function<?, ?> rawGet)
                || !(protocol.get("spanPage") instanceof Function<?, ?> rawPage)) {
            throw new IllegalStateException("Rooms structure-hulls/v1 is unavailable");
        }
        Function<Object, Map<String, Object>> get =
                (Function<Object, Map<String, Object>>) rawGet;
        Function<Object, Map<String, Object>> page =
                (Function<Object, Map<String, Object>>) rawPage;
        Map<String, Object> summary = get.apply(structureId.toString());
        if (summary.isEmpty()) return unavailable(structureId);
        requireIdentity(summary, structureId, null, null, null);
        String world = requiredWorld(summary);
        int ruleVersion = requiredPositiveInt(summary, "ruleVersion");
        long revision = requiredLong(summary, "sourceRevision");
        int expectedSpans = requiredNonNegativeInt(summary, "spanCount");
        long expectedCells = requiredLong(summary, "cellCount");
        JsonArray spans = new JsonArray();
        Span previous = null;
        long actualCells = 0;
        String after = "";
        while (spans.size() < expectedSpans) {
            Map<String, Object> response = page.apply(Map.of(
                    "structureId", structureId.toString(),
                    "sourceRevision", revision,
                    "after", after,
                    "limit", 1_024));
            if (response.isEmpty()) {
                throw new IllegalStateException("hull page disappeared at revision " + revision);
            }
            requireIdentity(response, structureId, world, ruleVersion, revision);
            Object rawItems = response.get("items");
            if (!(rawItems instanceof List<?> items)) {
                throw new IllegalStateException("hull page items are malformed");
            }
            if (items.isEmpty() && Boolean.TRUE.equals(response.get("hasMore"))) {
                throw new IllegalStateException("non-terminal hull page is empty");
            }
            if (items.size() > 1_024) {
                throw new IllegalStateException("hull page exceeds requested limit");
            }
            for (Object item : items) {
                if (!(item instanceof Map<?, ?> span)) {
                    throw new IllegalStateException("hull span is malformed");
                }
                Span current = new Span(
                        requiredInt(span, "x"),
                        requiredInt(span, "y"),
                        requiredInt(span, "minZ"),
                        requiredInt(span, "maxZ"));
                if (current.minZ() > current.maxZ()) {
                    throw new IllegalStateException("hull span has an inverted Z range");
                }
                if (previous != null && compare(previous, current) >= 0) {
                    throw new IllegalStateException("hull spans are not in canonical order");
                }
                if (previous != null
                        && previous.x() == current.x()
                        && previous.y() == current.y()
                        && (long) previous.maxZ() + 1 >= current.minZ()) {
                    throw new IllegalStateException("hull spans overlap or touch");
                }
                actualCells = Math.addExact(
                        actualCells, (long) current.maxZ() - current.minZ() + 1);
                JsonObject value = new JsonObject();
                value.addProperty("x", current.x());
                value.addProperty("y", current.y());
                value.addProperty("minZ", current.minZ());
                value.addProperty("maxZ", current.maxZ());
                spans.add(value);
                previous = current;
            }
            int finalIndex = spans.size() - 1;
            String expectedAfter = finalIndex < 0 ? "" : Integer.toString(finalIndex);
            if (!(response.get("after") instanceof String next)
                    || !next.equals(expectedAfter)
                    || next.equals(after) && spans.size() < expectedSpans) {
                throw new IllegalStateException("hull paging cursor did not advance");
            }
            after = next;
            if (!(response.get("hasMore") instanceof Boolean hasMore)) {
                throw new IllegalStateException("hull page hasMore is malformed");
            }
            if (hasMore != (spans.size() < expectedSpans)) {
                throw new IllegalStateException("hull page continuation metadata is inconsistent");
            }
            if (!hasMore) break;
            if (spans.size() > 131_072) {
                throw new IllegalStateException("hull page budget exceeded");
            }
        }
        if (spans.size() != expectedSpans) {
            throw new IllegalStateException("hull span count changed during paging");
        }
        if (actualCells != expectedCells) {
            throw new IllegalStateException(
                    "hull cardinality mismatch: expected " + expectedCells + ", got " + actualCells);
        }
        JsonObject result = new JsonObject();
        result.addProperty("available", true);
        result.addProperty("structureId", structureId.toString());
        result.addProperty("world", world);
        result.addProperty("ruleVersion", ruleVersion);
        result.addProperty("sourceRevision", revision);
        result.addProperty("spanCount", expectedSpans);
        result.addProperty("cellCount", expectedCells);
        result.addProperty("canonicalSpans", true);
        result.addProperty("metadataConsistent", true);
        result.addProperty("cardinalityConsistent", true);
        result.add("spans", spans);
        return result;
    }

    private JsonObject contains(UUID structureId, int x, int y, int z) {
        JsonObject result = snapshot(structureId);
        if (!result.get("available").getAsBoolean()) {
            result.addProperty("contains", false);
            return result;
        }
        boolean contains = false;
        for (JsonElement raw : result.getAsJsonArray("spans")) {
            JsonObject span = raw.getAsJsonObject();
            if (span.get("x").getAsInt() == x
                    && span.get("y").getAsInt() == y
                    && z >= span.get("minZ").getAsInt()
                    && z <= span.get("maxZ").getAsInt()) {
                contains = true;
                break;
            }
        }
        result.addProperty("x", x);
        result.addProperty("y", y);
        result.addProperty("z", z);
        result.addProperty("contains", contains);
        return result;
    }

    private static void requireIdentity(
            Map<?, ?> value,
            UUID structureId,
            String expectedWorld,
            Integer expectedRuleVersion,
            Long expectedRevision) {
        String actualStructureId = requiredString(value, "structureId");
        if (!actualStructureId.equals(structureId.toString())) {
            throw new IllegalStateException("hull structure identity changed");
        }
        String actualWorld = requiredWorld(value);
        int actualRuleVersion = requiredPositiveInt(value, "ruleVersion");
        long actualRevision = requiredLong(value, "sourceRevision");
        if (expectedWorld != null && !actualWorld.equals(expectedWorld)
                || expectedRuleVersion != null && actualRuleVersion != expectedRuleVersion
                || expectedRevision != null && actualRevision != expectedRevision) {
            throw new IllegalStateException("hull page metadata changed during paging");
        }
    }

    private static String requiredWorld(Map<?, ?> value) {
        String world = requiredString(value, "world");
        if (!world.matches("[a-z0-9_.-]+:[a-z0-9_./-]+")) {
            throw new IllegalStateException("world is not a namespaced identifier");
        }
        return world;
    }

    private static int compare(Span left, Span right) {
        int x = Integer.compare(left.x(), right.x());
        if (x != 0) return x;
        int y = Integer.compare(left.y(), right.y());
        if (y != 0) return y;
        return Integer.compare(left.minZ(), right.minZ());
    }

    private static JsonObject unavailable(UUID structureId) {
        JsonObject result = new JsonObject();
        result.addProperty("available", false);
        result.addProperty("structureId", structureId.toString());
        return result;
    }

    private static UUID requiredUuid(JsonObject arguments, String name) {
        String raw = requiredString(arguments, name);
        UUID id = UUID.fromString(raw);
        if (!id.toString().equals(raw)) {
            throw new IllegalArgumentException(name + " must be a canonical UUID");
        }
        return id;
    }

    private static int requiredCoordinate(JsonObject arguments, String name) {
        if (!arguments.has(name)
                || !arguments.get(name).isJsonPrimitive()
                || !arguments.get(name).getAsJsonPrimitive().isNumber()) {
            throw new IllegalArgumentException(name + " is required");
        }
        return arguments.get(name).getAsInt();
    }

    private static String requiredString(JsonObject arguments, String name) {
        if (!arguments.has(name) || !arguments.get(name).isJsonPrimitive()) {
            throw new IllegalArgumentException(name + " is required");
        }
        return arguments.get(name).getAsString();
    }

    private static String requiredString(Map<?, ?> value, String name) {
        Object raw = value.get(name);
        if (!(raw instanceof String string)) {
            throw new IllegalStateException(name + " is malformed");
        }
        return string;
    }

    private static int requiredInt(Map<?, ?> value, String name) {
        Object raw = value.get(name);
        if (!(raw instanceof Integer integer)) {
            throw new IllegalStateException(name + " is malformed");
        }
        return integer;
    }

    private static int requiredPositiveInt(Map<?, ?> value, String name) {
        int integer = requiredInt(value, name);
        if (integer < 1) {
            throw new IllegalStateException(name + " is malformed");
        }
        return integer;
    }

    private static int requiredNonNegativeInt(Map<?, ?> value, String name) {
        int integer = requiredInt(value, name);
        if (integer < 0) {
            throw new IllegalStateException(name + " is malformed");
        }
        return integer;
    }

    private static long requiredLong(Map<?, ?> value, String name) {
        Object raw = value.get(name);
        if (!(raw instanceof Long number) || number < 0) {
            throw new IllegalStateException(name + " is malformed");
        }
        return number;
    }

    private record Span(int x, int y, int minZ, int maxZ) {}
}
