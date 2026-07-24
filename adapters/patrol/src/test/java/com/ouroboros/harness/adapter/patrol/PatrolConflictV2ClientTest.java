package com.ouroboros.harness.adapter.patrol;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.Consumer;
import java.util.function.Function;
import org.junit.jupiter.api.Test;

class PatrolConflictV2ClientTest {
    private static final UUID AGGRESSOR =
            UUID.fromString("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    private static final UUID VICTIM =
            UUID.fromString("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");

    @Test
    void readsStatusReplayAndLiveEventsThroughTheJdkOnlyContract() {
        AtomicReference<Consumer<Map<String, Object>>> subscriber = new AtomicReference<>();
        List<Map<String, Object>> replay = List.of(event(1L, "hostile", AGGRESSOR));
        PatrolConflictV2Client client = new PatrolConflictV2Client(
                () -> protocol(status(1L), replay, subscriber));

        JsonObject status = client.status(AGGRESSOR);
        JsonObject replayResult = client.replay(AGGRESSOR, 0L);
        subscriber.get().accept(event(2L, "hostile", AGGRESSOR));
        JsonObject live = client.events();

        assertTrue(status.get("installed").getAsBoolean());
        assertTrue(status.getAsJsonObject("status").get("available").getAsBoolean());
        assertEquals(AGGRESSOR.toString(),
                status.getAsJsonObject("status").get("playerId").getAsString());
        assertEquals(1, replayResult.get("count").getAsInt());
        assertTrue(replayResult.getAsJsonObject("checks").get("strictlyIncreasing").getAsBoolean());
        assertEquals(1, live.get("count").getAsInt());
        assertEquals(2L, live.getAsJsonArray("events").get(0).getAsJsonObject()
                .get("aggregateRevision").getAsLong());
        assertNotNull(JsonParser.parseString(live.toString()),
                "adapter results remain ordinary JSON");
    }

    @Test
    void missingMalformedAndThrowingProvidersFailClosedWithoutEscaping() {
        PatrolConflictV2Client missing = new PatrolConflictV2Client(() -> null);
        PatrolConflictV2Client malformed = new PatrolConflictV2Client(
                () -> Map.of("protocolVersion", 1));
        PatrolConflictV2Client throwing = new PatrolConflictV2Client(() -> Map.of(
                "protocolVersion", 2,
                "eventSchemaVersion", 1,
                "status", (Function<UUID, Object>) ignored -> {
                    throw new IllegalStateException("provider failed");
                },
                "replay", (Function<Map<String, Object>, Object>) ignored -> List.of(),
                "subscribe", (Function<Consumer<Map<String, Object>>, AutoCloseable>)
                        ignored -> () -> { }));

        assertEquals("provider_missing", missing.status(AGGRESSOR).get("error").getAsString());
        assertFalse(missing.status(AGGRESSOR).get("installed").getAsBoolean());
        assertEquals("protocol_version", malformed.status(AGGRESSOR).get("error").getAsString());
        assertTrue(malformed.status(AGGRESSOR).get("installed").getAsBoolean());
        assertEquals("provider_failure", throwing.status(AGGRESSOR).get("error").getAsString());
    }

    @Test
    void durabilityOutageReturnsAnUnavailableReconciliationInsteadOfThrowing() {
        AtomicReference<Consumer<Map<String, Object>>> subscriber = new AtomicReference<>();
        PatrolConflictV2Client client = new PatrolConflictV2Client(() -> protocol(
                Map.of(
                        "available", false,
                        "playerId", AGGRESSOR.toString(),
                        "principal", "player:" + AGGRESSOR,
                        "aggregateId", AGGRESSOR.toString()),
                List.of(),
                subscriber));

        JsonObject reconciliation = client.reconcile(AGGRESSOR, 0L);

        assertFalse(reconciliation.get("available").getAsBoolean());
        assertEquals("status_unavailable", reconciliation.get("error").getAsString());
        assertFalse(reconciliation.getAsJsonObject("checks").get("valid").getAsBoolean());
    }

    @Test
    void unavailableStatusStillRequiresTheRequestedAggregateIdentity() {
        AtomicReference<Consumer<Map<String, Object>>> subscriber = new AtomicReference<>();
        PatrolConflictV2Client client = new PatrolConflictV2Client(() -> protocol(
                Map.of(
                        "available", false,
                        "playerId", AGGRESSOR.toString(),
                        "principal", "player:" + VICTIM,
                        "aggregateId", AGGRESSOR.toString()),
                List.of(),
                subscriber));

        JsonObject status = client.status(AGGRESSOR);

        assertEquals("invalid_status", status.get("error").getAsString());
    }

    @Test
    void rejectsIdentityMismatchesAndNonMonotonicReplay() {
        AtomicReference<Consumer<Map<String, Object>>> subscriber = new AtomicReference<>();
        Map<String, Object> mismatched = status(2L);
        mismatched.put("playerId", VICTIM.toString());
        PatrolConflictV2Client badStatus = new PatrolConflictV2Client(
                () -> protocol(mismatched, List.of(), subscriber));
        PatrolConflictV2Client badReplay = new PatrolConflictV2Client(
                () -> protocol(status(2L), List.of(
                        event(2L, "hostile", AGGRESSOR),
                        event(2L, "hostile", AGGRESSOR)), new AtomicReference<>()));

        assertEquals("invalid_status", badStatus.status(AGGRESSOR).get("error").getAsString());
        JsonObject replay = badReplay.replay(AGGRESSOR, 0L);
        assertEquals("invalid_replay", replay.get("error").getAsString());
        assertFalse(replay.getAsJsonObject("checks").get("strictlyIncreasing").getAsBoolean());
    }

    @Test
    void reconciliationProvesStatusCoversUniqueBoundedReplay() {
        AtomicReference<Consumer<Map<String, Object>>> subscriber = new AtomicReference<>();
        PatrolConflictV2Client client = new PatrolConflictV2Client(() -> protocol(
                status(2L),
                List.of(event(1L, "hostile", AGGRESSOR), event(2L, "hostile", AGGRESSOR)),
                subscriber));

        JsonObject reconciliation = client.reconcile(AGGRESSOR, 0L);
        JsonObject checks = reconciliation.getAsJsonObject("checks");

        assertTrue(checks.get("valid").getAsBoolean());
        assertTrue(checks.get("statusCoversReplay").getAsBoolean());
        assertTrue(checks.get("strictlyIncreasing").getAsBoolean());
        assertTrue(checks.get("eventIdsUnique").getAsBoolean());
        assertTrue(checks.get("withinBound").getAsBoolean());
        assertEquals(2L, reconciliation.getAsJsonObject("status").get("revision").getAsLong());
    }

    @Test
    void rejectsReplayBeyondThePublishedDurableBound() {
        AtomicReference<Consumer<Map<String, Object>>> subscriber = new AtomicReference<>();
        PatrolConflictV2Client client = new PatrolConflictV2Client(() -> protocol(
                status(2L),
                java.util.Collections.nCopies(2_049, event(1L, "hostile", AGGRESSOR)),
                subscriber));

        JsonObject replay = client.replay(AGGRESSOR, 0L);

        assertEquals("invalid_replay", replay.get("error").getAsString());
        assertFalse(replay.getAsJsonObject("checks").get("withinBound").getAsBoolean());
        assertEquals(2_048, replay.get("count").getAsInt(),
                "evidence itself remains bounded when the peer violates its contract");
    }

    @Test
    void rejectsMalformedStatusFieldsInsideEventData() {
        AtomicReference<Consumer<Map<String, Object>>> subscriber = new AtomicReference<>();
        Map<String, Object> badPrincipal = event(1L, "hostile", AGGRESSOR);
        @SuppressWarnings("unchecked")
        Map<String, Object> badPrincipalData =
                (Map<String, Object>) badPrincipal.get("data");
        badPrincipalData.put("principal", "player:" + VICTIM);
        Map<String, Object> badPosition = event(2L, "hostile", AGGRESSOR);
        @SuppressWarnings("unchecked")
        Map<String, Object> badPositionData =
                (Map<String, Object>) badPosition.get("data");
        badPositionData.put("position", Map.of("x", 1.0, "z", 2.0));
        PatrolConflictV2Client badPrincipalClient = new PatrolConflictV2Client(() -> protocol(
                status(1L), List.of(badPrincipal), subscriber));
        PatrolConflictV2Client badPositionClient = new PatrolConflictV2Client(() -> protocol(
                status(2L), List.of(badPosition), new AtomicReference<>()));

        JsonObject principalReplay = badPrincipalClient.replay(AGGRESSOR, 0L);
        JsonObject positionReplay = badPositionClient.replay(AGGRESSOR, 0L);

        assertEquals("invalid_replay", principalReplay.get("error").getAsString());
        assertEquals("invalid_replay", positionReplay.get("error").getAsString());
        assertFalse(principalReplay.getAsJsonObject("checks")
                .get("aggregateMatches").getAsBoolean());
        assertFalse(positionReplay.getAsJsonObject("checks")
                .get("aggregateMatches").getAsBoolean());
    }

    @Test
    void rejectsOversizedExtensionStringsBeforeRetainingEvidence() {
        AtomicReference<Consumer<Map<String, Object>>> subscriber = new AtomicReference<>();
        Map<String, Object> oversized = status(1L);
        oversized.put("extension", "x".repeat(16_385));
        PatrolConflictV2Client client = new PatrolConflictV2Client(
                () -> protocol(oversized, List.of(), subscriber));

        JsonObject status = client.status(AGGRESSOR);

        assertEquals("invalid_json", status.get("error").getAsString());
    }

    @Test
    void concurrentSubscribersCannotExceedTheBoundedLiveBuffer() throws Exception {
        AtomicReference<Consumer<Map<String, Object>>> subscriber = new AtomicReference<>();
        PatrolConflictV2Client client = new PatrolConflictV2Client(
                () -> protocol(status(1L), List.of(), subscriber));
        assertTrue(client.describe().get("installed").getAsBoolean());
        AtomicLong revision = new AtomicLong();
        int submitted = 2_400;
        ExecutorService executor = Executors.newFixedThreadPool(8);
        try {
            for (int index = 0; index < submitted; index++) {
                executor.submit(() -> subscriber.get().accept(
                        event(revision.incrementAndGet(), "hostile", AGGRESSOR)));
            }
        } finally {
            executor.shutdown();
        }
        assertTrue(executor.awaitTermination(30, TimeUnit.SECONDS));

        JsonObject events = client.events();

        assertEquals(2_048, events.get("count").getAsInt());
        assertEquals(submitted - 2_048, events.get("truncated").getAsLong());
        assertEquals(0, events.getAsJsonArray("errors").size());
    }

    @Test
    void cumulativeBudgetsBoundReplayResponsesAndRetainedLiveEvidence() {
        AtomicReference<Consumer<Map<String, Object>>> subscriber = new AtomicReference<>();
        List<Map<String, Object>> replay = new ArrayList<>();
        for (long revision = 1; revision <= 600; revision++) {
            Map<String, Object> event = event(revision, "hostile", AGGRESSOR);
            event.put("extension", "x".repeat(16_384));
            replay.add(event);
        }
        PatrolConflictV2Client client = new PatrolConflictV2Client(
                () -> protocol(status(600L), replay, subscriber));

        JsonObject replayResult = client.replay(AGGRESSOR, 0L);
        for (Map<String, Object> event : replay) subscriber.get().accept(event);
        JsonObject liveResult = client.events();

        assertEquals("invalid_replay", replayResult.get("error").getAsString());
        assertTrue(replayResult.get("count").getAsInt() < replay.size());
        assertTrue(liveResult.get("count").getAsInt() < replay.size());
        assertTrue(liveResult.get("truncated").getAsLong() > 0L);
        assertEquals(0, liveResult.getAsJsonArray("errors").size());
    }

    @Test
    void cumulativeNodeBudgetBoundsRetainedLiveEvidence() {
        AtomicReference<Consumer<Map<String, Object>>> subscriber = new AtomicReference<>();
        PatrolConflictV2Client client = new PatrolConflictV2Client(
                () -> protocol(status(400L), List.of(), subscriber));
        assertTrue(client.describe().get("installed").getAsBoolean());
        for (long revision = 1; revision <= 400; revision++) {
            Map<String, Object> event = event(revision, "hostile", AGGRESSOR);
            event.put("nodePadding", java.util.Collections.nCopies(800, false));
            subscriber.get().accept(event);
        }

        JsonObject liveResult = client.events();

        assertTrue(liveResult.get("count").getAsInt() < 400);
        assertTrue(liveResult.get("truncated").getAsLong() > 0L);
        assertEquals(0, liveResult.getAsJsonArray("errors").size());
    }

    @Test
    void combatV3ReadsAbsoluteSymmetricTagsAndVictimAuthoredAggregateEvents() {
        AtomicReference<Consumer<Map<String, Object>>> subscriber = new AtomicReference<>();
        Map<String, Object> victimEvent = combatEvent(2L, VICTIM, "victim", AGGRESSOR);
        PatrolConflictV2Client client = PatrolConflictV2Client.combatV3(
                () -> combatProtocol(
                        combatStatus(VICTIM, "victim", AGGRESSOR, 1_000L, 31_000L, 2L),
                        List.of(victimEvent), subscriber));

        JsonObject status = client.status(VICTIM);
        JsonObject replay = client.replay(VICTIM, 0L);
        subscriber.get().accept(victimEvent);
        JsonObject live = client.events();

        assertEquals(3, status.get("protocolVersion").getAsInt());
        assertEquals(2, status.get("eventSchemaVersion").getAsInt());
        assertEquals(31_000L,
                status.getAsJsonObject("status").get("taggedUntil").getAsLong());
        assertEquals("victim",
                status.getAsJsonObject("status").get("participationRole").getAsString());
        assertEquals(1, replay.get("count").getAsInt());
        assertTrue(replay.getAsJsonObject("checks").get("strictlyIncreasing").getAsBoolean());
        assertEquals("victim", live.getAsJsonArray("events").get(0).getAsJsonObject()
                .getAsJsonObject("data").get("participantRole").getAsString());
        assertEquals(AGGRESSOR.toString(), live.getAsJsonArray("events").get(0).getAsJsonObject()
                .get("actor").getAsString());
    }

    @Test
    void combatV3EnforcesExactFiveSecondAndTenMinuteDurationBounds() {
        for (long duration : List.of(5_000L, 600_000L)) {
            PatrolConflictV2Client accepted = PatrolConflictV2Client.combatV3(
                    () -> combatProtocol(
                            combatStatus(AGGRESSOR, "attacker", VICTIM,
                                    1_000L, 1_000L + duration, 1L),
                            List.of(), new AtomicReference<>()));
            assertFalse(accepted.status(AGGRESSOR).has("error"));
        }
        for (long duration : List.of(4_999L, 600_001L)) {
            PatrolConflictV2Client rejected = PatrolConflictV2Client.combatV3(
                    () -> combatProtocol(
                            combatStatus(AGGRESSOR, "attacker", VICTIM,
                                    1_000L, 1_000L + duration, 1L),
                            List.of(), new AtomicReference<>()));
            assertEquals("invalid_status",
                    rejected.status(AGGRESSOR).get("error").getAsString());
        }
    }

    @Test
    void combatV3AcceptsOnlyTheCompleteMonotonicAfkExtensionPair() {
        for (boolean afk : List.of(false, true)) {
            Map<String, Object> value = combatStatus(
                    AGGRESSOR, "attacker", VICTIM, 1_000L, 31_000L, 1L);
            value.put("afk", afk);
            value.put("afkRevision", 7L);
            PatrolConflictV2Client accepted = PatrolConflictV2Client.combatV3(
                    () -> combatProtocol(value, List.of(), new AtomicReference<>()));
            assertFalse(accepted.status(AGGRESSOR).has("error"));
        }

        for (Map<String, Object> invalid : List.<Map<String, Object>>of(
                Map.of("afk", true),
                Map.of("afkRevision", 1L),
                Map.of("afk", "yes", "afkRevision", 1L),
                Map.of("afk", true, "afkRevision", -1L),
                Map.of("afk", true, "afkRevision", 1.5))) {
            Map<String, Object> value = combatStatus(
                    AGGRESSOR, "attacker", VICTIM, 1_000L, 31_000L, 1L);
            value.putAll(invalid);
            PatrolConflictV2Client rejected = PatrolConflictV2Client.combatV3(
                    () -> combatProtocol(value, List.of(), new AtomicReference<>()));
            assertEquals("invalid_status",
                    rejected.status(AGGRESSOR).get("error").getAsString());
        }
    }

    private static Map<String, Object> protocol(
            Map<String, Object> status,
            List<Map<String, Object>> replay,
            AtomicReference<Consumer<Map<String, Object>>> subscriber) {
        return Map.of(
                "protocolVersion", 2,
                "eventSchemaVersion", 1,
                "status", (Function<UUID, Map<String, Object>>) ignored -> status,
                "replay", (Function<Map<String, Object>, List<Map<String, Object>>>)
                        ignored -> replay,
                "subscribe", (Function<Consumer<Map<String, Object>>, AutoCloseable>) consumer -> {
                    subscriber.set(consumer);
                    return () -> subscriber.compareAndSet(consumer, null);
                });
    }

    private static Map<String, Object> status(long revision) {
        Map<String, Object> status = new LinkedHashMap<>();
        status.put("available", true);
        status.put("playerId", AGGRESSOR.toString());
        status.put("principal", "player:" + AGGRESSOR);
        status.put("aggregateId", AGGRESSOR.toString());
        status.put("state", "clear");
        status.put("wanted", false);
        status.put("tier", 0);
        status.put("lastHostileAt", 1_000L);
        status.put("lastCounterparty", VICTIM.toString());
        status.put("world", "minecraft:overworld");
        status.put("position", Map.of("x", 1.0, "y", 64.0, "z", 2.0));
        status.put("banished", false);
        status.put("revision", revision);
        return status;
    }

    private static Map<String, Object> combatProtocol(
            Map<String, Object> status,
            List<Map<String, Object>> replay,
            AtomicReference<Consumer<Map<String, Object>>> subscriber) {
        return Map.of(
                "protocolVersion", 3,
                "eventSchemaVersion", 2,
                "status", (Function<UUID, Map<String, Object>>) ignored -> status,
                "replay", (Function<Map<String, Object>, List<Map<String, Object>>>)
                        ignored -> replay,
                "subscribe", (Function<Consumer<Map<String, Object>>, AutoCloseable>) consumer -> {
                    subscriber.set(consumer);
                    return () -> subscriber.compareAndSet(consumer, null);
                });
    }

    private static Map<String, Object> combatStatus(
            UUID player,
            String role,
            UUID counterparty,
            long participatedAt,
            long taggedUntil,
            long revision) {
        Map<String, Object> status = new LinkedHashMap<>();
        status.put("available", true);
        status.put("playerId", player.toString());
        status.put("principal", "player:" + player);
        status.put("aggregateId", player.toString());
        status.put("state", "clear");
        status.put("wanted", false);
        status.put("tier", 0);
        status.put("lastHostileAt", 0L);
        status.put("banished", false);
        status.put("revision", revision);
        status.put("lastParticipationAt", participatedAt);
        status.put("taggedUntil", taggedUntil);
        status.put("participationRole", role);
        status.put("participationCounterparty", counterparty.toString());
        status.put("participationCounterpartyPrincipal", "player:" + counterparty);
        status.put("participationWorld", "minecraft:overworld");
        status.put("participationPosition", Map.of("x", 1.0, "y", 64.0, "z", 2.0));
        return status;
    }

    private static Map<String, Object> combatEvent(
            long revision, UUID aggregateId, String role, UUID counterparty) {
        Map<String, Object> data = new LinkedHashMap<>(combatStatus(
                aggregateId, role.equals("victim") ? "victim" : "attacker",
                counterparty, 1_000L, 31_000L, revision));
        data.remove("available");
        data.put("participantRole", role);
        data.put("counterparty", counterparty.toString());
        data.put("counterpartyPrincipal", "player:" + counterparty);
        Map<String, Object> event = new LinkedHashMap<>();
        event.put("eventId", new UUID(1L, revision).toString());
        event.put("eventType", "patrol.combat_tag_changed");
        event.put("type", "patrol.combat_tag_changed");
        event.put("action", "combat_tagged");
        event.put("aggregateType", "minecraft:player");
        event.put("aggregateId", aggregateId.toString());
        event.put("aggregateRevision", revision);
        event.put("revision", revision);
        event.put("actorPlayerId", AGGRESSOR.toString());
        event.put("actor", AGGRESSOR.toString());
        event.put("actingPrincipal", "player:" + AGGRESSOR);
        event.put("principal", "player:" + AGGRESSOR);
        event.put("worldKey", "minecraft:overworld");
        event.put("world", "minecraft:overworld");
        event.put("position", Map.of("x", 1.0, "y", 64.0, "z", 2.0));
        event.put("occurredAt", Instant.ofEpochMilli(1_000L).toString());
        event.put("timestamp", Instant.ofEpochMilli(1_000L).toString());
        event.put("schemaVersion", 2);
        event.put("payload", data);
        event.put("data", data);
        return event;
    }

    private static Map<String, Object> event(long revision, String action, UUID aggregateId) {
        Map<String, Object> data = new LinkedHashMap<>(status(revision));
        data.remove("available");
        data.put("participantRole", "aggressor");
        data.put("counterparty", VICTIM.toString());
        data.put("counterpartyPrincipal", "player:" + VICTIM);
        Map<String, Object> event = new LinkedHashMap<>();
        event.put("eventId", new UUID(0L, revision).toString());
        event.put("eventType", "patrol.heat_changed");
        event.put("type", "patrol.heat_changed");
        event.put("action", action);
        event.put("aggregateType", "minecraft:player");
        event.put("aggregateId", aggregateId.toString());
        event.put("aggregateRevision", revision);
        event.put("revision", revision);
        event.put("actorPlayerId", AGGRESSOR.toString());
        event.put("actor", AGGRESSOR.toString());
        event.put("actingPrincipal", "player:" + AGGRESSOR);
        event.put("principal", "player:" + AGGRESSOR);
        event.put("worldKey", "minecraft:overworld");
        event.put("world", "minecraft:overworld");
        event.put("position", Map.of("x", 1.0, "y", 64.0, "z", 2.0));
        event.put("occurredAt", Instant.ofEpochMilli(1_000L + revision).toString());
        event.put("timestamp", Instant.ofEpochMilli(1_000L + revision).toString());
        event.put("schemaVersion", 1);
        event.put("payload", data);
        event.put("data", data);
        return event;
    }
}
