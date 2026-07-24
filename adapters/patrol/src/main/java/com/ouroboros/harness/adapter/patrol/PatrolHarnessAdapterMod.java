package com.ouroboros.harness.adapter.patrol;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.ouroboros.harness.bridge.HarnessAdapter;
import com.ouroboros.harness.bridge.HarnessAdapters;
import java.math.BigDecimal;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.util.List;
import java.util.UUID;
import java.util.function.Consumer;
import net.fabricmc.api.ModInitializer;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerLifecycleEvents;
import net.fabricmc.loader.api.FabricLoader;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.server.players.SleepStatus;
import net.minecraft.world.entity.projectile.arrow.Arrow;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.Items;

/** Harness-only bridge from named online players to Patrol's public ObjectShare contract. */
public final class PatrolHarnessAdapterMod implements ModInitializer, HarnessAdapter {
    private final PatrolConflictV2Client conflict = new PatrolConflictV2Client(
            () -> FabricLoader.getInstance().getObjectShare().get(PatrolConflictV2Client.KEY));
    private final PatrolConflictV2Client combat = PatrolConflictV2Client.combatV3(
            () -> FabricLoader.getInstance().getObjectShare().get(PatrolConflictV2Client.KEY_V3));
    private AutoCloseable authorityOutage;

    @Override
    public void onInitialize() {
        HarnessAdapters.register(this);
        ServerLifecycleEvents.SERVER_STOPPING.register(ignored -> {
            conflict.close();
            combat.close();
            closeAuthorityOutage();
        });
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
            case "combat-protocol" -> combat.describe();
            case "combat-status" -> combat.status(requiredPlayer(server, arguments).getUUID());
            case "combat-replay" -> combat.replay(
                    requiredPlayer(server, arguments).getUUID(),
                    optionalNonNegativeLong(arguments, "afterRevision"));
            case "combat-reconcile" -> combat.reconcile(
                    requiredPlayer(server, arguments).getUUID(),
                    optionalNonNegativeLong(arguments, "afterRevision"));
            case "combat-events" -> combat.events();
            case "combat-clear-events" -> combat.clearEvents();
            case "combat-tagged" -> combatTagged(server, arguments);
            case "projectile-hit" -> projectileHit(server, arguments);
            case "afk-benefits" -> afkBenefits(server, arguments);
            case "authority-outage-start" -> startAuthorityOutage(server);
            case "authority-outage-stop" -> stopAuthorityOutage();
            default -> throw new IllegalArgumentException(
                    "unknown Patrol adapter operation: " + operation);
        };
    }

    private JsonElement combatTagged(MinecraftServer server, JsonObject arguments) {
        JsonObject response = combat.status(requiredPlayer(server, arguments).getUUID())
                .getAsJsonObject();
        JsonObject status = response.getAsJsonObject("status");
        long now = System.currentTimeMillis();
        long taggedUntil = status.get("taggedUntil").getAsLong();
        String state = status.get("state").getAsString();
        response.addProperty("now", now);
        response.addProperty("combatTagged",
                !"clear".equals(state) || taggedUntil > now);
        response.addProperty("remainingMillis", Math.max(0L, taggedUntil - now));
        return response;
    }

    private static JsonElement projectileHit(
            MinecraftServer server, JsonObject arguments) {
        ServerPlayer attacker = requiredNamedPlayer(server, arguments, "attacker");
        ServerPlayer victim = requiredNamedPlayer(server, arguments, "victim");
        float before = victim.getHealth();
        Arrow arrow = new Arrow(
                victim.level(), attacker, new ItemStack(Items.ARROW), new ItemStack(Items.BOW));
        boolean allowed = victim.hurtServer(
                victim.level(), victim.damageSources().arrow(arrow, attacker), 2.0F);
        JsonObject result = new JsonObject();
        result.addProperty("allowed", allowed);
        result.addProperty("healthBefore", before);
        result.addProperty("healthAfter", victim.getHealth());
        return result;
    }

    private static JsonElement afkBenefits(
            MinecraftServer server, JsonObject arguments) {
        ServerPlayer player = requiredPlayer(server, arguments);
        ServerPlayer peer = requiredNamedPlayer(server, arguments, "peer");
        SleepStatus sleep = new SleepStatus();
        sleep.update(List.of(player, peer));
        JsonObject result = new JsonObject();
        result.addProperty("sleepersNeededAt100Percent", sleep.sleepersNeeded(100));
        result.addProperty("sleepExcluded", sleep.sleepersNeeded(100) == 1);
        result.addProperty("phantomSuppressed",
                invokeAfkHook("phantomSuppressed", player));
        result.addProperty("damageProtected",
                invokeAfkHook("damageProtected", player));
        return result;
    }

    private JsonElement startAuthorityOutage(MinecraftServer server) {
        if (authorityOutage != null) {
            throw new IllegalStateException("Patrol authority outage is already active");
        }
        Object service = patrolService();
        Consumer<Object> failure = ignored -> {
            throw new IllegalStateException("injected harness persistence failure");
        };
        authorityOutage = (AutoCloseable) invoke(
                service, "addStateListener", new Class<?>[] {Consumer.class}, failure);
        invoke(service, "onRespawn", new Class<?>[] {UUID.class, long.class},
                UUID.fromString("00000000-0000-0000-0000-000000000038"),
                System.currentTimeMillis());
        boolean durable = (Boolean) invoke(
                service, "flushPendingState", new Class<?>[0]);
        JsonObject result = new JsonObject();
        result.addProperty("durabilityAvailable", durable);
        result.addProperty("injected", true);
        return result;
    }

    private JsonElement stopAuthorityOutage() {
        closeAuthorityOutage();
        Object service = patrolService();
        boolean durable = (Boolean) invoke(
                service, "flushPendingState", new Class<?>[0]);
        JsonObject result = new JsonObject();
        result.addProperty("durabilityAvailable", durable);
        result.addProperty("injected", false);
        return result;
    }

    private void closeAuthorityOutage() {
        if (authorityOutage == null) return;
        try {
            authorityOutage.close();
        } catch (Exception failure) {
            throw new IllegalStateException("could not close Patrol authority outage", failure);
        } finally {
            authorityOutage = null;
        }
    }

    private static boolean invokeAfkHook(String name, ServerPlayer player) {
        try {
            Class<?> hooks = Class.forName("patrol.fabric.PatrolAfkHooks");
            Method method = hooks.getDeclaredMethod(name, ServerPlayer.class);
            method.setAccessible(true);
            return (Boolean) method.invoke(null, player);
        } catch (ReflectiveOperationException failure) {
            throw new IllegalStateException("Patrol AFK hook is unavailable: " + name, failure);
        }
    }

    private static Object patrolService() {
        Object mod = FabricLoader.getInstance()
                .getEntrypoints("main", ModInitializer.class).stream()
                .filter(entrypoint -> entrypoint.getClass().getName()
                        .equals("patrol.fabric.PatrolFabricMod"))
                .findFirst()
                .orElseThrow(() -> new IllegalStateException(
                        "Patrol Fabric entrypoint is unavailable"));
        Object runtime = field(mod, "runtime");
        if (runtime == null) throw new IllegalStateException("Patrol runtime is unavailable");
        return invoke(runtime, "service", new Class<?>[0]);
    }

    private static Object field(Object target, String name) {
        try {
            var field = target.getClass().getDeclaredField(name);
            field.setAccessible(true);
            return field.get(target);
        } catch (ReflectiveOperationException failure) {
            throw new IllegalStateException("Patrol field is unavailable: " + name, failure);
        }
    }

    private static Object invoke(
            Object target, String name, Class<?>[] parameterTypes, Object... arguments) {
        try {
            Method method = target.getClass().getDeclaredMethod(name, parameterTypes);
            method.setAccessible(true);
            return method.invoke(target, arguments);
        } catch (InvocationTargetException failure) {
            Throwable cause = failure.getCause();
            if (cause instanceof RuntimeException runtime) throw runtime;
            throw new IllegalStateException("Patrol invocation failed: " + name, cause);
        } catch (ReflectiveOperationException failure) {
            throw new IllegalStateException("Patrol method is unavailable: " + name, failure);
        }
    }

    private static ServerPlayer requiredPlayer(
            MinecraftServer server, JsonObject arguments) {
        return requiredNamedPlayer(server, arguments, "player");
    }

    private static ServerPlayer requiredNamedPlayer(
            MinecraftServer server, JsonObject arguments, String argument) {
        if (!arguments.has(argument) || !arguments.get(argument).isJsonPrimitive()) {
            throw new IllegalArgumentException(argument + " is required");
        }
        String name = arguments.get(argument).getAsString();
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
