package com.ouroboros.harness.adapter.coffer;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonNull;
import com.google.gson.JsonObject;
import com.ouroboros.coffer.core.AccessScope;
import com.ouroboros.coffer.core.CofferLock;
import com.ouroboros.coffer.core.ContainerPolicy;
import com.ouroboros.coffer.core.FlagSet;
import com.ouroboros.coffer.core.FlagType;
import com.ouroboros.coffer.core.LockType;
import com.ouroboros.coffer.core.OwnershipMode;

import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.function.Function;

final class CofferAdapterJson {
    private CofferAdapterJson() {
    }

    static String requiredString(JsonObject object, String name) {
        if (!object.has(name) || object.get(name).isJsonNull() || !object.get(name).isJsonPrimitive()) {
            throw new IllegalArgumentException(name + " is required");
        }
        String value = object.get(name).getAsString();
        if (value.isBlank()) throw new IllegalArgumentException(name + " is required");
        return value;
    }

    static int requiredInt(JsonObject object, String name) {
        if (!object.has(name) || !object.get(name).isJsonPrimitive()
                || !object.get(name).getAsJsonPrimitive().isNumber()) {
            throw new IllegalArgumentException(name + " is required");
        }
        return object.get(name).getAsInt();
    }

    static JsonArray requiredArray(JsonObject object, String name) {
        if (!object.has(name) || !object.get(name).isJsonArray()) {
            throw new IllegalArgumentException(name + " is required");
        }
        return object.getAsJsonArray(name);
    }

    static List<String> playerNames(JsonObject object, String name) {
        Set<String> players = new LinkedHashSet<>();
        for (JsonElement value : requiredArray(object, name)) {
            if (!value.isJsonPrimitive() || !value.getAsJsonPrimitive().isString()) {
                throw new IllegalArgumentException(name + " must contain player names");
            }
            String player = value.getAsString();
            if (player.isBlank()) throw new IllegalArgumentException(name + " must contain player names");
            if (!players.add(player)) throw new IllegalArgumentException("duplicate player: " + player);
        }
        return List.copyOf(players);
    }

    static java.util.Optional<Boolean> optionalBoolean(JsonObject object, String name) {
        if (!object.has(name) || object.get(name).isJsonNull()) return java.util.Optional.empty();
        JsonElement value = object.get(name);
        if (!value.isJsonPrimitive() || !value.getAsJsonPrimitive().isBoolean()) {
            throw new IllegalArgumentException(name + " must be a boolean or null");
        }
        return java.util.Optional.of(value.getAsBoolean());
    }

    static <T> T requiredOnlinePlayer(String name, Function<String, T> lookup) {
        T player = lookup.apply(name);
        if (player == null) throw new IllegalArgumentException("player is not online: " + name);
        return player;
    }

    static LockType lockType(JsonObject object) {
        String raw = requiredString(object, "type");
        return LockType.parse(raw).orElseThrow(() -> new IllegalArgumentException("unknown Coffer lock type: " + raw));
    }

    static FlagType flagType(JsonObject object) {
        String raw = requiredString(object, "flag");
        return FlagType.parse(raw).orElseThrow(() -> new IllegalArgumentException("unknown Coffer flag: " + raw));
    }

    static OwnershipMode ownershipMode(JsonObject object) {
        String raw = requiredString(object, "ownershipMode");
        return OwnershipMode.parse(raw)
                .orElseThrow(() -> new IllegalArgumentException("unknown Coffer ownership mode: " + raw));
    }

    static Set<AccessScope> accessScopes(JsonObject object) {
        if (!object.has("accessScopes")) return Set.of();
        Set<AccessScope> scopes = new HashSet<>();
        for (JsonElement value : requiredArray(object, "accessScopes")) {
            if (!value.isJsonPrimitive() || !value.getAsJsonPrimitive().isString()) {
                throw new IllegalArgumentException("accessScopes must contain scope names");
            }
            String raw = value.getAsString();
            AccessScope scope = AccessScope.parse(raw)
                    .orElseThrow(() -> new IllegalArgumentException("unknown Coffer access scope: " + raw));
            if (!scopes.add(scope)) throw new IllegalArgumentException("duplicate Coffer access scope: " + raw);
        }
        return Set.copyOf(scopes);
    }

    static JsonObject lockSnapshot(
            CofferLock lock,
            FlagSet flags,
            ContainerPolicy policy,
            JsonElement key) {
        JsonObject result = new JsonObject();
        result.addProperty("type", lock.type().serializedName());
        result.addProperty("owner", lock.owner().toString());
        result.addProperty("boundAtMillis", lock.boundAtMillis());
        JsonArray trusted = new JsonArray();
        lock.trusted().stream().map(UUID::toString).sorted().forEach(trusted::add);
        result.add("trusted", trusted);
        JsonObject flagOverrides = new JsonObject();
        for (FlagType flag : FlagType.values()) {
            flags.value(flag).ifPresent(value -> flagOverrides.addProperty(flag.serializedName(), value));
        }
        result.add("flagOverrides", flagOverrides);
        result.addProperty("ownershipMode", policy.ownershipMode().serializedName());
        JsonArray accessScopes = new JsonArray();
        policy.accessScopes().stream().map(AccessScope::serializedName).sorted().forEach(accessScopes::add);
        result.add("accessScopes", accessScopes);
        result.add("key", key == null ? JsonNull.INSTANCE : key);
        return result;
    }

    static JsonObject mutationResult(boolean updated, JsonElement lock, JsonArray pair) {
        JsonObject result = new JsonObject();
        result.addProperty("updated", updated);
        result.add("lock", lock == null ? JsonNull.INSTANCE : lock);
        result.add("pair", pair);
        return result;
    }

    static JsonObject pairEntry(int x, int y, int z, String block, JsonElement lock) {
        JsonObject entry = new JsonObject();
        entry.addProperty("x", x);
        entry.addProperty("y", y);
        entry.addProperty("z", z);
        entry.addProperty("block", block);
        JsonElement snapshot = lock == null ? JsonNull.INSTANCE : lock;
        entry.addProperty("bound", !snapshot.isJsonNull());
        entry.add("lock", snapshot);
        return entry;
    }
}
