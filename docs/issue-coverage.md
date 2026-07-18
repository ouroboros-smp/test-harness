# GitHub issue traceability

Every open issue at implementation start has an executable schema-valid
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
| #18–#22 | Coffer Fabric placement, double chest, trust/access policy, API, commands, and restart persistence | `coffer/runtime-acceptance` |
| #24 | Mehen MariaDB/Redis ban enforcement, expiry, pardon, and restart persistence | `mehen/governance-acceptance` |
| #25 | Patrol commands, enforcer lifecycle, reload, and restart | `patrol/runtime-acceptance` |
| #26 | Watershed spring commands, save, restart persistence, and removal | `watershed/spring-lifecycle` |
| #27 | WildAnimalBalancer census, bounded top-up, metrics, reload, and persistence | `wildanimalbalancer/population-acceptance` |
| #28 | OuroMetrics 1.21.11 exporter, config, HTTP metrics, and restart lifecycle | `ourometrics/exporter-lifecycle` |
| #29 | Blindfold 1.21.11 real-client commands, effects, external removal, and sprint behavior | `blindfold/client-gametest` |

`node dist/cli.js validate --require-all-issues` fails if any tracked issue
loses scenario coverage. Unit tests enforce the same invariant, and a separate
portfolio contract test proves that every maintained scenario is executed by
`config/portfolio.yaml` exactly once.

Consumer scenarios intentionally consume packaged jars. The harness does not
copy unit or GameTest logic from a consumer repo. A consumer release gate should
build its server jar, invoke the pinned action with its scenario, and upload the
harness output on both pass and failure.
