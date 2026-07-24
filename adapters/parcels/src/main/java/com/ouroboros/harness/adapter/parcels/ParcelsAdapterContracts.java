package com.ouroboros.harness.adapter.parcels;

import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;

final class ParcelsAdapterContracts {
    private ParcelsAdapterContracts() {
    }

    static UUID offlinePlayerId(String username) {
        if (username == null || !username.matches("[A-Za-z0-9_]{3,16}")) {
            throw new IllegalArgumentException("username must be a valid offline player name");
        }
        return UUID.nameUUIDFromBytes(
                ("OfflinePlayer:" + username).getBytes(StandardCharsets.UTF_8));
    }

    static Map<String, Object> patrolStatus(UUID player, boolean available) {
        if (!available) {
            return Map.of(
                    "available", false,
                    "playerId", player.toString(),
                    "aggregateId", player.toString());
        }
        return Map.ofEntries(
                Map.entry("available", true),
                Map.entry("playerId", player.toString()),
                Map.entry("aggregateId", player.toString()),
                Map.entry("principal", "player:" + player),
                Map.entry("state", "clear"),
                Map.entry("lastHostileAt", 0L),
                Map.entry("lastParticipationAt", 0L),
                Map.entry("taggedUntil", 0L),
                Map.entry("revision", 1L),
                Map.entry("afk", false),
                Map.entry("afkRevision", 1L));
    }

    static Map<String, Object> kinshipStatus(
            UUID requested,
            UUID groupMember,
            String groupPrincipal,
            boolean sessionAvailable) {
        Objects.requireNonNull(requested, "requested");
        Objects.requireNonNull(groupMember, "groupMember");
        if (groupPrincipal == null || !groupPrincipal.matches("[a-z][a-z0-9_-]*:[A-Za-z0-9._-]+")) {
            throw new IllegalArgumentException("groupPrincipal must be canonical");
        }
        boolean selectedMember = requested.equals(groupMember);
        String personal = "player:" + requested;
        if (!selectedMember) {
            return Map.ofEntries(
                    Map.entry("available", true),
                    Map.entry("verified", true),
                    Map.entry("playerId", requested.toString()),
                    Map.entry("aggregateId", requested.toString()),
                    Map.entry("principal", personal),
                    Map.entry("member", false),
                    Map.entry("canAdminister", false),
                    Map.entry("revision", 1L));
        }
        if (sessionAvailable) {
            return Map.ofEntries(
                    Map.entry("available", true),
                    Map.entry("verified", true),
                    Map.entry("playerId", requested.toString()),
                    Map.entry("aggregateId", requested.toString()),
                    Map.entry("principal", groupPrincipal),
                    Map.entry("member", true),
                    Map.entry("canAdminister", false),
                    Map.entry("revision", 7L));
        }
        LinkedHashMap<String, Object> result = new LinkedHashMap<>();
        result.put("available", false);
        result.put("verified", false);
        result.put("playerId", requested.toString());
        result.put("aggregateId", requested.toString());
        result.put("principal", personal);
        result.put("member", false);
        result.put("canAdminister", false);
        result.put("revision", 7L);
        result.put("lastKnownPrincipal", groupPrincipal);
        result.put("lastKnownMember", true);
        result.put("lastKnownCanAdminister", false);
        result.put("lastKnownRevision", 7L);
        return Map.copyOf(result);
    }

    static String legacyRoom(
            UUID roomId, int minX, int minY, int minZ, int maxX, int maxY, int maxZ) {
        if (minX > maxX || minY > maxY || minZ > maxZ) {
            throw new IllegalArgumentException("room bounds are inverted");
        }
        return roomId + "," + minX + "," + minY + "," + minZ
                + "," + maxX + "," + maxY + "," + maxZ;
    }
}
