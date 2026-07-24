package com.ouroboros.harness.adapter.coffer;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.BiPredicate;
import java.util.function.Function;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;

class CivilizationProviderControlTest {
    private static final UUID MEMBER =
            UUID.fromString("20000000-0000-0000-0000-000000000002");

    @Test
    void residentProjectionPreservesTheRealOwnerAndAddsOnlyTheSelectedResident() {
        Function<Map<String, Object>, Map<String, Object>> at = ignored -> Map.of(
                "id", "10000000-0000-0000-0000-000000000001",
                "owner", "kinship:family-one",
                "residents", List.of());
        Map<String, Object> original = Map.of("protocolVersion", 1, "at", at);

        @SuppressWarnings("unchecked")
        Function<Map<String, Object>, Map<String, Object>> controlled =
                (Function<Map<String, Object>, Map<String, Object>>)
                        ((Map<?, ?>) CivilizationProviderControl.replacement(
                                "structures", "resident", original, MEMBER)).get("at");
        Map<String, Object> result = controlled.apply(Map.of());

        assertEquals("kinship:family-one", result.get("owner"));
        assertEquals(List.of(MEMBER.toString()), result.get("residents"));
    }

    @Test
    void transferredProjectionChangesOnlyTheStructureOwner() {
        Function<Map<String, Object>, Map<String, Object>> at = ignored -> Map.of(
                "id", "10000000-0000-0000-0000-000000000001",
                "owner", "kinship:family-one",
                "residents", List.of("30000000-0000-0000-0000-000000000003"));
        Map<String, Object> original = Map.of("protocolVersion", 1, "at", at);

        @SuppressWarnings("unchecked")
        Function<Map<String, Object>, Map<String, Object>> controlled =
                (Function<Map<String, Object>, Map<String, Object>>)
                        ((Map<?, ?>) CivilizationProviderControl.replacement(
                                "structures", "transferred", original, MEMBER)).get("at");
        Map<String, Object> result = controlled.apply(Map.of());

        assertEquals("player:" + MEMBER, result.get("owner"));
        assertEquals(List.of("30000000-0000-0000-0000-000000000003"), result.get("residents"));
        assertEquals("kinship:family-one", at.apply(Map.of()).get("owner"));
    }

    @Test
    void providerFaultModesAreExplicitAndFailClosed() {
        Function<UUID, String> resolve = id -> "kinship:family-one";
        BiPredicate<String, UUID> member = (principal, id) -> true;
        Map<String, Object> original = Map.of(
                "protocolVersion", 1,
                "resolve", resolve,
                "isMember", member,
                "canAdminister", member);

        assertNull(CivilizationProviderControl.replacement("principals", "missing", original, null));
        assertEquals(Map.of("protocolVersion", 1),
                CivilizationProviderControl.replacement("principals", "malformed", original, null));

        Map<?, ?> stale = (Map<?, ?>) CivilizationProviderControl.replacement(
                "principals", "stale", original, null);
        @SuppressWarnings("unchecked")
        Function<UUID, String> staleResolve = (Function<UUID, String>) stale.get("resolve");
        @SuppressWarnings("unchecked")
        BiPredicate<String, UUID> staleMember = (BiPredicate<String, UUID>) stale.get("isMember");
        assertEquals("kinship:family-one", staleResolve.apply(MEMBER));
        assertFalse(staleMember.test("kinship:family-one", MEMBER));

        Map<?, ?> throwing = (Map<?, ?>) CivilizationProviderControl.replacement(
                "principals", "throwing", original, null);
        @SuppressWarnings("unchecked")
        Function<UUID, String> throwingResolve = (Function<UUID, String>) throwing.get("resolve");
        @SuppressWarnings("unchecked")
        BiPredicate<String, UUID> throwingMember =
                (BiPredicate<String, UUID>) throwing.get("isMember");
        assertThrows(IllegalStateException.class, () -> throwingResolve.apply(MEMBER));
        assertThrows(IllegalStateException.class,
                () -> throwingMember.test("kinship:family-one", MEMBER));
    }

    @Test
    void continuityFaultsAreIsolatedToOneDurablePhase() {
        Function<Map<String, Object>, Map<String, Object>> snapshot =
                request -> Map.of("payload", "original");
        Function<Map<String, Object>, Boolean> restore = request -> true;
        Function<Map<String, Object>, Boolean> acknowledge = request -> true;
        Map<String, Object> original = Map.of(
                "protocolVersion", 1,
                "snapshot", snapshot,
                "restore", restore,
                "acknowledge", acknowledge);

        Map<?, ?> restoreThrowing = (Map<?, ?>) CivilizationProviderControl.replacement(
                "continuity", "restore-throwing", original, null);
        assertSame(snapshot, restoreThrowing.get("snapshot"));
        assertSame(acknowledge, restoreThrowing.get("acknowledge"));
        @SuppressWarnings("unchecked")
        Function<Map<String, Object>, Boolean> brokenRestore =
                (Function<Map<String, Object>, Boolean>) restoreThrowing.get("restore");
        assertThrows(IllegalStateException.class, () -> brokenRestore.apply(Map.of()));

        Map<?, ?> acknowledgeThrowing = (Map<?, ?>) CivilizationProviderControl.replacement(
                "continuity", "acknowledge-throwing", original, null);
        assertSame(snapshot, acknowledgeThrowing.get("snapshot"));
        assertSame(restore, acknowledgeThrowing.get("restore"));
        @SuppressWarnings("unchecked")
        Function<Map<String, Object>, Boolean> brokenAcknowledge =
                (Function<Map<String, Object>, Boolean>) acknowledgeThrowing.get("acknowledge");
        assertThrows(IllegalStateException.class, () -> brokenAcknowledge.apply(Map.of()));
    }

    @Test
    void originalModeAndInvalidControlsAreDeterministic() {
        Map<String, Object> original = Map.of("protocolVersion", 1);

        assertSame(original,
                CivilizationProviderControl.replacement("structures", "original", original, null));
        assertThrows(IllegalArgumentException.class,
                () -> CivilizationProviderControl.replacement("unknown", "missing", original, null));
        assertThrows(IllegalArgumentException.class,
                () -> CivilizationProviderControl.replacement("structures", "resident", original, null));
    }
}
