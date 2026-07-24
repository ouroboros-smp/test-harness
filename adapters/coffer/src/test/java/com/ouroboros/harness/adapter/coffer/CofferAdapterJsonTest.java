package com.ouroboros.harness.adapter.coffer;

import com.google.gson.JsonArray;
import com.google.gson.JsonNull;
import com.google.gson.JsonObject;
import com.ouroboros.coffer.core.AccessScope;
import com.ouroboros.coffer.core.CofferLock;
import com.ouroboros.coffer.core.ContainerPolicy;
import com.ouroboros.coffer.core.FlagSet;
import com.ouroboros.coffer.core.FlagType;
import com.ouroboros.coffer.core.LockType;
import com.ouroboros.coffer.core.OwnershipMode;
import org.junit.jupiter.api.Test;

import java.util.Set;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class CofferAdapterJsonTest {
    @Test
    void validatesArgumentsForEveryOperation() {
        for (String operation : Set.of("inspect", "inspect-pair", "clear", "inspect-registry")) {
            assertDoesNotThrow(() -> CofferHarnessAdapterMod.validateOperation(operation, new JsonObject()));
        }

        JsonObject bind = object("type", "private", "ownerPlayer", "Owner");
        JsonObject keyBind = object(
                "type", "key", "ownerPlayer", "Owner", "keyFromPlayer", "KeyHolder");
        JsonObject trusted = new JsonObject();
        JsonArray players = new JsonArray();
        players.add("TrustedOne");
        players.add("TrustedTwo");
        trusted.add("players", players);
        JsonObject flag = object("flag", "hoppers");
        flag.addProperty("value", false);
        JsonObject resetFlag = object("flag", "copper_golems");
        resetFlag.add("value", JsonNull.INSTANCE);
        JsonObject policy = object("ownershipMode", "premises");
        JsonArray scopes = new JsonArray();
        scopes.add("structure_residents");
        policy.add("accessScopes", scopes);
        JsonObject player = object("player", "OnlinePlayer");

        assertDoesNotThrow(() -> CofferHarnessAdapterMod.validateOperation("bind", bind));
        assertDoesNotThrow(() -> CofferHarnessAdapterMod.validateOperation("bind", keyBind));
        assertDoesNotThrow(() -> CofferHarnessAdapterMod.validateOperation("set-trusted", trusted));
        assertDoesNotThrow(() -> CofferHarnessAdapterMod.validateOperation("set-flag", flag));
        assertDoesNotThrow(() -> CofferHarnessAdapterMod.validateOperation("set-flag", resetFlag));
        assertDoesNotThrow(() -> CofferHarnessAdapterMod.validateOperation("set-policy", policy));
        for (String operation : Set.of("can-open", "protection", "civilization")) {
            assertDoesNotThrow(() -> CofferHarnessAdapterMod.validateOperation(operation, player));
        }
        assertDoesNotThrow(() -> CofferHarnessAdapterMod.validateOperation(
                "provider-control", object("provider", "principals", "mode", "stale")));
        assertDoesNotThrow(() -> CofferHarnessAdapterMod.validateOperation(
                "provider-control",
                object("provider", "structures", "mode", "resident", "player", "OnlinePlayer")));
        assertDoesNotThrow(() -> CofferHarnessAdapterMod.validateOperation(
                "provider-control", object("provider", "protection", "mode", "deny-break")));
        assertDoesNotThrow(() -> CofferHarnessAdapterMod.validateOperation(
                "provider-control", object("provider", "protection", "mode", "throwing")));
        assertDoesNotThrow(() -> CofferHarnessAdapterMod.validateOperation(
                "provider-control", object("provider", "all", "mode", "original")));
    }

    @Test
    void parsesEveryMutatorArgumentFamily() {
        JsonObject bind = new JsonObject();
        bind.addProperty("type", "key");
        assertEquals(LockType.KEY, CofferAdapterJson.lockType(bind));

        JsonObject flag = new JsonObject();
        flag.addProperty("flag", "hoppers");
        assertEquals(FlagType.HOPPERS, CofferAdapterJson.flagType(flag));

        JsonObject policy = new JsonObject();
        policy.addProperty("ownershipMode", "premises");
        JsonArray scopes = new JsonArray();
        scopes.add("structure_residents");
        scopes.add("kinship_members");
        policy.add("accessScopes", scopes);
        assertEquals(OwnershipMode.PREMISES, CofferAdapterJson.ownershipMode(policy));
        assertEquals(Set.of(AccessScope.STRUCTURE_RESIDENTS, AccessScope.KINSHIP_MEMBERS),
                CofferAdapterJson.accessScopes(policy));
    }

    @Test
    void rejectsInvalidArguments() {
        assertThrows(IllegalArgumentException.class, () -> CofferAdapterJson.requiredString(new JsonObject(), "player"));
        JsonObject invalid = new JsonObject();
        invalid.addProperty("type", "combination");
        assertThrows(IllegalArgumentException.class, () -> CofferAdapterJson.lockType(invalid));
        JsonObject duplicate = new JsonObject();
        JsonArray scopes = new JsonArray();
        scopes.add("kinship_members");
        scopes.add("kinship_members");
        duplicate.add("accessScopes", scopes);
        assertThrows(IllegalArgumentException.class, () -> CofferAdapterJson.accessScopes(duplicate));
        JsonObject nonStringScope = new JsonObject();
        JsonArray nonStringScopes = new JsonArray();
        nonStringScopes.add(42);
        nonStringScope.add("accessScopes", nonStringScopes);
        assertThrows(IllegalArgumentException.class, () -> CofferAdapterJson.accessScopes(nonStringScope));

        assertThrows(IllegalArgumentException.class,
                () -> CofferHarnessAdapterMod.validateOperation("unknown", new JsonObject()));
        assertThrows(IllegalArgumentException.class,
                () -> CofferHarnessAdapterMod.validateOperation(
                        "bind", object("type", "key", "ownerPlayer", "Owner")));

        JsonObject invalidPlayers = new JsonObject();
        JsonArray nonNames = new JsonArray();
        nonNames.add(42);
        invalidPlayers.add("players", nonNames);
        assertThrows(IllegalArgumentException.class,
                () -> CofferHarnessAdapterMod.validateOperation("set-trusted", invalidPlayers));

        JsonObject invalidFlag = object("flag", "hoppers", "value", "false");
        assertThrows(IllegalArgumentException.class,
                () -> CofferHarnessAdapterMod.validateOperation("set-flag", invalidFlag));
        assertThrows(IllegalArgumentException.class,
                () -> CofferHarnessAdapterMod.validateOperation(
                        "provider-control", object("provider", "unknown", "mode", "missing")));
        assertThrows(IllegalArgumentException.class,
                () -> CofferHarnessAdapterMod.validateOperation(
                        "provider-control", object("provider", "structures", "mode", "resident")));
        assertThrows(IllegalArgumentException.class,
                () -> CofferHarnessAdapterMod.validateOperation(
                        "provider-control", object("provider", "protection", "mode", "missing")));
    }

    @Test
    void onlinePlayerResolutionReportsMissingPlayers() {
        assertEquals("resolved", CofferAdapterJson.requiredOnlinePlayer(
                "Online", name -> name.equals("Online") ? "resolved" : null));
        IllegalArgumentException failure = assertThrows(IllegalArgumentException.class,
                () -> CofferAdapterJson.requiredOnlinePlayer("Missing", ignored -> null));
        assertTrue(failure.getMessage().contains("player is not online: Missing"));
    }

    @Test
    void responseSchemaIncludesCompleteLockAndPair() {
        UUID owner = UUID.fromString("10000000-0000-0000-0000-000000000001");
        UUID trusted = UUID.fromString("20000000-0000-0000-0000-000000000002");
        JsonObject key = new JsonObject();
        key.addProperty("id", "minecraft:tripwire_hook");
        JsonObject lock = CofferAdapterJson.lockSnapshot(
                new CofferLock(LockType.KEY, owner, Set.of(trusted), 42L),
                FlagSet.empty().with(FlagType.HOPPERS, false),
                new ContainerPolicy(OwnershipMode.PREMISES, Set.of(AccessScope.KINSHIP_MEMBERS)),
                key);
        JsonArray pair = new JsonArray();
        pair.add(CofferAdapterJson.pairEntry(4, 70, -8, "minecraft:chest", lock));
        JsonObject response = CofferAdapterJson.mutationResult(true, lock, pair);

        assertTrue(response.get("updated").getAsBoolean());
        assertEquals("key", response.getAsJsonObject("lock").get("type").getAsString());
        assertEquals(owner.toString(), response.getAsJsonObject("lock").get("owner").getAsString());
        assertEquals(42L, response.getAsJsonObject("lock").get("boundAtMillis").getAsLong());
        assertFalse(response.getAsJsonObject("lock").getAsJsonObject("flagOverrides").get("hoppers").getAsBoolean());
        assertEquals("premises", response.getAsJsonObject("lock").get("ownershipMode").getAsString());
        assertEquals(1, response.getAsJsonArray("pair").size());
        JsonObject pairEntry = response.getAsJsonArray("pair").get(0).getAsJsonObject();
        assertTrue(pairEntry.get("bound").getAsBoolean());
        assertEquals(4, pairEntry.get("x").getAsInt());
        assertEquals(70, pairEntry.get("y").getAsInt());
        assertEquals(-8, pairEntry.get("z").getAsInt());
        assertEquals("minecraft:chest", pairEntry.get("block").getAsString());
        assertEquals("key", pairEntry.getAsJsonObject("lock").get("type").getAsString());

        JsonObject unboundPairEntry =
                CofferAdapterJson.pairEntry(5, 70, -8, "minecraft:air", JsonNull.INSTANCE);
        assertFalse(unboundPairEntry.get("bound").getAsBoolean());
        assertEquals("minecraft:air", unboundPairEntry.get("block").getAsString());
        assertEquals(JsonNull.INSTANCE, unboundPairEntry.get("lock"));

        JsonObject cleared = CofferAdapterJson.mutationResult(true, null, new JsonArray());
        assertEquals(JsonNull.INSTANCE, cleared.get("lock"));
    }

    @Test
    void operationCatalogIsComplete() {
        assertEquals(Set.of(
                "inspect", "inspect-pair", "bind", "set-trusted", "set-flag", "set-policy",
                "clear", "can-open", "protection", "inspect-registry", "civilization",
                "provider-control"),
                CofferHarnessAdapterMod.SUPPORTED_OPERATIONS);
    }

    private static JsonObject object(String... entries) {
        JsonObject object = new JsonObject();
        for (int index = 0; index < entries.length; index += 2) {
            object.addProperty(entries[index], entries[index + 1]);
        }
        return object;
    }
}
