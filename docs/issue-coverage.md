# GitHub issue traceability

Every tracked executable issue at implementation start has a schema-valid
scenario or packaging contract. Issues 1–16 were migrated in place from Folia
assumptions to Fabric 26.2, real protocol clients, and the authenticated
harness-only bridge on 2026-07-18.

| Issue | Delivery | Primary verification |
|---:|---|---|
| #1 | Fabric lifecycle, real clients, assertions, reports, global failures | `harness/live-smoke` |
| #2 | Kinship union/family/home/notary/aura/restart | `kinship/functional-smoke` |
| #3 | N-client bounded soak, error/performance thresholds | `harness/stress-smoke` |
| #4 | Kinship aura/command soak | `kinship/stress-soak` |
| #5 | Pinnable composite action and stable outputs/artifacts | `action.yml`, `harness/action-contract` |
| #6 | Kinship server-thread/barrier/logout/generation regressions | `kinship/thread-lifecycle-regressions` |
| #7–#16 | Rooms Fabric discovery, diagnostics, permissions, persistence, reload, restart, and lifecycle behavior | `rooms/runtime-acceptance` |
| #17 | KeepGear ten-case release acceptance suite | `keepgear/acceptance` |
| #18–#19 | Coffer placement, access modes, trust, keys, and restart persistence | `coffer/access-persistence`; legacy safety net `coffer/runtime-acceptance` |
| #20 | Double-chest pair placement, synchronization, and restart | `coffer/double-chest-lifecycle`; legacy safety net `coffer/runtime-acceptance` |
| #21 | Vanilla automation extraction, deposit direction, timing, and logs | `coffer/automation-extraction`; legacy safety net `coffer/runtime-acceptance` |
| #22 | Public API, Common Protection, ObjectShare, and server-only packaging | `coffer/api-protection-packaging`; legacy safety net `coffer/runtime-acceptance` |
| #24 | Mehen MariaDB/Redis ban enforcement, expiry, pardon, and restart persistence | `mehen/governance-acceptance` |
| #25 | Patrol commands, enforcer lifecycle, conflict-v2 attribution/replay, reload, persistence, and restart | `patrol/runtime-acceptance`, `patrol/conflict-v2-contract` |
| #26 | Watershed spring commands, save, restart persistence, and removal | `watershed/spring-lifecycle` |
| #27 | WildAnimalBalancer census, bounded top-up, metrics, reload, and persistence | `wildanimalbalancer/population-acceptance` |
| #28 | OuroMetrics 1.21.11 exporter, config, HTTP metrics, and restart lifecycle | `ourometrics/exporter-lifecycle` |
| #29 | Blindfold 1.21.11 real-client commands, effects, external removal, and sprint behavior | `blindfold/client-gametest` |
| #32 | Server-acknowledged real-client block placement with before/after evidence | `coffer/runtime-acceptance`, `rooms/runtime-acceptance` |
| #33 | Deterministic generated-terrain fixtures for containers, rooms, and entity spawning | `coffer/runtime-acceptance`, `rooms/runtime-acceptance`, `patrol/runtime-acceptance` |
| #34 | Server-tick synchronization for repeated KeepGear death/respawn cases | `keepgear/acceptance` |
| #36 | Authoritative server-position anchoring for cross-player block actions | `coffer/runtime-acceptance` |
| #39 | Composable production-stack behavior contracts; OuroVeil contributes packaged boot, unmodded-client recovery, restart, and companion-client GameTest evidence | `ouroveil/release-acceptance`, `portfolio/full-manifest-compatibility` |
| #42 | Wait for MariaDB's final port-3306 server rather than its temporary initialization server | `mehen/governance-acceptance` |
| #44 | Canonical Coffer counters on the installed FabricExporter endpoint | `coffer/metrics-exporter` |
| #45 | Coffer default, denied, granted, group, policy, and bypass permissions through LuckPerms | `coffer/permissions-luckperms` |
| #46 | Coffer, Rooms, and Kinship principal, management, provider-failure, selective-transfer, phase-0/phase-1 retry, and restart contracts; pre-unfreeze completion remains blocked | `coffer/civilization-stack` |
| #51 | Coffer first-attack lock splintering, Common Protection denial, authorized bypass, double-chest atomic clearing, and destruction handoff | `coffer/lock-breaking` |

Open issue [#39](https://github.com/ouroboros-smp/test-harness/issues/39)
tracks behavioral production-stack interoperability. The executable Coffer
portion is split between `coffer/civilization-stack` and
`coffer/wildanimalbalancer-compatibility`. Its generated
`portfolio/full-manifest-compatibility` foundation proves the exact loader
inventory, real-client join, and restart. `ouroveil/release-acceptance` adds the
first composable first-party behavior contract, but the issue remains open until
the independently owned styled-chat, Relay, vanish, and privacy interactions
listed there are executable.

Issue [#47](https://github.com/ouroboros-smp/test-harness/issues/47) records the
exact Coffer, Rooms, and Parcels boundary criteria. It is deliberately excluded
from `TRACKED_ISSUES` and the maintained portfolio until a packaged Parcels
provider exists. Activation requires proving that Parcels denial precedes Rooms
storage HP, allowed mutation reaches Rooms, and Parcels never grants Coffer
access. The `coffer/lock-breaking` scenario exercises the same Common Protection
composition point with a deterministic harness provider and verifies the Coffer
and vanilla handoff; it does not substitute for #47's packaged Parcels and Rooms
stack.

Issue [#46](https://github.com/ouroboros-smp/test-harness/issues/46) is not
ready to close. `coffer/civilization-stack` now proves independent Rooms
resident and Kinship grants; missing, malformed, throwing, and stale provider
failure; personal and local-trust fallback; selective premises transfer; and
restart/retry idempotency in continuity phases 0 and 1 with packaged jars and
two real clients. The same phase-0 regression shows a revived chest remains
physically present while its Coffer lock is absent. Rooms issue
[#98](https://github.com/ouroboros-smp/rooms-and-structures/issues/98) tracks
the required product fix: keep revival frozen until every consumer restore
completes. After that fix lands, the scenario must be updated and rerun to
assert true pre-unfreeze completion before #46 can close.

Issues #19 through #22 remain open. The focused scenarios map each original
checklist to executable evidence, but the legacy `coffer/runtime-acceptance`
scenario remains as a safety net until every original criterion has passed and
the issue can be closed without overstating coverage.

`node dist/cli.js validate --require-all-issues` fails if any tracked issue
loses scenario coverage. Unit tests enforce the same invariant, and a separate
portfolio contract test proves that every maintained scenario is executed by
`config/portfolio.yaml` exactly once.

Consumer scenarios intentionally consume packaged jars. The harness does not
copy unit or GameTest logic from a consumer repo. A consumer release gate should
build its server jar, invoke the pinned action with its scenario, and upload the
harness output on both pass and failure.
