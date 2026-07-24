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
    void legacyRoomRejectsInvertedBounds() {
        UUID room = UUID.randomUUID();
        assertEquals(room + ",1,2,3,4,5,6",
                ParcelsAdapterContracts.legacyRoom(room, 1, 2, 3, 4, 5, 6));
        assertThrows(IllegalArgumentException.class,
                () -> ParcelsAdapterContracts.legacyRoom(room, 4, 2, 3, 1, 5, 6));
    }
}
