package com.ouroboros.harness.bridge;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import net.minecraft.server.MinecraftServer;

/**
 * Extension point implemented by harness-only consumer adapter mods.
 * Consumer production jars must never depend on this interface.
 */
public interface HarnessAdapter {
    String id();

    JsonElement invoke(MinecraftServer server, String operation, JsonObject arguments) throws Exception;
}
