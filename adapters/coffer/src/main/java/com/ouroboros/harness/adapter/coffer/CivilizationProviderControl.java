package com.ouroboros.harness.adapter.coffer;

import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.BiPredicate;
import java.util.function.Function;

final class CivilizationProviderControl {
    private CivilizationProviderControl() {
    }

    static Object replacement(String provider, String mode, Object original, UUID player) {
        if (!List.of("structures", "principals", "continuity").contains(provider)) {
            throw new IllegalArgumentException("unknown provider: " + provider);
        }
        if ("original".equals(mode)) return original;
        if ("missing".equals(mode)) return null;
        if ("malformed".equals(mode)) return Map.of("protocolVersion", 1);

        return switch (provider) {
            case "structures" -> structureReplacement(mode, original, player);
            case "principals" -> principalReplacement(mode, original);
            case "continuity" -> continuityReplacement(mode, original);
            default -> throw new AssertionError("validated provider was not handled");
        };
    }

    private static Object structureReplacement(String mode, Object original, UUID player) {
        if (!List.of("resident", "transferred").contains(mode)) {
            throw new IllegalArgumentException("unsupported provider control: structures/" + mode);
        }
        if (player == null) {
            throw new IllegalArgumentException(mode + " provider control requires a player");
        }
        Map<?, ?> protocol = requiredProtocol(original, "structures");
        Object rawAt = protocol.get("at");
        if (!(rawAt instanceof Function<?, ?> function)) {
            throw new IllegalStateException("structure provider has no at function");
        }

        LinkedHashMap<Object, Object> controlled = new LinkedHashMap<>(protocol);
        controlled.put("at", "resident".equals(mode)
                ? residentProjection(function, player)
                : transferredProjection(function, player));
        return Collections.unmodifiableMap(controlled);
    }

    private static Object principalReplacement(String mode, Object original) {
        Map<?, ?> protocol = requiredProtocol(original, "principals");
        LinkedHashMap<Object, Object> controlled = new LinkedHashMap<>(protocol);
        switch (mode) {
            case "stale" -> {
                BiPredicate<String, UUID> unavailable = (principal, player) -> false;
                controlled.put("isMember", unavailable);
                controlled.put("canAdminister", unavailable);
            }
            case "throwing" -> {
                Function<UUID, String> throwingResolve = ignored -> {
                    throw injectedFailure("principal resolve");
                };
                BiPredicate<String, UUID> throwingPredicate = (principal, player) -> {
                    throw injectedFailure("principal authorization");
                };
                controlled.put("resolve", throwingResolve);
                controlled.put("isMember", throwingPredicate);
                controlled.put("canAdminister", throwingPredicate);
            }
            default -> throw new IllegalArgumentException(
                    "unsupported provider control: principals/" + mode);
        }
        return Collections.unmodifiableMap(controlled);
    }

    private static Object continuityReplacement(String mode, Object original) {
        Map<?, ?> protocol = requiredProtocol(original, "continuity");
        String operation = switch (mode) {
            case "restore-throwing" -> "restore";
            case "acknowledge-throwing" -> "acknowledge";
            default -> throw new IllegalArgumentException(
                    "unsupported provider control: continuity/" + mode);
        };
        LinkedHashMap<Object, Object> controlled = new LinkedHashMap<>(protocol);
        Function<Map<String, Object>, Boolean> throwing = ignored -> {
            throw injectedFailure("continuity " + operation);
        };
        controlled.put(operation, throwing);
        return Collections.unmodifiableMap(controlled);
    }

    @SuppressWarnings("unchecked")
    private static Function<Map<String, Object>, Map<String, Object>> residentProjection(
            Function<?, ?> rawAt, UUID player) {
        Function<Map<String, Object>, Map<String, Object>> at =
                (Function<Map<String, Object>, Map<String, Object>>) rawAt;
        return request -> {
            Map<String, Object> structure = at.apply(request);
            if (structure == null || structure.isEmpty()) return structure;
            LinkedHashMap<String, Object> projected = new LinkedHashMap<>(structure);
            List<String> residents = new ArrayList<>();
            Object existing = structure.get("residents");
            if (existing instanceof Iterable<?> values) {
                values.forEach(value -> residents.add(String.valueOf(value)));
            }
            String selected = player.toString();
            if (!residents.contains(selected)) residents.add(selected);
            projected.put("residents", List.copyOf(residents));
            return Collections.unmodifiableMap(projected);
        };
    }

    @SuppressWarnings("unchecked")
    private static Function<Map<String, Object>, Map<String, Object>> transferredProjection(
            Function<?, ?> rawAt, UUID player) {
        Function<Map<String, Object>, Map<String, Object>> at =
                (Function<Map<String, Object>, Map<String, Object>>) rawAt;
        return request -> {
            Map<String, Object> structure = at.apply(request);
            if (structure == null || structure.isEmpty()) return structure;
            LinkedHashMap<String, Object> projected = new LinkedHashMap<>(structure);
            projected.put("owner", "player:" + player);
            return Collections.unmodifiableMap(projected);
        };
    }

    private static IllegalStateException injectedFailure(String operation) {
        return new IllegalStateException("harness-injected " + operation + " failure");
    }

    private static Map<?, ?> requiredProtocol(Object original, String provider) {
        if (!(original instanceof Map<?, ?> protocol)) {
            throw new IllegalStateException(provider + " provider is not published");
        }
        return protocol;
    }
}
