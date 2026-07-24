package com.ouroboros.harness.adapter.rooms;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.ouroboros.harness.bridge.HarnessAdapter;
import com.ouroboros.harness.bridge.HarnessAdapters;
import java.util.List;
import java.util.Map;
import java.util.Optional;
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
            default -> throw new IllegalArgumentException(
                    "unknown Rooms adapter operation: " + operation);
        };
    }

    private JsonObject protocol() {
        Object raw = FabricLoader.getInstance().getObjectShare().get(KEY);
        JsonObject result = new JsonObject();
        result.addProperty("installed", raw instanceof Map<?, ?>);
        if (raw instanceof Map<?, ?> protocol) {
            result.addProperty("protocolVersion", protocol.get("protocolVersion") instanceof Integer
                    ? (Integer) protocol.get("protocolVersion") : -1);
            result.addProperty(
                    "eventSchemaVersion",
                    protocol.get("eventSchemaVersion") instanceof Integer
                            ? (Integer) protocol.get("eventSchemaVersion")
                            : -1);
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
        long revision = requiredLong(summary, "sourceRevision");
        int expectedSpans = requiredInt(summary, "spanCount");
        JsonArray spans = new JsonArray();
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
            Object rawItems = response.get("items");
            if (!(rawItems instanceof List<?> items)) {
                throw new IllegalStateException("hull page items are malformed");
            }
            for (Object item : items) {
                if (!(item instanceof Map<?, ?> span)) {
                    throw new IllegalStateException("hull span is malformed");
                }
                JsonObject value = new JsonObject();
                value.addProperty("x", requiredInt(span, "x"));
                value.addProperty("y", requiredInt(span, "y"));
                value.addProperty("minZ", requiredInt(span, "minZ"));
                value.addProperty("maxZ", requiredInt(span, "maxZ"));
                spans.add(value);
            }
            if (!(response.get("after") instanceof String next)
                    || next.equals(after) && spans.size() < expectedSpans) {
                throw new IllegalStateException("hull paging cursor did not advance");
            }
            after = next;
            if (!Boolean.TRUE.equals(response.get("hasMore"))) break;
            if (spans.size() > 131_072) {
                throw new IllegalStateException("hull page budget exceeded");
            }
        }
        if (spans.size() != expectedSpans) {
            throw new IllegalStateException("hull span count changed during paging");
        }
        JsonObject result = new JsonObject();
        result.addProperty("available", true);
        result.addProperty("structureId", structureId.toString());
        result.addProperty("world", requiredString(summary, "world"));
        result.addProperty("ruleVersion", requiredInt(summary, "ruleVersion"));
        result.addProperty("sourceRevision", revision);
        result.addProperty("spanCount", expectedSpans);
        result.addProperty("cellCount", requiredLong(summary, "cellCount"));
        result.add("spans", spans);
        return result;
    }

    private static JsonObject unavailable(UUID structureId) {
        JsonObject result = new JsonObject();
        result.addProperty("available", false);
        result.addProperty("structureId", structureId.toString());
        return result;
    }

    private static UUID requiredUuid(JsonObject arguments, String name) {
        return UUID.fromString(requiredString(arguments, name));
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

    private static long requiredLong(Map<?, ?> value, String name) {
        Object raw = value.get(name);
        if (!(raw instanceof Long number) || number < 0) {
            throw new IllegalStateException(name + " is malformed");
        }
        return number;
    }
}
