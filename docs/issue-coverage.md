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
| #7 | Rooms discovery settle/cooldown/retry/undefined | `rooms/discovery-smoke` |
| #8 | Rooms server-thread/chunk safe degradation | `rooms/thread-safe-scans` |
| #9 | Rooms cross-chunk travel effect reconciliation | `rooms/travel-effects` |
| #10 | Rooms native dialogs and administration | `rooms/dialog-admin` |
| #11 | Rooms sleep occupancy/streak semantics | `rooms/sleep-semantics` |
| #12 | Rooms restart/late-world persistence | `rooms/restart-late-world` |
| #13 | Rooms nameplate lifecycle/entity leak checks | `rooms/nameplate-lifecycle` |
| #14 | Rooms presence/abandonment/tombstones | `rooms/abandonment` |
| #15 | Rooms discovery amplification soak | `rooms/discovery-soak` |
| #16 | Rooms placement attribution/claim ceremony | `rooms/placement-claim` |
| #17 | KeepGear ten-case release acceptance suite | `keepgear/acceptance` |
| #18 | Coffer platform/lifecycle readiness | `coffer/platform-readiness` |
| #19 | Coffer two-player trust/access/persistence | `coffer/access-persistence` |
| #20 | Coffer double-chest lifecycle security | `coffer/double-chest` |
| #21 | Coffer extraction authorization/soak | `coffer/automation` |
| #22 | Coffer server-only packaging/production interoperability | `coffer/release-interop` |

`node dist/cli.js validate --require-all-issues` fails if any issue from 1
through 22 loses scenario coverage. Unit tests enforce the same invariant.

Consumer scenarios intentionally consume packaged jars. The harness does not
copy unit or GameTest logic from a consumer repo. A consumer release gate should
build its server jar, invoke the pinned action with its scenario, and upload the
harness output on both pass and failure.
