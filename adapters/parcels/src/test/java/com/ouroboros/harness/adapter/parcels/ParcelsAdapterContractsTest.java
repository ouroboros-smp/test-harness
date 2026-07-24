package com.ouroboros.harness.adapter.parcels;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.UUID;
import org.junit.jupiter.api.Test;

class ParcelsAdapterContractsTest {
    @Test
    void offlinePlayerIdentityMatchesMinecraft() {
        assertEquals(
                UUID.fromString("b50ad385-829d-3141-a216-7e7d7539ba7f"),
                ParcelsAdapterContracts.offlinePlayerId("Notch"));
        assertThrows(IllegalArgumentException.class,
                () -> ParcelsAdapterContracts.offlinePlayerId("../bad"));
    }

    @Test
    void patrolStatusIsStrictAndAvailabilityAware() {
        UUID player = UUID.randomUUID();
        var available = ParcelsAdapterContracts.patrolStatus(player, true);
        assertTrue((Boolean) available.get("available"));
        assertEquals(player.toString(), available.get("aggregateId"));
        assertEquals("player:" + player, available.get("principal"));
        assertEquals(1L, available.get("revision"));
        assertEquals(false, available.get("afk"));

        var unavailable = ParcelsAdapterContracts.patrolStatus(player, false);
        assertFalse((Boolean) unavailable.get("available"));
        assertEquals(3, unavailable.size());
    }

    @Test
    void kinshipStatusSeparatesSessionAuthorityFromDurableMembership() {
        UUID player = UUID.randomUUID();
        String principal = "kinship:family-42";

        var online = ParcelsAdapterContracts.kinshipStatus(
                player, player, principal, true);
        assertTrue((Boolean) online.get("available"));
        assertTrue((Boolean) online.get("verified"));
        assertTrue((Boolean) online.get("member"));
        assertEquals(principal, online.get("principal"));
        assertEquals(7L, online.get("revision"));

        var offline = ParcelsAdapterContracts.kinshipStatus(
                player, player, principal, false);
        assertFalse((Boolean) offline.get("available"));
        assertFalse((Boolean) offline.get("verified"));
        assertFalse((Boolean) offline.get("member"));
        assertEquals("player:" + player, offline.get("principal"));
        assertEquals(principal, offline.get("lastKnownPrincipal"));
        assertEquals(true, offline.get("lastKnownMember"));
        assertEquals(7L, offline.get("lastKnownRevision"));

        UUID unrelated = UUID.randomUUID();
        var personal = ParcelsAdapterContracts.kinshipStatus(
                unrelated, player, principal, false);
        assertTrue((Boolean) personal.get("available"));
        assertTrue((Boolean) personal.get("verified"));
        assertFalse((Boolean) personal.get("member"));
        assertEquals("player:" + unrelated, personal.get("principal"));
    }

    @Test
    void legacyRoomRejectsInvertedBounds() {
        UUID room = UUID.randomUUID();
        assertEquals(room + ",1,2,3,4,5,6",
                ParcelsAdapterContracts.legacyRoom(room, 1, 2, 3, 4, 5, 6));
        assertThrows(IllegalArgumentException.class,
                () -> ParcelsAdapterContracts.legacyRoom(room, 4, 2, 3, 1, 5, 6));
    }

    @Test
    void fixtureFlagsDefaultOnAndParseStrictly() {
        assertTrue(ParcelsAdapterContracts.fixtureFlag(java.util.List.of(), "publish-patrol"));
        assertTrue(ParcelsAdapterContracts.fixtureFlag(
                java.util.List.of("# comment", "", "publish-kinship=true"), "publish-patrol"));
        assertFalse(ParcelsAdapterContracts.fixtureFlag(
                java.util.List.of("publish-patrol = false", "publish-kinship=true"),
                "publish-patrol"));
        assertTrue(ParcelsAdapterContracts.fixtureFlag(
                java.util.List.of("publish-patrol=false"), "publish-kinship"));
        assertThrows(IllegalArgumentException.class, () -> ParcelsAdapterContracts.fixtureFlag(
                java.util.List.of("publish-patrol=yes"), "publish-patrol"));
        assertThrows(IllegalArgumentException.class, () -> ParcelsAdapterContracts.fixtureFlag(
                java.util.List.of("publish-patrol"), "publish-patrol"));
        assertThrows(IllegalArgumentException.class, () -> ParcelsAdapterContracts.fixtureFlag(
                java.util.List.of("publish-patrol=true", "publish-patrol=true"),
                "publish-patrol"));
    }
}
