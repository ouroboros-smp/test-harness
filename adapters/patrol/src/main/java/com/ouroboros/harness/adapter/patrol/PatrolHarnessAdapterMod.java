package com.ouroboros.harness.adapter.patrol;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.ouroboros.harness.bridge.HarnessAdapter;
import com.ouroboros.harness.bridge.HarnessAdapters;
import java.math.BigDecimal;
import java.util.UUID;
import net.fabricmc.api.ModInitializer;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerLifecycleEvents;
import net.fabricmc.loader.api.FabricLoader;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerPlayer;

/** Harness-only bridge from named online players to Patrol's public ObjectShare contract. */
public final class PatrolHarnessAdapterMod implements ModInitializer, HarnessAdapter {
    private final PatrolConflictV2Client conflict = new PatrolConflictV2Client(
            () -> FabricLoader.getInstance().getObjectShare().get(PatrolConflictV2Client.KEY));

    @Override
    public void onInitialize() {
        HarnessAdapters.register(this);
        ServerLifecycleEvents.SERVER_STOPPING.register(ignored -> conflict.close());
    }

    @Override
    public String id() {
        return "patrol";
    }

    @Override
    public JsonElement invoke(
            MinecraftServer server, String operation, JsonObject arguments) {
        return switch (operation) {
            case "protocol" -> conflict.describe();
            case "status" -> conflict.status(requiredPlayer(server, arguments).getUUID());
            case "replay" -> conflict.replay(
                    requiredPlayer(server, arguments).getUUID(),
                    optionalNonNegativeLong(arguments, "afterRevision"));
            case "reconcile" -> conflict.reconcile(
                    requiredPlayer(server, arguments).getUUID(),
                    optionalNonNegativeLong(arguments, "afterRevision"));
            case "events" -> conflict.events();
            case "clear-events" -> conflict.clearEvents();
            default -> throw new IllegalArgumentException(
                    "unknown Patrol adapter operation: " + operation);
        };
    }

    private static ServerPlayer requiredPlayer(
            MinecraftServer server, JsonObject arguments) {
        if (!arguments.has("player") || !arguments.get("player").isJsonPrimitive()) {
            throw new IllegalArgumentException("player is required");
        }
        String name = arguments.get("player").getAsString();
        ServerPlayer player = server.getPlayerList().getPlayerByName(name);
        if (player == null) {
            throw new IllegalArgumentException("player is not online: " + name);
        }
        return player;
    }

    private static long optionalNonNegativeLong(JsonObject arguments, String name) {
        if (!arguments.has(name)) return 0L;
        try {
            long value = new BigDecimal(arguments.get(name).getAsString()).longValueExact();
            if (value < 0L) throw new ArithmeticException("negative");
            return value;
        } catch (ArithmeticException | NumberFormatException failure) {
            throw new IllegalArgumentException(
                    name + " must be a non-negative exact integer", failure);
        }
    }
}
