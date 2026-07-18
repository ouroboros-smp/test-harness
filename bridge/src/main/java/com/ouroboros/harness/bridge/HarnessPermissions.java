package com.ouroboros.harness.bridge;

import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import me.lucko.fabric.api.permissions.v0.PermissionCheckEvent;
import net.fabricmc.fabric.api.util.TriState;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.server.level.ServerPlayer;

/** Test-only per-player permission provider with an explicit DEFAULT state. */
final class HarnessPermissions {
    private final Map<UUID, Map<String, TriState>> decisions = new ConcurrentHashMap<>();

    void register() {
        PermissionCheckEvent.EVENT.register((source, permission) -> {
            if (!(source instanceof CommandSourceStack commandSource)
                    || !(commandSource.getEntity() instanceof ServerPlayer player)) {
                return TriState.DEFAULT;
            }
            return decisions.getOrDefault(player.getUUID(), Map.of())
                    .getOrDefault(permission, TriState.DEFAULT);
        });
    }

    void set(UUID playerId, String permission, TriState decision) {
        if (decision == TriState.DEFAULT) {
            decisions.computeIfPresent(playerId, (ignored, values) -> {
                values.remove(permission);
                return values.isEmpty() ? null : values;
            });
            return;
        }
        decisions.computeIfAbsent(playerId, ignored -> new ConcurrentHashMap<>()).put(permission, decision);
    }
}
