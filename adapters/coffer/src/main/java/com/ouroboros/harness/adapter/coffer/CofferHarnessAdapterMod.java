package com.ouroboros.harness.adapter.coffer;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.ouroboros.coffer.api.CofferApi;
import com.ouroboros.coffer.core.CofferLock;
import com.ouroboros.coffer.core.FlagSet;
import com.ouroboros.coffer.core.FlagType;
import com.ouroboros.harness.bridge.HarnessAdapter;
import com.ouroboros.harness.bridge.HarnessAdapters;
import net.fabricmc.api.ModInitializer;
import net.minecraft.core.BlockPos;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;

import java.util.HashSet;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

public final class CofferHarnessAdapterMod implements ModInitializer, HarnessAdapter {
    @Override
    public void onInitialize() {
        HarnessAdapters.register(this);
    }

    @Override
    public String id() {
        return "coffer";
    }

    @Override
    public JsonElement invoke(MinecraftServer server, String operation, JsonObject arguments) {
        ServerLevel level = server.overworld();
        BlockPos pos = requiredPosition(server, arguments);
        return switch (operation) {
            case "inspect" -> inspect(level, pos);
            case "set-trusted" -> setTrusted(server, level, pos, arguments);
            case "set-flag" -> setFlag(level, pos, arguments);
            case "can-open" -> canOpen(server, pos, arguments);
            default -> throw new IllegalArgumentException("unknown Coffer adapter operation: " + operation);
        };
    }

    private static JsonObject inspect(ServerLevel level, BlockPos pos) {
        CofferLock lock = CofferApi.getLock(level, pos)
                .orElseThrow(() -> new IllegalArgumentException("no Coffer lock at " + pos.toShortString()));
        JsonObject result = new JsonObject();
        result.addProperty("type", lock.type().serializedName());
        result.addProperty("owner", lock.owner().toString());
        result.addProperty("boundAtMillis", lock.boundAtMillis());
        JsonArray trusted = new JsonArray();
        lock.trusted().stream().map(UUID::toString).sorted().forEach(trusted::add);
        result.add("trusted", trusted);
        JsonObject flags = new JsonObject();
        FlagSet overrides = CofferApi.getFlagOverrides(level, pos).orElse(FlagSet.empty());
        for (FlagType flag : FlagType.values()) {
            overrides.value(flag).ifPresent(value -> flags.addProperty(flag.serializedName(), value));
        }
        result.add("flagOverrides", flags);
        return result;
    }

    private static JsonObject setTrusted(
            MinecraftServer server,
            ServerLevel level,
            BlockPos pos,
            JsonObject arguments) {
        JsonArray names = arguments.getAsJsonArray("players");
        if (names == null) throw new IllegalArgumentException("players is required");
        Set<UUID> trusted = new HashSet<>();
        names.forEach(value -> trusted.add(requiredPlayer(server, value.getAsString()).getUUID()));
        JsonObject result = new JsonObject();
        result.addProperty("updated", CofferApi.setTrusted(level, pos, Set.copyOf(trusted)));
        result.add("lock", inspect(level, pos));
        return result;
    }

    private static JsonObject setFlag(ServerLevel level, BlockPos pos, JsonObject arguments) {
        String rawFlag = requiredString(arguments, "flag");
        FlagType flag = FlagType.parse(rawFlag)
                .orElseThrow(() -> new IllegalArgumentException("unknown Coffer flag: " + rawFlag));
        Optional<Boolean> value = arguments.has("value") && !arguments.get("value").isJsonNull()
                ? Optional.of(arguments.get("value").getAsBoolean())
                : Optional.empty();
        JsonObject result = new JsonObject();
        result.addProperty("updated", CofferApi.setFlag(level, pos, flag, value));
        result.add("lock", inspect(level, pos));
        return result;
    }

    private static JsonObject canOpen(MinecraftServer server, BlockPos pos, JsonObject arguments) {
        ServerPlayer player = requiredPlayer(server, requiredString(arguments, "player"));
        JsonObject result = new JsonObject();
        result.addProperty("player", player.getPlainTextName());
        result.addProperty("allowed", CofferApi.canOpen(player, pos));
        return result;
    }

    private static ServerPlayer requiredPlayer(MinecraftServer server, String name) {
        ServerPlayer player = server.getPlayerList().getPlayerByName(name);
        if (player == null) throw new IllegalArgumentException("player is not online: " + name);
        return player;
    }

    private static int requiredInt(JsonObject object, String name) {
        if (!object.has(name)) throw new IllegalArgumentException(name + " is required");
        return object.get(name).getAsInt();
    }

    private static int optionalInt(JsonObject object, String name) {
        return object.has(name) ? object.get(name).getAsInt() : 0;
    }

    private static BlockPos requiredPosition(MinecraftServer server, JsonObject arguments) {
        if (arguments.has("relativeTo")) {
            BlockPos origin = requiredPlayer(server, arguments.get("relativeTo").getAsString()).blockPosition();
            return origin.offset(
                    optionalInt(arguments, "x"),
                    optionalInt(arguments, "y"),
                    optionalInt(arguments, "z"));
        }
        return new BlockPos(
                requiredInt(arguments, "x"),
                requiredInt(arguments, "y"),
                requiredInt(arguments, "z"));
    }

    private static String requiredString(JsonObject object, String name) {
        if (!object.has(name)) throw new IllegalArgumentException(name + " is required");
        return object.get(name).getAsString();
    }
}
