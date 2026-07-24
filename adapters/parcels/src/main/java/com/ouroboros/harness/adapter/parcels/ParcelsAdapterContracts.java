package com.ouroboros.harness.adapter.parcels;

import java.nio.charset.StandardCharsets;
import java.util.Map;
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

    static String legacyRoom(
            UUID roomId, int minX, int minY, int minZ, int maxX, int maxY, int maxZ) {
        if (minX > maxX || minY > maxY || minZ > maxZ) {
            throw new IllegalArgumentException("room bounds are inverted");
        }
        return roomId + "," + minX + "," + minY + "," + minZ
                + "," + maxX + "," + maxY + "," + maxZ;
    }
}
