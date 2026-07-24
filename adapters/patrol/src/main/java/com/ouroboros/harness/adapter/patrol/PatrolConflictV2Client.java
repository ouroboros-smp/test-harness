package com.ouroboros.harness.adapter.patrol;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonNull;
import com.google.gson.JsonObject;
import com.google.gson.JsonPrimitive;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.format.DateTimeParseException;
import java.util.ArrayDeque;
import java.util.Collection;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.function.Consumer;
import java.util.function.Function;
import java.util.function.Supplier;

/**
 * Strict JDK-only reader for Patrol's versioned ObjectShare conflict contracts.
 *
 * <p>The adapter intentionally has no link to Patrol classes. All peer values are treated as
 * hostile inputs, validated, bounded, and copied into ordinary JSON before reaching the harness.
 */
public final class PatrolConflictV2Client implements AutoCloseable {
    public static final String KEY = "ouroboros:civilization/patrol-conflict/v2";
    public static final String KEY_V3 = "ouroboros:civilization/patrol-conflict/v3";
    private static final int V2_PROTOCOL_VERSION = 2;
    private static final int V2_EVENT_SCHEMA_VERSION = 1;
    private static final int MAX_REPLAY_EVENTS = 2_048;
    private static final int MAX_LIVE_EVENTS = 2_048;
    private static final int MAX_LIVE_ERRORS = 64;
    private static final int MAX_JSON_COLLECTION = 4_096;
    private static final int MAX_JSON_DEPTH = 16;
    private static final int MAX_JSON_NODES = 1_024;
    private static final int MAX_JSON_CHARACTERS = 65_536;
    private static final int MAX_JSON_STRING = 16_384;
    private static final int MAX_JSON_KEY = 1_024;
    private static final int MAX_JSON_NUMBER = 128;
    private static final int MAX_SERIALIZED_EVENT_CHARACTERS = 131_072;
    private static final int MAX_EVIDENCE_NODES = 262_144;
    private static final int MAX_EVIDENCE_CHARACTERS = 8 * 1_024 * 1_024;
    private static final Set<String> STATES = Set.of("clear", "wanted", "cooling");
    private static final Set<String> ACTIONS = Set.of(
            "hostile", "wanted", "cooling", "cleared", "pardoned",
            "banishment_changed", "hostility_expired");
    private static final Set<String> COMBAT_ACTIONS = Set.of(
            "combat_tagged", "combat_tag_cleared", "combat_tag_expired");
    private static final Set<String> PARTICIPANT_ROLES =
            Set.of("aggressor", "subject", "administrator", "system");
    private static final Set<String> V3_PARTICIPANT_ROLES =
            Set.of("aggressor", "victim", "subject", "administrator", "system");

    private final Supplier<Object> providerSupplier;
    private final int protocolVersion;
    private final int eventSchemaVersion;
    private final boolean combatTags;
    private final Object evidenceLock = new Object();
    private final ArrayDeque<LiveEvent> liveEvents = new ArrayDeque<>();
    private final ArrayDeque<String> liveErrors = new ArrayDeque<>();
    private Object subscribedProtocol;
    private AutoCloseable subscription;
    private long truncatedLiveEvents;
    private int liveEventCharacters;
    private int liveEventNodes;

    public PatrolConflictV2Client(Supplier<Object> providerSupplier) {
        this(providerSupplier, V2_PROTOCOL_VERSION, V2_EVENT_SCHEMA_VERSION, false);
    }

    static PatrolConflictV2Client combatV3(Supplier<Object> providerSupplier) {
        return new PatrolConflictV2Client(providerSupplier, 3, 2, true);
    }

    private PatrolConflictV2Client(
            Supplier<Object> providerSupplier,
            int protocolVersion,
            int eventSchemaVersion,
            boolean combatTags) {
        this.providerSupplier = java.util.Objects.requireNonNull(
                providerSupplier, "providerSupplier");
        this.protocolVersion = protocolVersion;
        this.eventSchemaVersion = eventSchemaVersion;
        this.combatTags = combatTags;
    }

    public JsonObject describe() {
        try {
            Provider provider = provider();
            JsonObject result = metadata();
            result.addProperty("installed", true);
            result.addProperty("subscribed", provider.raw() == subscribedProtocol);
            return result;
        } catch (ContractFailure failure) {
            return failure(failure);
        } catch (RuntimeException failure) {
            return failure(true, "provider_failure", failure);
        }
    }

    public JsonObject status(UUID playerId) {
        if (playerId == null) return failure(false, "invalid_request", "playerId is required");
        try {
            Provider provider = provider();
            Map<String, Object> status = stringMap(
                    provider.status().apply(playerId), "status result", "invalid_status");
            validateStatus(status, playerId);
            JsonObject result = metadata();
            result.addProperty("installed", true);
            result.add("status", toJson(status, 0));
            return result;
        } catch (ContractFailure failure) {
            return failure(failure);
        } catch (RuntimeException failure) {
            return failure(true, "provider_failure", failure);
        }
    }

    public JsonObject replay(UUID playerId, long afterRevision) {
        if (playerId == null || afterRevision < 0) {
            return failure(false, "invalid_request",
                    "playerId and a non-negative afterRevision are required");
        }
        try {
            Provider provider = provider();
            Object raw = provider.replay().apply(Map.of(
                    "playerId", playerId.toString(), "afterRevision", afterRevision));
            return replayResult(playerId, afterRevision, raw);
        } catch (ContractFailure failure) {
            return failure(failure);
        } catch (RuntimeException failure) {
            return failure(true, "provider_failure", failure);
        }
    }

    public JsonObject reconcile(UUID playerId, long afterRevision) {
        JsonObject statusResult = status(playerId);
        JsonObject replayResult = replay(playerId, afterRevision);
        JsonObject result = metadata();
        result.addProperty("installed",
                booleanValue(statusResult, "installed") && booleanValue(replayResult, "installed"));
        boolean statusAvailable = false;
        if (statusResult.has("status")) {
            JsonObject status = statusResult.getAsJsonObject("status");
            result.add("status", status.deepCopy());
            statusAvailable = booleanValue(status, "available");
        }
        result.addProperty("available", statusAvailable);
        if (replayResult.has("events")) {
            result.add("events", replayResult.getAsJsonArray("events").deepCopy());
            result.addProperty("count", replayResult.get("count").getAsInt());
        }
        JsonObject checks = replayResult.has("checks")
                ? replayResult.getAsJsonObject("checks").deepCopy() : emptyChecks();
        JsonObject status = result.has("status") ? result.getAsJsonObject("status") : null;
        long statusRevision = status != null && status.has("revision")
                && status.get("revision").isJsonPrimitive()
                && status.get("revision").getAsJsonPrimitive().isNumber()
                ? status.get("revision").getAsLong() : -1L;
        long maximumReplayRevision = checks.get("maximumRevision").getAsLong();
        boolean covers = statusRevision >= maximumReplayRevision;
        checks.addProperty("statusCoversReplay", covers);
        checks.addProperty("valid",
                statusAvailable && !statusResult.has("error") && !replayResult.has("error")
                        && covers
                        && checks.get("strictlyIncreasing").getAsBoolean()
                        && checks.get("eventIdsUnique").getAsBoolean()
                        && checks.get("aggregateMatches").getAsBoolean()
                        && checks.get("withinBound").getAsBoolean());
        result.add("checks", checks);
        if (statusResult.has("error")) {
            result.addProperty("error", statusResult.get("error").getAsString());
            result.addProperty("detail", statusResult.get("detail").getAsString());
        } else if (replayResult.has("error")) {
            result.addProperty("error", replayResult.get("error").getAsString());
            result.addProperty("detail", replayResult.get("detail").getAsString());
        } else if (!statusAvailable) {
            result.addProperty("error", "status_unavailable");
            result.addProperty("detail",
                    "Patrol status is not durably available for reconciliation");
        }
        return result;
    }

    public JsonObject events() {
        JsonObject result = metadata();
        result.addProperty("installed", describe().get("installed").getAsBoolean());
        JsonArray events = new JsonArray();
        JsonArray errors = new JsonArray();
        long truncated;
        synchronized (evidenceLock) {
            liveEvents.forEach(event -> events.add(event.value().deepCopy()));
            liveErrors.forEach(errors::add);
            truncated = truncatedLiveEvents;
        }
        result.addProperty("count", events.size());
        result.addProperty("truncated", truncated);
        result.add("events", events);
        result.add("errors", errors);
        return result;
    }

    public JsonObject clearEvents() {
        synchronized (evidenceLock) {
            liveEvents.clear();
            liveErrors.clear();
            truncatedLiveEvents = 0L;
            liveEventCharacters = 0;
            liveEventNodes = 0;
        }
        JsonObject result = events();
        result.addProperty("cleared", true);
        return result;
    }

    private JsonObject replayResult(UUID playerId, long afterRevision, Object raw) {
        JsonObject checks = emptyChecks();
        JsonArray events = new JsonArray();
        boolean strictlyIncreasing = true;
        boolean eventIdsUnique = true;
        boolean aggregateMatches = true;
        boolean withinBound = true;
        long maximumRevision = afterRevision;
        String detail = null;
        JsonBudget evidenceBudget =
                new JsonBudget(MAX_EVIDENCE_NODES, MAX_EVIDENCE_CHARACTERS);
        if (!(raw instanceof List<?> list)) {
            detail = "replay result must be a list";
        } else {
            withinBound = list.size() <= MAX_REPLAY_EVENTS;
            if (!withinBound) detail = "replay exceeds " + MAX_REPLAY_EVENTS + " events";
            Set<UUID> eventIds = new HashSet<>();
            long previous = afterRevision;
            int inspected = Math.min(list.size(), MAX_REPLAY_EVENTS);
            for (int index = 0; index < inspected; index++) {
                try {
                    Map<String, Object> event =
                            stringMap(list.get(index), "replay event", "invalid_replay");
                    EventIdentity identity = validateEvent(event, playerId);
                    strictlyIncreasing &= identity.revision() > previous;
                    eventIdsUnique &= eventIds.add(identity.eventId());
                    aggregateMatches &= identity.aggregateId().equals(playerId);
                    previous = Math.max(previous, identity.revision());
                    maximumRevision = Math.max(maximumRevision, identity.revision());
                    events.add(toJson(event, 0, evidenceBudget));
                } catch (ContractFailure failure) {
                    detail = failure.getMessage();
                    aggregateMatches = false;
                    break;
                }
            }
        }
        checks.addProperty("strictlyIncreasing", strictlyIncreasing);
        checks.addProperty("eventIdsUnique", eventIdsUnique);
        checks.addProperty("aggregateMatches", aggregateMatches);
        checks.addProperty("withinBound", withinBound);
        checks.addProperty("maximumRevision", maximumRevision);
        JsonObject result = metadata();
        result.addProperty("installed", true);
        result.addProperty("afterRevision", afterRevision);
        result.addProperty("count", events.size());
        result.add("events", events);
        result.add("checks", checks);
        if (detail != null || !strictlyIncreasing || !eventIdsUnique
                || !aggregateMatches || !withinBound) {
            result.addProperty("error", "invalid_replay");
            result.addProperty("detail", detail != null ? detail : "replay invariants failed");
        }
        return result;
    }

    @SuppressWarnings("unchecked")
    private synchronized Provider provider() {
        Object raw;
        try {
            raw = providerSupplier.get();
        } catch (RuntimeException failure) {
            throw new ContractFailure(false, "provider_failure",
                    "ObjectShare lookup failed", failure);
        }
        if (raw == null) {
            throw new ContractFailure(false, "provider_missing",
                    "Patrol conflict-v" + protocolVersion + " provider is not installed");
        }
        Map<String, Object> protocol = stringMap(raw, "protocol", "protocol_shape");
        if (exactLong(protocol.get("protocolVersion"), "protocolVersion") != protocolVersion) {
            throw new ContractFailure(true, "protocol_version",
                    "expected protocolVersion " + protocolVersion);
        }
        if (exactLong(protocol.get("eventSchemaVersion"), "eventSchemaVersion")
                != eventSchemaVersion) {
            throw new ContractFailure(true, "event_schema_version",
                    "expected eventSchemaVersion " + eventSchemaVersion);
        }
        if (!(protocol.get("status") instanceof Function<?, ?> status)
                || !(protocol.get("replay") instanceof Function<?, ?> replay)
                || !(protocol.get("subscribe") instanceof Function<?, ?> subscribe)) {
            throw new ContractFailure(true, "protocol_shape",
                    "status, replay, and subscribe functions are required");
        }
        if (raw != subscribedProtocol) {
            closeSubscription();
            try {
                Object handle = ((Function<Consumer<Map<String, Object>>, ?>) subscribe)
                        .apply(this::capture);
                if (!(handle instanceof AutoCloseable closeable)) {
                    throw new ContractFailure(true, "protocol_shape",
                            "subscribe must return AutoCloseable");
                }
                subscription = closeable;
                subscribedProtocol = raw;
            } catch (ContractFailure failure) {
                throw failure;
            } catch (RuntimeException failure) {
                throw new ContractFailure(true, "provider_failure",
                        "subscribe failed", failure);
            }
        }
        return new Provider(
                raw,
                (Function<Object, Object>) status,
                (Function<Object, Object>) replay);
    }

    private void capture(Map<String, Object> event) {
        try {
            validateEvent(event, null);
            JsonBudget eventBudget = new JsonBudget(MAX_JSON_NODES, MAX_JSON_CHARACTERS);
            JsonObject copy = toJson(event, 0, eventBudget).getAsJsonObject();
            int characters = copy.toString().length();
            int nodes = eventBudget.usedNodes();
            if (characters > MAX_SERIALIZED_EVENT_CHARACTERS) {
                throw new ContractFailure(true, "invalid_event",
                        "serialized event exceeds size bound");
            }
            synchronized (evidenceLock) {
                while (!liveEvents.isEmpty()
                        && (liveEvents.size() >= MAX_LIVE_EVENTS
                        || liveEventCharacters + characters > MAX_EVIDENCE_CHARACTERS
                        || liveEventNodes + nodes > MAX_EVIDENCE_NODES)) {
                    LiveEvent removed = liveEvents.removeFirst();
                    liveEventCharacters -= removed.characters();
                    liveEventNodes -= removed.nodes();
                    truncatedLiveEvents++;
                }
                liveEvents.addLast(new LiveEvent(copy, characters, nodes));
                liveEventCharacters += characters;
                liveEventNodes += nodes;
            }
        } catch (RuntimeException failure) {
            recordLiveError(message(failure));
        }
    }

    private void validateStatus(Map<String, Object> status, UUID expectedPlayer) {
        boolean available = requiredBoolean(status, "available", "invalid_status");
        validateStatusIdentity(status, expectedPlayer, "invalid_status");
        if (!available) {
            toJson(status, 0);
            return;
        }
        validateStatusSnapshot(status, expectedPlayer, "invalid_status");
        toJson(status, 0);
    }

    private static void validateStatusIdentity(
            Map<String, Object> status, UUID expectedPlayer, String code) {
        UUID player = requiredUuid(status, "playerId", code);
        if (!player.equals(expectedPlayer)
                || !requiredString(status, "aggregateId", code)
                        .equals(expectedPlayer.toString())
                || !requiredString(status, "principal", code)
                        .equals("player:" + expectedPlayer)) {
            throw new ContractFailure(true, code,
                    "status identity does not match the requested player");
        }
    }

    private void validateStatusSnapshot(
            Map<String, Object> status, UUID expectedPlayer, String code) {
        validateStatusIdentity(status, expectedPlayer, code);
        String state = requiredString(status, "state", code);
        if (!STATES.contains(state)) {
            throw new ContractFailure(true, code, "unknown state " + state);
        }
        boolean wanted = requiredBoolean(status, "wanted", code);
        long tier = nonNegativeLong(status, "tier", code);
        nonNegativeLong(status, "lastHostileAt", code);
        nonNegativeLong(status, "revision", code);
        requiredBoolean(status, "banished", code);
        if (wanted != state.equals("wanted") || state.equals("clear") && tier != 0L) {
            throw new ContractFailure(true, code,
                    "status state, wanted, and tier disagree");
        }
        if (status.containsKey("lastCounterparty")) {
            requiredUuid(status, "lastCounterparty", code);
        }
        validateLocation(status, code);
        validateContext(status, code);
        if (combatTags) validateCombatStatus(status, code);
    }

    private static void validateCombatStatus(Map<String, Object> status, String code) {
        long participatedAt = nonNegativeLong(status, "lastParticipationAt", code);
        long taggedUntil = nonNegativeLong(status, "taggedUntil", code);
        boolean hasRole = status.get("participationRole") != null;
        boolean hasCounterparty = status.get("participationCounterparty") != null;
        boolean hasPrincipal = status.get("participationCounterpartyPrincipal") != null;
        boolean hasWorld = status.get("participationWorld") != null;
        boolean hasPosition = status.get("participationPosition") != null;
        if (participatedAt == 0L || taggedUntil == 0L) {
            if (participatedAt != 0L || taggedUntil != 0L || hasRole || hasCounterparty
                    || hasPrincipal || hasWorld || hasPosition) {
                throw new ContractFailure(true, code,
                        "inactive combat participation fields are inconsistent");
            }
            return;
        }
        long duration = taggedUntil - participatedAt;
        if (duration < 5_000L || duration > 600_000L) {
            throw new ContractFailure(true, code,
                    "combat participation duration is outside the contract");
        }
        String role = requiredString(status, "participationRole", code);
        if (!Set.of("attacker", "victim").contains(role)) {
            throw new ContractFailure(true, code, "participationRole is invalid");
        }
        if (!hasCounterparty || !hasPrincipal || hasWorld != hasPosition) {
            throw new ContractFailure(true, code,
                    "active combat participation fields are incomplete");
        }
        UUID counterparty = requiredUuid(status, "participationCounterparty", code);
        if (!("player:" + counterparty).equals(
                requiredString(status, "participationCounterpartyPrincipal", code))) {
            throw new ContractFailure(true, code,
                    "participation counterparty principal does not match");
        }
        if (hasWorld) {
            if (requiredString(status, "participationWorld", code).isBlank()) {
                throw new ContractFailure(true, code, "participationWorld must not be blank");
            }
            Map<String, Object> position = stringMap(
                    status.get("participationPosition"), "participationPosition", code);
            finiteNumber(position, "x", code);
            finiteNumber(position, "y", code);
            finiteNumber(position, "z", code);
        }
    }

    private EventIdentity validateEvent(
            Map<String, Object> event, UUID expectedAggregate) {
        UUID eventId = requiredUuid(event, "eventId", "invalid_event");
        String eventType = requiredString(event, "eventType", "invalid_event");
        Set<String> eventTypes = combatTags
                ? Set.of("patrol.heat_changed", "patrol.wanted_changed",
                        "patrol.combat_tag_changed")
                : Set.of("patrol.heat_changed", "patrol.wanted_changed");
        if (!eventType.equals(requiredString(event, "type", "invalid_event"))
                || !eventTypes.contains(eventType)) {
            throw new ContractFailure(true, "invalid_event", "event type is invalid");
        }
        String action = requiredString(event, "action", "invalid_event");
        if (!ACTIONS.contains(action) && !(combatTags && COMBAT_ACTIONS.contains(action))) {
            throw new ContractFailure(true, "invalid_event",
                    "event action is invalid");
        }
        boolean heatAction = action.equals("hostile") || action.equals("hostility_expired");
        boolean combatAction = COMBAT_ACTIONS.contains(action);
        if (heatAction != eventType.equals("patrol.heat_changed")
                || combatAction != eventType.equals("patrol.combat_tag_changed")) {
            throw new ContractFailure(true, "invalid_event",
                    "event action and type disagree");
        }
        if (!"minecraft:player".equals(
                requiredString(event, "aggregateType", "invalid_event"))) {
            throw new ContractFailure(true, "invalid_event",
                    "aggregateType must be minecraft:player");
        }
        UUID aggregateId = requiredUuid(event, "aggregateId", "invalid_event");
        if (expectedAggregate != null && !aggregateId.equals(expectedAggregate)) {
            throw new ContractFailure(true, "invalid_event",
                    "event aggregate does not match replay request");
        }
        long aggregateRevision = nonNegativeLong(
                event, "aggregateRevision", "invalid_event");
        if (aggregateRevision == 0L
                || aggregateRevision != nonNegativeLong(event, "revision", "invalid_event")) {
            throw new ContractFailure(true, "invalid_event",
                    "event revisions must be equal and positive");
        }
        if (exactLong(event.get("schemaVersion"), "schemaVersion") != eventSchemaVersion) {
            throw new ContractFailure(true, "invalid_event", "event schema version is invalid");
        }
        String occurredAt = requiredString(event, "occurredAt", "invalid_event");
        String timestamp = requiredString(event, "timestamp", "invalid_event");
        try {
            if (!Instant.parse(occurredAt).equals(Instant.parse(timestamp))) {
                throw new ContractFailure(true, "invalid_event",
                        "event timestamps disagree");
            }
        } catch (DateTimeParseException failure) {
            throw new ContractFailure(true, "invalid_event",
                    "event timestamp is invalid", failure);
        }
        Map<String, Object> data =
                stringMap(event.get("data"), "event data", "invalid_event");
        Map<String, Object> payload =
                stringMap(event.get("payload"), "event payload", "invalid_event");
        JsonElement dataJson = toJson(data, 0);
        JsonElement payloadJson = toJson(payload, 0);
        if (!dataJson.equals(payloadJson)
                || !aggregateId.equals(requiredUuid(data, "playerId", "invalid_event"))
                || aggregateRevision != nonNegativeLong(data, "revision", "invalid_event")) {
            throw new ContractFailure(true, "invalid_event",
                    "event data does not reconcile with its aggregate");
        }
        validateStatusSnapshot(data, aggregateId, "invalid_event");
        String role = requiredString(data, "participantRole", "invalid_event");
        Set<String> roles = combatTags ? V3_PARTICIPANT_ROLES : PARTICIPANT_ROLES;
        if (!roles.contains(role)) {
            throw new ContractFailure(true, "invalid_event",
                    "event participantRole is invalid");
        }
        validateCounterparty(data, role);
        Object actorRaw = event.get("actor");
        if (actorRaw == null) {
            if (!"system".equals(role)
                    || event.get("actorPlayerId") != null
                    || event.get("actingPrincipal") != null
                    || event.get("principal") != null) {
                throw new ContractFailure(true, "invalid_event",
                        "system event actor fields are inconsistent");
            }
        } else {
            UUID actor = uuid(actorRaw, "actor", "invalid_event");
            if (!actor.equals(requiredUuid(event, "actorPlayerId", "invalid_event"))
                    || !("player:" + actor).equals(
                            requiredString(event, "actingPrincipal", "invalid_event"))
                    || !("player:" + actor).equals(
                            requiredString(event, "principal", "invalid_event"))
                    || "system".equals(role)) {
                throw new ContractFailure(true, "invalid_event",
                        "player event actor fields are inconsistent");
            }
            if ("aggressor".equals(role) && !actor.equals(aggregateId)) {
                throw new ContractFailure(true, "invalid_event",
                        "aggressor event actor must match the aggregate");
            }
            if ("victim".equals(role)
                    && !actor.equals(requiredUuid(data, "counterparty", "invalid_event"))) {
                throw new ContractFailure(true, "invalid_event",
                        "victim event actor must match the counterparty");
            }
        }
        validateLocation(event, "invalid_event");
        toJson(event, 0);
        return new EventIdentity(eventId, aggregateId, aggregateRevision);
    }

    private static void validateCounterparty(Map<String, Object> data, String role) {
        boolean hasCounterparty = data.get("counterparty") != null;
        boolean hasPrincipal = data.get("counterpartyPrincipal") != null;
        if (hasCounterparty != hasPrincipal) {
            throw new ContractFailure(true, "invalid_event",
                    "counterparty and counterpartyPrincipal must be present together");
        }
        if ("aggressor".equals(role) && !hasCounterparty) {
            throw new ContractFailure(true, "invalid_event",
                    "aggressor event must identify its counterparty");
        }
        if (hasCounterparty) {
            UUID counterparty = requiredUuid(data, "counterparty", "invalid_event");
            if (!("player:" + counterparty).equals(
                    requiredString(data, "counterpartyPrincipal", "invalid_event"))) {
                throw new ContractFailure(true, "invalid_event",
                        "counterparty principal does not match its player");
            }
        }
    }

    private static void validateLocation(Map<String, Object> value, String code) {
        boolean hasWorld = value.get("world") != null;
        boolean hasPosition = value.get("position") != null;
        if (hasWorld != hasPosition) {
            throw new ContractFailure(true, code,
                    "world and position must be present together");
        }
        if (!hasWorld) return;
        if (requiredString(value, "world", code).isBlank()) {
            throw new ContractFailure(true, code, "world must not be blank");
        }
        if (value.containsKey("worldKey")
                && !java.util.Objects.equals(value.get("world"), value.get("worldKey"))) {
            throw new ContractFailure(true, code, "world and worldKey disagree");
        }
        Map<String, Object> position = stringMap(value.get("position"), "position", code);
        finiteNumber(position, "x", code);
        finiteNumber(position, "y", code);
        finiteNumber(position, "z", code);
    }

    private static void validateContext(Map<String, Object> value, String code) {
        if (value.get("context") == null) return;
        Map<String, Object> context = stringMap(value.get("context"), "context", code);
        validatePlayerPrincipal(context, "aggressor", code);
        validatePlayerPrincipal(context, "victim", code);
        if (context.containsKey("owner")) requiredString(context, "owner", code);
        if (context.containsKey("structureId")) requiredString(context, "structureId", code);
        if (context.containsKey("homesteadId")) requiredString(context, "homesteadId", code);
        requiredBoolean(context, "trespass", code);
        if (context.containsKey("jurisdiction")) requiredString(context, "jurisdiction", code);
        if (context.containsKey("kinshipConflictId")) {
            requiredString(context, "kinshipConflictId", code);
        }
    }

    private static void validatePlayerPrincipal(
            Map<String, Object> value, String name, String code) {
        String principal = requiredString(value, name, code);
        if (!principal.startsWith("player:")) {
            throw new ContractFailure(true, code, name + " must be a player principal");
        }
        uuid(principal.substring("player:".length()), name, code);
    }

    private JsonObject metadata() {
        JsonObject result = new JsonObject();
        result.addProperty("protocolVersion", protocolVersion);
        result.addProperty("eventSchemaVersion", eventSchemaVersion);
        return result;
    }

    private static JsonObject emptyChecks() {
        JsonObject checks = new JsonObject();
        checks.addProperty("strictlyIncreasing", false);
        checks.addProperty("eventIdsUnique", false);
        checks.addProperty("aggregateMatches", false);
        checks.addProperty("withinBound", false);
        checks.addProperty("maximumRevision", 0L);
        return checks;
    }

    private JsonObject failure(ContractFailure failure) {
        return failure(failure.installed(), failure.code(), failure);
    }

    private JsonObject failure(
            boolean installed, String code, RuntimeException failure) {
        return failure(installed, code, message(failure));
    }

    private JsonObject failure(boolean installed, String code, String detail) {
        JsonObject result = metadata();
        result.addProperty("installed", installed);
        result.addProperty("available", false);
        result.addProperty("error", code);
        result.addProperty("detail", detail);
        return result;
    }

    private static String message(Throwable failure) {
        String value = failure.getMessage();
        if (value == null || value.isBlank()) value = failure.getClass().getSimpleName();
        return value.length() <= 512 ? value : value.substring(0, 512);
    }

    private static boolean booleanValue(JsonObject value, String name) {
        return value.has(name) && value.get(name).isJsonPrimitive()
                && value.get(name).getAsJsonPrimitive().isBoolean()
                && value.get(name).getAsBoolean();
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> stringMap(Object raw, String name, String code) {
        if (!(raw instanceof Map<?, ?> map) || map.size() > MAX_JSON_COLLECTION) {
            throw new ContractFailure(true, code, name + " must be a bounded map");
        }
        Map<String, Object> result = new LinkedHashMap<>();
        int count = 0;
        for (Map.Entry<?, ?> entry : map.entrySet()) {
            if (!(entry.getKey() instanceof String key)) {
                throw new ContractFailure(true, code, name + " keys must be strings");
            }
            if (++count > MAX_JSON_COLLECTION || key.length() > MAX_JSON_KEY) {
                throw new ContractFailure(true, code, name + " must be a bounded map");
            }
            result.put(key, entry.getValue());
        }
        return result;
    }

    private static String requiredString(
            Map<String, Object> value, String name, String code) {
        Object raw = value.get(name);
        if (!(raw instanceof String string)
                || string.isBlank()
                || string.length() > MAX_JSON_STRING) {
            throw new ContractFailure(true, code, name + " must be a non-blank string");
        }
        return string;
    }

    private static boolean requiredBoolean(
            Map<String, Object> value, String name, String code) {
        Object raw = value.get(name);
        if (!(raw instanceof Boolean bool)) {
            throw new ContractFailure(true, code, name + " must be a boolean");
        }
        return bool;
    }

    private static UUID requiredUuid(
            Map<String, Object> value, String name, String code) {
        return uuid(value.get(name), name, code);
    }

    private static UUID uuid(Object raw, String name, String code) {
        if (!(raw instanceof String string) || string.length() > 64) {
            throw new ContractFailure(true, code, name + " must be a UUID string");
        }
        try {
            return UUID.fromString(string);
        } catch (IllegalArgumentException failure) {
            throw new ContractFailure(true, code, name + " must be a UUID string", failure);
        }
    }

    private static long nonNegativeLong(
            Map<String, Object> value, String name, String code) {
        long result;
        try {
            result = exactLong(value.get(name), name);
        } catch (ContractFailure failure) {
            throw new ContractFailure(true, code, failure.getMessage(), failure);
        }
        if (result < 0) {
            throw new ContractFailure(true, code, name + " must not be negative");
        }
        return result;
    }

    private static long exactLong(Object raw, String name) {
        if (!(raw instanceof Number number)) {
            throw new ContractFailure(true, "protocol_shape",
                    name + " must be an exact integer");
        }
        try {
            String representation = number.toString();
            if (representation.length() > MAX_JSON_NUMBER) {
                throw new NumberFormatException("number representation exceeds size bound");
            }
            return new BigDecimal(representation).longValueExact();
        } catch (ArithmeticException | NumberFormatException failure) {
            throw new ContractFailure(true, "protocol_shape",
                    name + " must be an exact integer", failure);
        }
    }

    private static void finiteNumber(
            Map<String, Object> value, String name, String code) {
        Object raw = value.get(name);
        if (!(raw instanceof Number number) || !Double.isFinite(number.doubleValue())) {
            throw new ContractFailure(true, code, name + " must be a finite number");
        }
    }

    private static JsonElement toJson(Object raw, int depth) {
        return toJson(raw, depth, new JsonBudget(MAX_JSON_NODES, MAX_JSON_CHARACTERS));
    }

    private static JsonElement toJson(Object raw, int depth, JsonBudget budget) {
        if (depth > MAX_JSON_DEPTH) {
            throw new ContractFailure(true, "invalid_json", "peer JSON exceeds depth bound");
        }
        budget.claimNode();
        if (raw == null) return JsonNull.INSTANCE;
        if (raw instanceof String string) {
            if (string.length() > MAX_JSON_STRING) {
                throw new ContractFailure(true, "invalid_json",
                        "peer JSON string exceeds size bound");
            }
            budget.claimCharacters(string.length());
            return new JsonPrimitive(string);
        }
        if (raw instanceof Boolean bool) return new JsonPrimitive(bool);
        if (raw instanceof Number number) {
            String representation = number.toString();
            if (representation.length() > MAX_JSON_NUMBER
                    || !Double.isFinite(number.doubleValue())) {
                throw new ContractFailure(true, "invalid_json", "peer JSON number is not finite");
            }
            budget.claimCharacters(representation.length());
            return new JsonPrimitive(new BigDecimal(representation));
        }
        if (raw instanceof UUID uuid) {
            budget.claimCharacters(36);
            return new JsonPrimitive(uuid.toString());
        }
        if (raw instanceof Map<?, ?> map) {
            if (map.size() > MAX_JSON_COLLECTION) {
                throw new ContractFailure(true, "invalid_json",
                        "peer JSON map exceeds size bound");
            }
            JsonObject result = new JsonObject();
            int count = 0;
            for (Map.Entry<?, ?> entry : map.entrySet()) {
                if (!(entry.getKey() instanceof String key)) {
                    throw new ContractFailure(true, "invalid_json",
                            "peer JSON map key is not a string");
                }
                if (++count > MAX_JSON_COLLECTION || key.length() > MAX_JSON_KEY) {
                    throw new ContractFailure(true, "invalid_json",
                            "peer JSON map exceeds size bound");
                }
                budget.claimCharacters(key.length());
                result.add(key, toJson(entry.getValue(), depth + 1, budget));
            }
            return result;
        }
        if (raw instanceof Collection<?> collection) {
            if (collection.size() > MAX_JSON_COLLECTION) {
                throw new ContractFailure(true, "invalid_json",
                        "peer JSON list exceeds size bound");
            }
            JsonArray result = new JsonArray();
            int count = 0;
            for (Object value : collection) {
                if (++count > MAX_JSON_COLLECTION) {
                    throw new ContractFailure(true, "invalid_json",
                            "peer JSON list exceeds size bound");
                }
                result.add(toJson(value, depth + 1, budget));
            }
            return result;
        }
        throw new ContractFailure(true, "invalid_json",
                "unsupported peer JSON value " + raw.getClass().getName());
    }

    private void recordLiveError(String error) {
        synchronized (evidenceLock) {
            if (liveErrors.size() >= MAX_LIVE_ERRORS) liveErrors.removeFirst();
            liveErrors.addLast(error);
        }
    }

    private synchronized void closeSubscription() {
        if (subscription == null) return;
        try {
            subscription.close();
        } catch (Exception failure) {
            recordLiveError("subscription close failed: " + message(failure));
        } finally {
            subscription = null;
            subscribedProtocol = null;
        }
    }

    @Override
    public synchronized void close() {
        closeSubscription();
        synchronized (evidenceLock) {
            liveEvents.clear();
            liveErrors.clear();
            liveEventCharacters = 0;
            liveEventNodes = 0;
        }
    }

    private record Provider(
            Object raw,
            Function<Object, Object> status,
            Function<Object, Object> replay) {
    }

    private record EventIdentity(UUID eventId, UUID aggregateId, long revision) {
    }

    private record LiveEvent(JsonObject value, int characters, int nodes) {
    }

    private static final class JsonBudget {
        private int remainingNodes;
        private int remainingCharacters;
        private int usedNodes;

        private JsonBudget(int remainingNodes, int remainingCharacters) {
            this.remainingNodes = remainingNodes;
            this.remainingCharacters = remainingCharacters;
        }

        private void claimNode() {
            if (remainingNodes-- <= 0) {
                throw new ContractFailure(true, "invalid_json",
                        "peer JSON exceeds node bound");
            }
            usedNodes++;
        }

        private void claimCharacters(int characters) {
            remainingCharacters -= characters;
            if (remainingCharacters < 0) {
                throw new ContractFailure(true, "invalid_json",
                        "peer JSON exceeds character bound");
            }
        }

        private int usedNodes() {
            return usedNodes;
        }
    }

    private static final class ContractFailure extends RuntimeException {
        private final boolean installed;
        private final String code;

        private ContractFailure(boolean installed, String code, String message) {
            super(message);
            this.installed = installed;
            this.code = code;
        }

        private ContractFailure(
                boolean installed, String code, String message, Throwable cause) {
            super(message, cause);
            this.installed = installed;
            this.code = code;
        }

        private boolean installed() {
            return installed;
        }

        private String code() {
            return code;
        }
    }
}
