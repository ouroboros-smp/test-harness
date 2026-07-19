# Ouroboros organization test portfolio assessment

Assessment date: 2026-07-18. Authenticated GitHub inventory snapshot:
2026-07-19 03:25 UTC. Repository source was assessed at each default-branch
head listed below; the `test-harness` baseline was
`4a59a5ca8cf959c341b5d8d010170fa284ce0a35` before the implementation work
accompanying this report.

This document applies the placement rule from the supplied test portfolio plan:
prove a behavior at the lowest layer that can observe it. Unit tests own pure
logic, server or client GameTests own Minecraft behavior, and this harness owns
packaged jars, real protocol sessions, restarts, concurrency, interoperability,
and bounded duration.

The only current Ouroboros runtime in scope is **Fabric 26.2**. Paper/Folia code
is legacy migration context, NeoForge support in an upstream fork is outside the
Ouroboros test obligation, and Minestom is a separately planned future backend.

Throughout this document:

- **Fact** means observed in the linked repository, GitHub API, workflow, or
  supplied local design source at the snapshot above.
- **Recommendation** is proposed work. No recommendation is presented as
  existing coverage.

## Executive findings

1. **The authenticated organization inventory is 26 repositories: seven public
   and 19 private.** None is archived or a template. Two are forks:
   `novoatlas` from `TheDeathlyCow/novoatlas`, and `ouroboros-smp-server` from
   `Minestom/Minestom`. `concord` and `homestead` have no commits/default-branch
   ref; `emojibridge` has only `.gitignore` on `main`.
2. **The highest-value missing harness capability is still a full Fabric mod-set
   interoperability run.** WildAnimalBalancer recently needed a production fix
   because its nested `core` mod id collided with Coffer's nested module; the
   source now documents that exact collision, but no scenario loads the two jars
   together. See the [fixed build convention](https://github.com/ouroboros-smp/WildAnimalBalancer/blob/b2c26f64f2a4c7560242bbfd35b1391685d9660e/core/build.gradle.kts#L20-L24).
3. **The harness catalog is not a production manifest.** It has 11 build targets
   and 15 scenarios, but it neither represents the deployed jar set nor checks
   tested versions against deployed versions. Its CI runs harness self-tests,
   one live self-smoke, and one nightly self-soak—not the full portfolio. See the
   [catalog](https://github.com/ouroboros-smp/test-harness/blob/4a59a5ca8cf959c341b5d8d010170fa284ce0a35/config/portfolio.yaml#L15-L151),
   [CI smoke](https://github.com/ouroboros-smp/test-harness/blob/4a59a5ca8cf959c341b5d8d010170fa284ce0a35/.github/workflows/ci.yml#L43-L71),
   and [nightly soak](https://github.com/ouroboros-smp/test-harness/blob/4a59a5ca8cf959c341b5d8d010170fa284ce0a35/.github/workflows/nightly-soak.yml#L1-L35).
4. **Two deployed-looking Fabric components are absent from the baseline
   catalog.** `ouroboros-relay` contains the current Fabric Discord relay, and
   `world-border-veil` ships the `ouroveil` Fabric mod. NovoAtlas is also absent,
   but should enter the runtime catalog only if its fork/datapacks are deployed.
5. **Relay is the highest-risk first-party gap.** Its 20 test files and coverage
   gate exercise the portable core/JDA mapping, while the CI build excludes
   `fabric-adapter`, uses Java 21, and has no Fabric GameTest or packaged-server
   acceptance. A local fake Discord seam—not a real Discord guild—is needed for
   delivery, ordering, privacy, failure/recovery, and tick-health evidence.
6. **The current Mehen service acceptance layer is not self-contained.**
   `mehen-proxy` has no workflow, and both its integration test and `mehen-e2e`
   resolve migrations from a sibling `../mehen-seed` checkout that is not in the
   live org inventory. Canonical V1-V3 migrations now exist in `mehen`; the E2E
   suite explicitly loads only V1/V2 and the Velocity/NanoLimbo protocol layer
   remains commented-out scaffolding.
7. **Current GitHub Actions failures are infrastructure failures, not test
   verdicts.** The latest jobs sampled for the website, relay, Coffer, Rooms,
   Mehen, and Kinship were rejected before a runner started because the account
   payment/spending limit needs attention. Restore Actions execution before
   treating any new required check as an effective merge gate.
8. **OuroMetrics has useful tests and a good Fabric lifecycle scenario, but no
   repository CI at all.** Its Folia module is legacy. The current Fabric path
   still needs per-push CI, real consumer interoperability, and server-gauge
   GameTests.
9. **Blindfold's current harness scenario is a delegated repository client
   GameTest, not packaged-jar acceptance.** That is sound client coverage, but
   it should be described and owned as a client GameTest unless the harness
   learns to install the built jar into a real packaged client runtime.
10. **Branch checks are generally advisory.** GitHub reports only
   WildAnimalBalancer's default branch as protected; its required status context
   is `build`, while the separate integration workflow is not required. All
   other non-empty default branches report unprotected.

## Implementation delivered with this assessment

This branch turns the deployment-drift recommendation and the foundation of the
full-stack recommendation below into executable gates. It adds a versioned
production manifest with 44 entries (42 enabled), a deterministic
`manifest-check` drift and mods-directory audit, and a generated full-stack
Fabric compatibility scenario. The live runtime
path now inventories loaded mod ids and versions through `/v1/mods`, joins a
real protocol client, restarts the server, and verifies the inventory again.
Behavioral interoperability remains tracked by
[`test-harness#39`](https://github.com/ouroboros-smp/test-harness/issues/39).

The checked-in audit intentionally remains red until the known production gaps
are resolved: Mehen's deployed/tested versions differ; Relay, OuroVeil, and
Secret Spectator lack executable portfolio targets; and third-party versions
still need pinning for strict release use. The repository-specific domain
scenarios in the backlog also remain follow-up work.

## Authenticated inventory and scope decisions

The `Catalog` column describes the baseline harness snapshot above, not changes
implemented alongside this assessment.

| Repository | Visibility / head | Classification | Catalog | Decision |
|---|---|---|---|---|
| [`.github`](https://github.com/ouroboros-smp/.github/tree/24207fe38f36bdf7aa095213a3e29da669c58167) | Public `main` | Org profile/governance | No | Keep out of runtime; host shared test policy |
| [`coffer`](https://github.com/ouroboros-smp/coffer/tree/1d2d7f543045131f96e21096ae59b9e28738846c) | Private `main` | Fabric container protection; Folia legacy | Yes | Keep; prioritize Rooms/Homestead/LuckPerms interop |
| [`concord`](https://github.com/ouroboros-smp/concord) | Private; empty | Planned organization substrate | No | Scope as planned/empty; no executable target |
| [`emojibridge`](https://github.com/ouroboros-smp/emojibridge/tree/d0d8078b8ba985c030883e23b5d03438e96a914a) | Private `main`; `.gitignore` only | Legacy Folia-era scaffold | No | Retire or redefine for Fabric before adding tests |
| [`homestead`](https://github.com/ouroboros-smp/homestead) | Private; empty | Planned claims/offline protection; description is Paper/Folia-era | No | Define Fabric contract first; retain interop scenarios as pending |
| [`KeepGear`](https://github.com/ouroboros-smp/KeepGear/tree/eb53bdc8c5425f2453f4183f857b3e90207f98d1) | Private `main` | Fabric death/inventory policy; Paper/Folia legacy | Yes | Keep; add Kinship/permissions/restart boundaries |
| [`kinship`](https://github.com/ouroboros-smp/kinship/tree/b10c988795507bfebcf7c69253ac827014bfed4e) | Private `main` | Fabric mod plus API/web/Discord services; Paper plugin legacy | Yes | Keep Fabric target; test service contracts separately |
| [`LocalBlindness`](https://github.com/ouroboros-smp/LocalBlindness/tree/25603aad8056361723887a043dee797971e26c0d) | Public `main` | Client-only Blindfold mod | Yes | Keep as client GameTest target; do not claim server acceptance |
| [`mehen`](https://github.com/ouroboros-smp/mehen/tree/cb6204b3c104471594a743e92a950f3376ccebcd) | Private `main` | Fabric governance; Folia module legacy | Yes | Keep; make it the schema/test-fixture authority |
| [`mehen-bot`](https://github.com/ouroboros-smp/mehen-bot/tree/a45dcc24ccc70621f55281824b7bb01a3df190ba) | Private `main` | Discord/governance/stats service | No | Service CI/E2E, not Fabric runtime catalog |
| [`mehen-e2e`](https://github.com/ouroboros-smp/mehen-e2e/tree/797263a34a0f9ca5036a8b90dcc0f48dfef468dd) | Private `master` | MariaDB/Redis acceptance scaffold | No | Repair and own cross-service acceptance outside runtime catalog |
| [`mehen-proxy`](https://github.com/ouroboros-smp/mehen-proxy/tree/113562857840a894052d01a540aeacd2e6175eee) | Private `master` | Velocity access gate | No | Add service CI and protocol acceptance; not a Fabric jar |
| [`novoatlas`](https://github.com/ouroboros-smp/novoatlas/tree/2b53762e226a331628ec23c39ef0e60e3b3e280f) | Public fork `26.2.x` | Fabric 26.2 world generator; NeoForge ignored | No | Add only if deployed; otherwise explicit conditional scope |
| [`ouro-metrics`](https://github.com/ouroboros-smp/ouro-metrics/tree/73a055e37ed7016dd2953f8bcb623e579c356af7) | Public `main` | Fabric metrics exporter; Folia legacy | Yes | Keep Fabric target; add CI and real consumers |
| [`ouroboros-backend`](https://github.com/ouroboros-smp/ouroboros-backend/tree/a9bed9bca242ccd753883ee1315b6e94048d98e8) | Private `main` | Future Minestom backend | No | Explicitly out of Fabric harness |
| [`ouroboros-chronicle`](https://github.com/ouroboros-smp/ouroboros-chronicle/tree/db448f75f75b117b2097eed35292ccd959af243a) | Private `main` | Wiki/content corpus | No | Add content/link validation, not runtime scenarios |
| [`ouroboros-relay`](https://github.com/ouroboros-smp/ouroboros-relay/tree/91b2bcc4eb730c000966e26d8122d4c95cdb4742) | Private `main` | Fabric Discord relay | No | **P0 runtime catalog and fake-service acceptance gap** |
| [`ouroboros-smp-server`](https://github.com/ouroboros-smp/ouroboros-smp-server/tree/b1bc28f4e16e84ba5e4de890e9eccbfd4e464e70) | Public Minestom fork `master` | Future engine research | No | Explicitly out of Fabric harness |
| [`ouroboros-smp-website`](https://github.com/ouroboros-smp/ouroboros-smp-website/tree/c4f37a0f89b1d252e007e2e9ed2cee2b53ab8586) | Private `main` | Website, Worker, Wiki.js operations | No | Keep service/deploy checks; contract-test stats/auth seams |
| [`ouroboros-worldgen`](https://github.com/ouroboros-smp/ouroboros-worldgen/tree/2831ce4be6f798561cf87f668f66c4b8310bd06c) | Private `main` | Gaea/NovoAtlas datapack pipeline | No | Static pack validation now; conditional world acceptance later |
| [`Patrol`](https://github.com/ouroboros-smp/Patrol/tree/14abb70853467befbd76c4794a04d00340519087) | Private `main` | Fabric justice mod/client; Folia legacy | Yes | Keep Fabric target; drop Folia runtime jobs from target architecture |
| [`rooms-and-structures`](https://github.com/ouroboros-smp/rooms-and-structures/tree/eb382d7254b01939cd90ed9bf4bbecd5cf400c10) | Private `main` | Fabric rooms/structures | Yes | Keep; add real server and boundary interop |
| [`test-harness`](https://github.com/ouroboros-smp/test-harness/tree/4a59a5ca8cf959c341b5d8d010170fa284ce0a35) | Public `main` | Fabric release-level tooling | Yes | Add manifest, drift, relay, veil, and full-set gates |
| [`watershed`](https://github.com/ouroboros-smp/watershed/tree/7f0a064b441a90c39563a443b581cea631e4b327) | Private `main` | Fabric hydrology; Paper/Minestom experiments legacy/non-runtime | Yes | Keep Fabric target; add GameTest, multiplayer, restart/soak |
| [`WildAnimalBalancer`](https://github.com/ouroboros-smp/WildAnimalBalancer/tree/b2c26f64f2a4c7560242bbfd35b1391685d9660e) | Public `main` | Fabric server/client; Paper/Folia legacy | Yes | Keep; expand interop/client/multiplayer/soak |
| [`world-border-veil`](https://github.com/ouroboros-smp/world-border-veil/tree/0fdffbc57dd23931a7402ad2ef6522d920409852) | Private `main` | Fabric `ouroveil` border/fog mod | No | **P0 catalog/manifest gap**; add full-set smoke |

## Current test-layer and harness-risk census

Counts are source annotations or test declarations, not assertions within one
test method.

| Repository | Repo-level tests | Packaged artifact | Restart | Mod interop | Multiple players | Soak |
|---|---:|---|---|---|---|---|
| `.github` | 0 | N/A | N/A | N/A | N/A | N/A |
| `coffer` | 79 JUnit declarations; 9 Fabric GameTests | Yes | Yes | No | Two-client access policy | No |
| `concord` | Empty repository | N/A | N/A | N/A | N/A | N/A |
| `emojibridge` | `.gitignore` only | N/A | N/A | N/A | N/A | N/A |
| `homestead` | Empty repository | N/A | N/A | N/A | N/A | N/A |
| `KeepGear` | 16 JUnit declarations; 1 Fabric GameTest | Yes | Yes | Kinship boundary is simulated, not a loaded Kinship jar | Yes | No |
| `kinship` | 265 Java test declarations; 26 Fabric GameTests; 39 TypeScript test files | Yes | Yes | No real companion mod | Yes | 60-second Kinship-only churn |
| `LocalBlindness` | 9 JUnit methods; 1 client GameTest class | **No**: current scenario invokes the checkout's Gradle GameTest | Config/launch restart unproven | Client-mod compatibility unproven | N/A | No |
| `mehen` | 162 JUnit declarations, including 10 in legacy Folia | Yes | Yes | No loaded companion mod | Moderator + target | No |
| `mehen-bot` | 24 Vitest files, about 216 test declarations | Service, not Fabric jar | Service lifecycle unproven | SQL/Redis contracts only | N/A | No |
| `mehen-e2e` | 3 Vitest acceptance files, 21 declarations | No protocol stack | Database/Redis containers are recreated | Mehen schema replicas only | N/A | No |
| `mehen-proxy` | 56 JUnit declarations across 7 unit and 1 integration files | No tested deployable proxy stack | No | DB/Redis only; sibling migration path is stale | Simulated logins | No |
| `novoatlas` | 0 | No | No | No | No | No |
| `ouro-metrics` | 12 JUnit methods | Yes, Fabric jar | Yes | No real consumer jar | No live player-gauge change | No |
| `ouroboros-backend` | 1 Minestom boot test | Future backend, not Fabric | No | No | No | No |
| `ouroboros-chronicle` | 0 automated content checks | N/A | N/A | Website publishing contract unproven | N/A | N/A |
| `ouroboros-relay` | 185 JUnit declarations in core/JDA; 0 adapter tests/GameTests | **No baseline harness target** | No | Styled-chat/vanish/Mehen name contracts unproven | No | No |
| `ouroboros-smp-server` | 1,304 JUnit methods and 11 jcstress tests inherited from Minestom; 0 Ouroboros runtime tests | No Ouroboros app artifact | No | No | No Ouroboros flow | No Ouroboros flow |
| `ouroboros-smp-website` | 77 Node and 27 Python tests | Deploy artifact/service | N/A | Stats/auth producer contracts are fixture-level only | N/A | No |
| `ouroboros-worldgen` | 0 | Datapack scaffolds lack generated height/biome images | No | NovoAtlas/Terralith load unproven | No | No |
| `Patrol` | 113 active Fabric/core JUnit declarations, 10 Fabric GameTests; 113 legacy Folia declarations | Yes | Yes | Mehen justice handoff unproven | Limited | No |
| `rooms-and-structures` | 459 JUnit declarations; 0 GameTests | Yes | Yes | Coffer/Homestead boundaries unproven | One client | No |
| `test-harness` | 16 TypeScript tests, 2 Rust tests, 1 bridge JUnit test, 15 YAML scenarios | Self-smoke boots packaged Fabric dependencies | Framework support exists | No full-set scenario | Framework/self scenarios support it | Self-soak only |
| `watershed` | 45 active core/Fabric JUnit declarations; 3 legacy/experimental declarations; 0 GameTests | Yes | Yes | No | One client | No |
| `WildAnimalBalancer` | 41 JUnit methods; 3 annotated Fabric GameTests | Yes, Fabric jar | Yes | No | No; current harness uses one client | No mod-specific soak |
| `world-border-veil` | 25 JUnit declarations; 3 Fabric GameTests | **No baseline harness target** | Repository boot workflow, no harness restart | No full-set run | No | No |

### Change-recency signal

| Repository | Latest relevant production change | Latest relevant test change | Assessment |
|---|---|---|---|
| `LocalBlindness` | [2026-07-04 rebrand](https://github.com/ouroboros-smp/LocalBlindness/commit/45bbad4a884a6da2209a4e13ea1e861d499dfd94) | [2026-07-18 real-client GameTest](https://github.com/ouroboros-smp/LocalBlindness/commit/25603aad8056361723887a043dee797971e26c0d) | Active client coverage; plain config tests predate the rebrand |
| `novoatlas` | [2026-07-01 generator fix](https://github.com/ouroboros-smp/novoatlas/commit/3489f3d4e93506c70b284e9d1e93757196e09283) | None | Entire test layer absent |
| `ouro-metrics` | [2026-07-15 Fabric exporter](https://github.com/ouroboros-smp/ouro-metrics/commit/73a055e37ed7016dd2953f8bcb623e579c356af7) | Same commit | Fresh tests, but not executed by GitHub Actions |
| `test-harness` | [2026-07-18 authoritative block anchors](https://github.com/ouroboros-smp/test-harness/commit/bb667bca4f7689ca42a98f771b6de282e8e112b2) | [2026-07-18 portfolio stabilization](https://github.com/ouroboros-smp/test-harness/commit/a351884d1d9617098a8af1666bf2c4ec954fac98) plus scenario change in the production commit | Active, but scenario-heavy error paths need more unit contracts |
| `WildAnimalBalancer` | [2026-07-16 cross-mod id fix](https://github.com/ouroboros-smp/WildAnimalBalancer/commit/b2d6b20499d8e0352c1887d27af0e4183b6d6e00) | [2026-07-16 census unit/GameTest fix](https://github.com/ouroboros-smp/WildAnimalBalancer/commit/c5ae1aeff1dcc7e6e88a767212ce9544bb7a219d) | Tests are active, but the newest production fix is observable only through missing interop coverage |

Private-repository recency is generally healthy: test changes landed on the
same day as the latest production changes in every active Fabric repository
sampled. That freshness does not replace missing runtime layers.

| Repository | Latest production-source change | Latest test change | Assessment |
|---|---|---|---|
| `coffer` | [2026-07-17](https://github.com/ouroboros-smp/coffer/commit/91b147a) | Same commit | Fresh unit/GameTest work; cross-mod boundary remains the gap |
| `KeepGear` | [2026-07-16](https://github.com/ouroboros-smp/KeepGear/commit/a7e878b) | Same commit | Fresh Fabric automation |
| `kinship` | [2026-07-16](https://github.com/ouroboros-smp/kinship/commit/4ec3bc2) | Same commit | Fresh and broad; cross-service/companion-mod coverage still missing |
| `mehen` | [2026-07-17](https://github.com/ouroboros-smp/mehen/commit/f1b9901) | Same commit | Fresh unit/integration coverage; no Fabric GameTests |
| `mehen-bot` | [2026-07-14](https://github.com/ouroboros-smp/mehen-bot/commit/6ef2e27) | Same commit | Fresh service tests; no system E2E |
| `mehen-e2e` | N/A (test repository) | [2026-07-02](https://github.com/ouroboros-smp/mehen-e2e/commit/8f35f0b) | Recent but tied to retired migration path and no CI |
| `mehen-proxy` | [2026-07-18](https://github.com/ouroboros-smp/mehen-proxy/commit/9546b8c) | Same commit | Fresh unit coverage; integration suite is not self-contained |
| `ouroboros-backend` | [2026-07-08](https://github.com/ouroboros-smp/ouroboros-backend/commit/ba29fbf) | Same commit | Walking-skeleton test only; future runtime |
| `ouroboros-relay` | [2026-07-18](https://github.com/ouroboros-smp/ouroboros-relay/commit/35b23c4) | [2026-07-18](https://github.com/ouroboros-smp/ouroboros-relay/commit/92e98ba) | Core tests fresh; Fabric adapter still outside CI/test scope |
| `ouroboros-smp-website` | [2026-07-18](https://github.com/ouroboros-smp/ouroboros-smp-website/commit/c4f37a0) | Same commit | Fresh deploy and policy regressions |
| `ouroboros-worldgen` | [2026-07-15](https://github.com/ouroboros-smp/ouroboros-worldgen/commit/2831ce4) | None | No automated datapack/artifact validation |
| `Patrol` | [2026-07-16](https://github.com/ouroboros-smp/Patrol/commit/14abb70) | Same commit | Fresh Fabric/GameTest automation |
| `rooms-and-structures` | [2026-07-17](https://github.com/ouroboros-smp/rooms-and-structures/commit/0d7cccf) | Same commit | Fresh unit/integration coverage; zero GameTests |
| `watershed` | [2026-07-14](https://github.com/ouroboros-smp/watershed/commit/7f0a064) | Same commit | Fabric implementation and tests co-landed; no GameTests |
| `world-border-veil` | [2026-07-16](https://github.com/ouroboros-smp/world-border-veil/commit/36ce86a) | Same commit | Fresh unit/GameTest/boot-smoke coverage |
| `concord`, `homestead`, `emojibridge`, `ouroboros-chronicle` | No runtime source | No automated tests | Empty/scaffold/content repositories need different gates, not runtime test counts |

The Minestom fork is excluded from this recency comparison because its
Ouroboros delta is documentation, not runtime source. The `.github` repository
contains only organization profile content.

### Portfolio CI and release-gate facts

- GitHub's authenticated branch data reports required status checks only for
  WildAnimalBalancer `main` (`build`). Every other non-empty default branch is
  unprotected at the snapshot; empty repositories have no branch ref to protect.
- Current red runs cannot be interpreted as product failures. The latest
  [relay](https://github.com/ouroboros-smp/ouroboros-relay/actions/runs/29667478012),
  [website](https://github.com/ouroboros-smp/ouroboros-smp-website/actions/runs/29670924947),
  [Coffer](https://github.com/ouroboros-smp/coffer/actions/runs/29649922646),
  [Rooms](https://github.com/ouroboros-smp/rooms-and-structures/actions/runs/29621145416),
  [Mehen](https://github.com/ouroboros-smp/mehen/actions/runs/29619651710),
  and [Kinship](https://github.com/ouroboros-smp/kinship/actions/runs/29619269794)
  samples all carry the same GitHub annotation: the job did not start because
  account payments failed or the spending limit must be increased.
- `ouro-metrics`, `mehen-proxy`, `mehen-e2e`, `ouroboros-worldgen`, and
  `ouroboros-chronicle` have no repository verification workflow. The empty or
  one-file scaffolds have nothing executable to verify. NovoAtlas and the
  Minestom fork contain upstream workflow source but no fork Actions history.
- Recommended gate order is therefore: restore runner eligibility; add/repair
  fast repo checks; protect active Fabric/service branches; then make the
  production-manifest boot required for manifest/release changes. A required
  check that cannot start is not a functioning quality gate.

## Repository assessments

### `.github`

**Facts**

- The repository contains a single public organization profile describing the
  Fabric server and Discord-linked governance system; it has no workflows,
  templates, or tests. See the [profile](https://github.com/ouroboros-smp/.github/blob/24207fe38f36bdf7aa095213a3e29da669c58167/profile/README.md).
- It is not a runtime artifact and does not belong in `config/portfolio.yaml`.

**Recommendations**

- Add an organization-default `test-gap` issue form here. Require promised
  behavior, current coverage, selected lowest layer, failure risk, a
  mutation/revert-seen-red checkbox, CI wiring, and traceability.
- Add reusable Fabric 26.2 unit/GameTest workflow conventions only after the
  current per-repo Gradle patterns have been reconciled. Do not create a runtime
  scenario for this repository.

### `coffer`

**Facts**

- The current product path is Fabric 26.2 (`core` plus `fabric`); `folia` remains
  in the build only as legacy migration context. The Fabric build runs 79 JUnit
  declarations, nine GameTests, coverage checks, release-jar verification, and
  a manual release runbook. See the [Fabric build](https://github.com/ouroboros-smp/coffer/blob/1d2d7f543045131f96e21096ae59b9e28738846c/fabric/build.gradle.kts),
  [GameTest manifest](https://github.com/ouroboros-smp/coffer/blob/1d2d7f543045131f96e21096ae59b9e28738846c/fabric/src/gametest/resources/fabric.mod.json),
  and [CI](https://github.com/ouroboros-smp/coffer/blob/1d2d7f543045131f96e21096ae59b9e28738846c/.github/workflows/ci.yml).
- The baseline harness already exercises the packaged `1.3.0` jar with two
  clients, placement/ownership/trust, lock modes, double chests, hopper and
  copper-golem overrides, API inspection, and restart persistence. It does not
  load Rooms, Homestead, LuckPerms, or WildAnimalBalancer beside Coffer.
- Coffer's nested portable module has mod id `coffer-core`. A recent
  WildAnimalBalancer packaging fix explicitly cites collision with this id,
  making cross-mod packaging a demonstrated regression class rather than a
  hypothetical one.

**Recommendations**

- **P0 harness:** make Coffer + WildAnimalBalancer a packaged-jar regression in
  the full production manifest and assert behavioral readiness for both mods.
- **P1 harness:** load real LuckPerms and prove deny/grant/hot group changes;
  then load Rooms and the future Fabric Homestead implementation and enforce
  the ownership boundary: Coffer controls access, Rooms durability, Homestead
  offline inviolability.
- **GameTest/harness:** extend automation evidence to real hopper/golem timing,
  paired-container edge cases, break/explosion paths, and concurrent owner/trust
  changes. Keep Folia out of the target runtime.

### `concord`

**Facts**

- The private repository is empty: GitHub exposes no commit/default-branch ref,
  tests, workflow, or artifact. Its description calls it an organization
  substrate.

**Recommendations**

- Classify it as `planned-empty` in the org inventory and do not manufacture a
  harness target. Before implementation, add a Fabric-facing responsibility
  statement and contract boundaries so organization behavior is not duplicated
  across Kinship, Mehen, and Homestead.

### `emojibridge`

**Facts**

- The default branch contains only [`.gitignore`](https://github.com/ouroboros-smp/emojibridge/blob/d0d8078b8ba985c030883e23b5d03438e96a914a/.gitignore).
  Historical pull-request workflow runs do not correspond to executable source
  on the assessed head. Repository metadata still describes a Folia emoji
  bridge, which is outside the current Fabric 26.2 runtime.

**Recommendations**

- Retire/archive the scaffold or write a new Fabric/service contract that says
  whether emoji translation belongs in `ouroboros-relay`, `mehen-bot`, or a
  client resource layer. Add no runtime scenario until that ownership and an
  executable artifact exist.

### `homestead`

**Facts**

- The repository is empty and its metadata describes a Paper/Folia claims mod;
  there is no Fabric source, test, workflow, or artifact to assess.
- The supplied Rooms ADR nevertheless defines a future boundary: Homestead owns
  claim scope and offline inviolability, while Rooms detects structures and
  Coffer owns container access. That is intended architecture, not implemented
  coverage.

**Recommendations**

- Classify the repo as `planned-empty` and convert the ADR into a Fabric 26.2
  API/behavior contract before implementation. When source exists, start with
  pure claim-geometry/state tests and Fabric GameTests, then enable the pending
  Rooms+Coffer+Homestead harness scenario. Do not revive a Folia runtime profile.

### `KeepGear`

**Facts**

- Active development is under `fabric/`, pinned to Minecraft 26.2 and Java 25;
  the root Paper/Folia implementation is legacy. Sixteen JUnit declarations and
  one Fabric GameTest cover the selective-drop policy and real death flow. CI
  runs build, GameTest, and a focused coverage gate. See the
  [Fabric test configuration](https://github.com/ouroboros-smp/KeepGear/blob/eb53bdc8c5425f2453f4183f857b3e90207f98d1/fabric/build.gradle),
  [GameTest manifest](https://github.com/ouroboros-smp/KeepGear/blob/eb53bdc8c5425f2453f4183f857b3e90207f98d1/fabric/src/gametest/resources/fabric.mod.json),
  and [workflow](https://github.com/ouroboros-smp/KeepGear/blob/eb53bdc8c5425f2453f4183f857b3e90207f98d1/.github/workflows/ci.yml).
- The packaged harness scenario is unusually strong: precedence, inventory/XP,
  permission, reload, restart-while-dead recovery, and copy behavior. Its
  Kinship item boundary is simulated without loading the Kinship jar.

**Recommendations**

- Load real Kinship and LuckPerms artifacts for the soulbound/keep policy and
  hot-permission boundary. Add two-player death/drop/pickup contention and
  disconnect/respawn/restart races. Keep Paper/Folia checks out of the Fabric
  release gate.

### `kinship`

**Facts**

- Kinship combines a Fabric mod, portable Java core, API, web app, and Discord
  bot; `minecraft-plugin` is the legacy Paper adapter. The repository has 265
  Java test declarations, 26 Fabric GameTests, and 39 TypeScript test files.
  CI separates containers, Node services, Java/Fabric, and Mehen-link tests. See
  [test scripts](https://github.com/ouroboros-smp/kinship/blob/b10c988795507bfebcf7c69253ac827014bfed4e/package.json),
  [Fabric GameTests](https://github.com/ouroboros-smp/kinship/blob/b10c988795507bfebcf7c69253ac827014bfed4e/minecraft-fabric/src/gametest/resources/fabric.mod.json),
  and [CI jobs](https://github.com/ouroboros-smp/kinship/blob/b10c988795507bfebcf7c69253ac827014bfed4e/.github/workflows/ci.yml).
- The baseline harness has the deepest portfolio coverage: multi-client family,
  home, notary, aura, persistence, server-thread/logout regressions, and a
  60-second churn scenario. It does not load companion first-party mods or the
  remote API/Discord deployment as one system.

**Recommendations**

- Keep pure API/web/bot contracts and container smoke in Kinship CI. Add a
  separate service E2E profile for auth failures, slow/unreachable API,
  retries/idempotency, schema migration, and Discord delivery; never use real
  Discord in test.
- In the Fabric harness, load KeepGear, Rooms, Coffer, Homestead when available,
  and LuckPerms. Prove soulbound/drop precedence, home/claim ownership, hot
  permissions, remote-mode recovery, and restart without duplicate lineage or
  notary events.

### `LocalBlindness` / Blindfold

**Facts**

- The mod promises a keybind and client command, Blindness and Darkness modes,
  a scoped sprint/swim bypass, config persistence for style/key/icon, and a
  deliberately session-only on/off state. See the [behavior list](https://github.com/ouroboros-smp/LocalBlindness/blob/25603aad8056361723887a043dee797971e26c0d/README.md#L3-L8)
  and [configuration](https://github.com/ouroboros-smp/LocalBlindness/blob/25603aad8056361723887a043dee797971e26c0d/README.md#L42-L56).
- Nine unit methods cover config defaults/style normalization and toggle state.
  One real-client GameTest exercises commands, both effects, external effect
  removal/reassertion, cleanup, and sprint scoping. CI runs both `build` and
  `runClientGameTest` on push and pull request. See the
  [client GameTest](https://github.com/ouroboros-smp/LocalBlindness/blob/25603aad8056361723887a043dee797971e26c0d/src/gametest/java/com/ouroboros/localblindness/gametest/BlindfoldClientGameTest.java#L19-L102)
  and [workflow](https://github.com/ouroboros-smp/LocalBlindness/blob/25603aad8056361723887a043dee797971e26c0d/.github/workflows/build.yml#L1-L61).
- The harness scenario declares a packaged consumer artifact but does not use it;
  it runs `build runClientGameTest` in the repository checkout. See the
  [scenario](https://github.com/ouroboros-smp/test-harness/blob/4a59a5ca8cf959c341b5d8d010170fa284ce0a35/scenarios/blindfold/client-gametest.yaml#L14-L33).

**Recommendations**

- **Unit:** add temporary-directory tests for first-run write, round-trip save,
  malformed JSON recovery, reload, and a non-writable path. These are plain
  filesystem/config behaviors.
- **Client GameTest:** add keybind activation, `showEffectIcon`, config reload
  and style persistence, respawn/dimension reassertion, and a second launch
  proving the on/off state resets while style persists.
- **Harness:** either reclassify the current portfolio entry as repo-owned client
  GameTest orchestration or build a genuine packaged-client profile that
  installs `blindfold-*.jar`. Do not add a server adapter; the mod intentionally
  has no server boundary.
- Protect the default branch with the existing build and client-GameTest jobs as
  required checks.

### `mehen`

**Facts**

- Mehen's active runtime is Fabric governance backed by MariaDB/Redis. Its
  portable core has 136 JUnit declarations including Testcontainers integration
  coverage; the Fabric adapter has 16 unit declarations but no GameTests. Ten
  additional declarations are in the legacy Folia adapter. See the
  [module build](https://github.com/ouroboros-smp/mehen/blob/cb6204b3c104471594a743e92a950f3376ccebcd/settings.gradle.kts),
  [core integration task](https://github.com/ouroboros-smp/mehen/blob/cb6204b3c104471594a743e92a950f3376ccebcd/core/build.gradle.kts),
  and [Fabric manifest](https://github.com/ouroboros-smp/mehen/blob/cb6204b3c104471594a743e92a950f3376ccebcd/fabric/src/main/resources/fabric.mod.json).
- The baseline harness uses the packaged Fabric jar plus real MariaDB/Redis to
  prove ban, expiry, pardon, reconnect denial, and restart persistence. It does
  not prove LuckPerms changes, Velocity access-gate behavior, bot delivery, or
  other companion mods.
- `mehen/db/migration` contains canonical V1, V2, and V3 migrations, yet the
  proxy/E2E repositories still point at a retired `../mehen-seed` sibling. The
  latest release is `v2.0.0`, while the default Gradle build still falls back to
  `1.0.5`; this is exactly the artifact/deployment drift the production
  manifest must make explicit.

**Recommendations**

- Make Mehen the single schema-fixture authority: publish/copy its migrations
  deterministically into proxy, bot, and E2E test runs, and test upgrades
  through V3 rather than maintaining SQL replicas.
- Add Fabric GameTests for command registration, permissions, server-thread
  scheduling, and lifecycle readiness. Expand the harness with real LuckPerms,
  a Velocity/service profile, concurrent moderation/idempotency, Redis outage
  and recovery, and stable tick health.
- Derive release and manifest versions from one source and remove legacy Folia
  from the active Fabric release gate.

### `mehen-bot`

**Facts**

- This Node/TypeScript service bridges Discord, MariaDB, Redis, Kinship, map
  access, and public stats. Twenty-four Vitest files (about 216 declarations)
  cover handlers and logic, and CI runs build plus tests. See the
  [package scripts](https://github.com/ouroboros-smp/mehen-bot/blob/a45dcc24ccc70621f55281824b7bb01a3df190ba/package.json)
  and [CI](https://github.com/ouroboros-smp/mehen-bot/blob/a45dcc24ccc70621f55281824b7bb01a3df190ba/.github/workflows/ci.yml).
- The README still says it runs beside the Mehen Folia plugin, so operational
  documentation does not reflect the Fabric-only runtime. There is no deployed
  bot+database+Redis+Kinship+website contract test.

**Recommendations**

- Update runtime documentation to Fabric and keep the service outside the
  Fabric jar catalog. Build a local service E2E profile with fake Discord/JDA,
  canonical Mehen migrations, Redis/MariaDB containers, and a fake/real Kinship
  API. Cover duplicate/reordered events, retries, timeouts, idempotency, privacy,
  and recovery.
- Publish a versioned public-stats schema and run consumer contract tests in the
  website. Do the same for map-access and Kinship payloads.

### `mehen-e2e`

**Facts**

- The repository has three Vitest acceptance files (21 declarations) for access
  SQL, link flow, and evasion detection against real MariaDB/Redis. It has no
  GitHub workflow. See the [suite inventory](https://github.com/ouroboros-smp/mehen-e2e/blob/797263a34a0f9ca5036a8b90dcc0f48dfef468dd/README.md#L27-L41).
- Global setup reads V1/V2 from `../mehen-seed/db/migration`; that sibling is not
  one of the 26 authenticated repositories. It omits Mehen's V3 migration. The
  Velocity and NanoLimbo services are commented-out scaffolds, so this is a
  database contract suite, not an end-to-end Minecraft access test. See
  [global setup](https://github.com/ouroboros-smp/mehen-e2e/blob/797263a34a0f9ca5036a8b90dcc0f48dfef468dd/tests/setup/globalSetup.ts)
  and [compose](https://github.com/ouroboros-smp/mehen-e2e/blob/797263a34a0f9ca5036a8b90dcc0f48dfef468dd/docker-compose.yml).

**Recommendations**

- **P0:** consume migrations from `mehen`, include V3 and upgrade paths, make
  the checkout self-contained, and add CI with reliable teardown/artifacts.
- Finish the protocol layer with a built `mehen-proxy` jar and pinned local
  Velocity/NanoLimbo artifacts. Prove allowed transfer, every denial packet,
  expired ban, link completion, evasion policy, Redis/DB outage, reconnect, and
  concurrent attempts. Keep this as a service/protocol gate beside—not inside—the
  Fabric-only runtime portfolio.

### `mehen-proxy`

**Facts**

- The Velocity access gate has 56 JUnit declarations across seven unit files and
  one Testcontainers integration file. There is no workflow or branch
  protection. `build` depends on `shadowJar` but not `integrationTest`, so a
  normal build does not execute the real database suite. See the
  [Gradle test wiring](https://github.com/ouroboros-smp/mehen-proxy/blob/113562857840a894052d01a540aeacd2e6175eee/build.gradle.kts).
- The integration test tells Flyway to load
  `filesystem:../mehen-seed/db/migration`, the same missing-sibling defect as
  `mehen-e2e`. Unit coverage does not prove a deployable Velocity+NanoLimbo
  access flow.

**Recommendations**

- Add CI for unit, canonical-schema integration, shaded-jar inspection, and the
  repaired `mehen-e2e` protocol suite; make the integration task part of the
  verification lifecycle. Require the check once organization Actions can run.
- Cover forced-host routing, allow/deny transfer, reconnect, Redis/DB failures,
  stale/duplicate link state, protocol-version compatibility, and shutdown.
  This remains a proxy/service target, not a Fabric mod target.

### `novoatlas`

**Facts**

- The repository is an unchanged fork of
  [`TheDeathlyCow/novoatlas`](https://github.com/TheDeathlyCow/novoatlas) at the
  assessed `26.2.x` head. The
  [fork comparison](https://github.com/ouroboros-smp/novoatlas/compare/TheDeathlyCow:26.2.x...ouroboros-smp:26.2.x)
  has no Ouroboros commits.
- It is a data-driven image world generator with built-in example datapacks and
  Fabric and NeoForge artifacts. Ouroboros only needs the Fabric 26.2 side. See
  the [README](https://github.com/ouroboros-smp/novoatlas/blob/2b53762e226a331628ec23c39ef0e60e3b3e280f/README.md#L1-L28)
  and [version pins](https://github.com/ouroboros-smp/novoatlas/blob/2b53762e226a331628ec23c39ef0e60e3b3e280f/gradle.properties#L6-L28).
- The upstream contribution guide explicitly says there is no automated test
  suite and changes are manually tested on both loaders. The build workflow
  therefore proves compilation/packaging, not generator behavior. See
  [testing guidance](https://github.com/ouroboros-smp/novoatlas/blob/2b53762e226a331628ec23c39ef0e60e3b3e280f/CONTRIBUTING.md#L30-L38)
  and the [build workflow](https://github.com/ouroboros-smp/novoatlas/blob/2b53762e226a331628ec23c39ef0e60e3b3e280f/.github/workflows/build.yml#L1-L55).

**Recommendations**

- First record whether NovoAtlas is in the production Fabric manifest. If not,
  record it as available-but-not-deployed and leave it out of routine runs. If
  it is deployed, this is a **P0 catalog gap**.
- **Unit, ideally upstream:** test image decoding, out-of-bounds fallback,
  negative coordinates, map scaling, each interpolation kernel, color-to-biome
  selection, layer precedence, and codec rejection of invalid scale/range data.
- **Server GameTest:** activate each bundled Fabric example pack; probe height,
  surface biome, cave biome, fluid level, and chunk-seam continuity at fixed
  coordinates. Assert a nonzero executed-test count.
- **Harness, only if deployed:** boot the packaged Fabric jar with a versioned
  example datapack, capture deterministic coordinate probes and chunk hashes,
  restart the same world, and generate both old and new chunks. Add NovoAtlas to
  the full-manifest interop boot. No NeoForge harness work is warranted.
- Prefer a pinned upstream release artifact over carrying an unmodified fork;
  if the fork remains, explicitly enable its workflow and protect its branch.

### `ouro-metrics`

**Facts**

- The intended Fabric design is one process-wide Prometheus registry and one
  `/metrics` endpoint, with consumer mods registering counters, gauges, and
  timers through a shared port. See the [module contract](https://github.com/ouroboros-smp/ouro-metrics/blob/73a055e37ed7016dd2953f8bcb623e579c356af7/README.md#L3-L18)
  and [Fabric consumer wiring](https://github.com/ouroboros-smp/ouro-metrics/blob/73a055e37ed7016dd2953f8bcb623e579c356af7/README.md#L32-L78).
- Twelve JUnit methods cover naming/no-op behavior, Fabric config defaults and
  validation, the static API lifecycle, and one in-memory consumer metric
  scrape. There are no direct tests under `metrics-prometheus`, no Fabric
  GameTests, and no tests under the legacy `folia-plugin`.
- The existing harness scenario correctly exercises the packaged Fabric jar,
  real HTTP endpoint, JVM/server series, restart/rebind, and clean shutdown. See
  [`exporter-lifecycle`](https://github.com/ouroboros-smp/test-harness/blob/4a59a5ca8cf959c341b5d8d010170fa284ce0a35/scenarios/ourometrics/exporter-lifecycle.yaml).
- The repository has no `.github/workflows` directory, so none of those tests
  runs automatically on GitHub.

**Recommendations**

- **P0 CI:** run `./gradlew build` on every Fabric change and pull request, upload
  test reports, and require the check. Treat the Folia module as legacy; do not
  add Folia harness support.
- **Unit:** directly cover counter/gauge/timer exposition, labels and label-count
  errors, duplicate registration, registry caching, concurrent registration and
  update, and timer samples. Add a jar-content contract for relocation and the
  absence of duplicate shared API classes.
- **Server GameTest:** prove player count changes after join/leave, mod count is
  nonzero, the 100-tick refresh cadence fires, disabled metric groups stay
  absent, and the registry clears on stop. Enforce a minimum executed-test
  count.
- **Harness:** load at least two real consumer jars, mutate both consumers, and
  assert their series coexist on the one exporter without duplicate-registration
  or port errors across restart. Exercise a bind failure and prove it does not
  break consumer registry availability.
- Resolve whether OuroMetrics is deployed or superseded before making it a
  production-manifest requirement; the current catalog alone cannot answer that.

### `ouroboros-backend`

**Facts**

- This two-commit repository is a Minestom walking skeleton with Docker/Velocity
  deployment files and one boot test. Its README currently targets Minecraft
  26.1.2, not the Fabric 26.2 runtime, and CI runs `./gradlew build` on Java 25.
  See the [README](https://github.com/ouroboros-smp/ouroboros-backend/blob/a9bed9bca242ccd753883ee1315b6e94048d98e8/README.md),
  [boot test](https://github.com/ouroboros-smp/ouroboros-backend/tree/a9bed9bca242ccd753883ee1315b6e94048d98e8/src/test),
  and [workflow](https://github.com/ouroboros-smp/ouroboros-backend/blob/a9bed9bca242ccd753883ee1315b6e94048d98e8/.github/workflows/build.yml).

**Recommendations**

- Keep it explicitly out of the Fabric harness. If the migration proceeds,
  build a separate Minestom profile for Velocity forwarding/secret rejection,
  world snapshot/import, graceful save/shutdown, container health, protocol
  sessions, and restart persistence. Do not count its boot test as current
  Fabric acceptance.

### `ouroboros-chronicle`

**Facts**

- The repository is a corpus of roughly 96 Markdown/HTML/AsciiDoc pages with no
  README, workflow, tests, or deploy manifest. It contains mixed-case paths and
  some same-topic `.md`/`.html` pairs. The website repository separately says
  Wiki.js owns content and editing, leaving source-of-truth/publish ownership
  unclear.

**Recommendations**

- Decide whether this is a Wiki.js export, authoritative source, or archive.
  Then add the smallest matching content gate: internal-link and asset checks,
  case-collision/duplicate-slug detection, safe HTML validation, required page
  index, and a round-trip/publish dry run. Do not add it to the Fabric runtime
  catalog.

### `ouroboros-relay`

**Facts**

- The root build includes only `relay-core` and `relay-jda`. Those modules have
  20 test files and 185 JUnit declarations, with a core coverage gate. The
  Fabric adapter is a separate composite Gradle build and has no test or
  GameTest source. See the [module layout](https://github.com/ouroboros-smp/ouroboros-relay/blob/91b2bcc4eb730c000966e26d8122d4c95cdb4742/README.md#L10-L24)
  and [settings](https://github.com/ouroboros-smp/ouroboros-relay/blob/91b2bcc4eb730c000966e26d8122d4c95cdb4742/settings.gradle).
- CI installs Java 21 and runs only the root `./gradlew build`; the documented
  Fabric adapter build requires Java 25 and is not invoked. The baseline harness
  has no relay target or scenario. See [CI](https://github.com/ouroboros-smp/ouroboros-relay/blob/91b2bcc4eb730c000966e26d8122d4c95cdb4742/.github/workflows/ci.yml)
  and the [adapter build instructions](https://github.com/ouroboros-smp/ouroboros-relay/blob/91b2bcc4eb730c000966e26d8122d4c95cdb4742/fabric-adapter/README.md).
- The supplied architecture calls for linked-account name translation,
  unlinked-author drops, server-thread handoff, ordering, and external failure
  isolation. None is currently proven in a packaged Fabric server.

**Recommendations**

- **P0 repo CI:** add a Java 25 adapter build, jar-content/dependency check, and
  Fabric GameTests for lifecycle, event registration, server-thread dispatch,
  and configuration. Keep fast core/JDA mapping tests on their current layer.
- **P0 harness:** add the packaged relay jar to the production manifest and a
  local fake Discord transport. Prove outbound and inbound text/name mapping,
  unlinked drop, escaping/styled-chat compatibility, vanished-player privacy,
  stable ordering, endpoint slow/down/recovery, queue bounds, reconnect, clean
  shutdown, and tick health. Never use real Discord credentials or a live guild.
- Load Mehen identity data and the real chat/vanish consumers in the full-set
  scenario so privacy and formatting claims are tested where they can fail.

### `ouroboros-smp-server`

**Facts**

- This is a Minestom fork. The current Ouroboros branch is 13 commits ahead and
  55 behind upstream; its changed files are guidance and design documents, not
  runtime source. See the [upstream comparison](https://github.com/ouroboros-smp/ouroboros-smp-server/compare/Minestom:master...ouroboros-smp:master).
- The inherited Minestom source has 1,304 JUnit test methods, 11 jcstress tests,
  JMH modules, and upstream CI files. Those tests verify Minestom, not the
  proposed Ouroboros server.
- The Ouroboros design explicitly calls for a **new** `ouroboros-backend`
  application consuming a pinned Minestom release from Maven Central, with
  Velocity forwarding, world import, graceful shutdown, and its own build,
  smoke, integration, and protocol E2E tests. See the
  [scope decision](https://github.com/ouroboros-smp/ouroboros-smp-server/blob/b1bc28f4e16e84ba5e4de890e9eccbfd4e464e70/docs/phase-0-walking-skeleton.md#L7-L27)
  and [planned test layers](https://github.com/ouroboros-smp/ouroboros-smp-server/blob/b1bc28f4e16e84ba5e4de890e9eccbfd4e464e70/docs/phase-0-walking-skeleton.md#L193-L211).

**Recommendations**

- Record this fork as **out of the current Fabric harness portfolio**. Do not
  build or run 1,300 upstream library tests as though they accept an Ouroboros
  runtime.
- If Ouroboros later carries Minestom engine patches, keep patch-level unit,
  jcstress, and JMH tests here. Put application boot, proxy forwarding, imported
  world persistence, and governance flows in the separate backend/E2E system.
- Do not broaden the current Fabric 26.2 harness to Minestom as part of this
  work. That is a distinct future runtime profile and migration decision.

### `ouroboros-smp-website`

**Facts**

- The website, Cloudflare Worker, and Wiki.js operations repo has 77 Node tests
  and 27 Python unittest methods covering visual-token contracts, navigation,
  worker auth/CORS/session policy, map access, stats, and Wiki.js tools. `npm
  run check` executes type, syntax, and both test suites. See the
  [package scripts](https://github.com/ouroboros-smp/ouroboros-smp-website/blob/c4f37a0f89b1d252e007e2e9ed2cee2b53ab8586/package.json).
- Its only workflow deploys on pushes to `main`; it verifies production secrets,
  then runs checks and deploys the Worker/theme. Pull requests do not get a
  secret-free verification job. The latest deploy attempts were rejected before
  runner start by the org billing/spend condition. See the
  [deploy workflow](https://github.com/ouroboros-smp/ouroboros-smp-website/blob/c4f37a0f89b1d252e007e2e9ed2cee2b53ab8586/.github/workflows/deploy.yml).

**Recommendations**

- Split `check` into a pull-request/push workflow with no deploy secrets, require
  it on protected `main`, and keep deployment as a gated downstream job. Add a
  post-deploy smoke only after Actions execution is restored.
- Version the public stats, session/map-access, and Chronicle theme contracts.
  Run producer/consumer fixtures against Mehen bot/OuroMetrics/world-border
  values without placing this repository in the Fabric runtime catalog.

### `ouroboros-worldgen`

**Facts**

- This is an authored Gaea -> NovoAtlas -> Terralith pipeline and operating
  guide, not a buildable mod. It contains two datapack scaffolds with four JSON
  files and two `pack.mcmeta` files, but no generated heightmap/biome images,
  tests, or workflow. The README itself says to run a small manual tile first.
  See the [pipeline](https://github.com/ouroboros-smp/ouroboros-worldgen/blob/2831ce4be6f798561cf87f668f66c4b8310bd06c/README.md)
  and [pack scaffolds](https://github.com/ouroboros-smp/ouroboros-worldgen/tree/2831ce4be6f798561cf87f668f66c4b8310bd06c).

**Recommendations**

- Add static validation now: JSON parse/schema, current pack format, referenced
  namespace/resource existence, palette uniqueness, expected image presence,
  dimensions/bit depth, and deterministic checksums for approved exports.
- Once deployable assets exist and NovoAtlas is confirmed in production, add a
  Fabric world profile with fixed biome/height/surface probes, chunk seams,
  restart determinism, and old/new chunk continuity under the full mod set.

### `Patrol`

**Facts**

- The active Fabric path consists of portable core, server adapter, network
  types, and optional client HUD. It has 113 active JUnit declarations and ten
  Fabric GameTests; another 113 declarations are in legacy Folia. The repository
  build and integration workflows still build/test both runtimes, including a
  Folia Mineflayer job. See the [module list](https://github.com/ouroboros-smp/Patrol/blob/14abb70853467befbd76c4794a04d00340519087/settings.gradle.kts),
  [Fabric tests](https://github.com/ouroboros-smp/Patrol/blob/14abb70853467befbd76c4794a04d00340519087/fabric/src/gametest/resources/fabric.mod.json),
  and [integration workflow](https://github.com/ouroboros-smp/Patrol/blob/14abb70853467befbd76c4794a04d00340519087/.github/workflows/integration.yml).
- The baseline harness proves packaged-jar command/enforcer lifecycle, reload,
  and restart cleanup. It does not generate heat through real multi-player PvP,
  load Mehen, prove the optional HUD, or run a Patrol-specific soak.

**Recommendations**

- Narrow required CI to the Fabric 26.2 modules/GameTests/packaged boot; retain
  Folia jobs only as clearly non-production migration history, not a harness
  requirement.
- Add multi-player acceptance for real qualifying/nonqualifying combat, heat
  thresholds/decay, wanted state, enforcer targeting/cleanup, disconnect and
  restart. Load Mehen and prove justice-state handoff/idempotency. Add client
  GameTests for HUD permission, network samples, expiry, and degradation.
- Add a bounded combat/chunk churn soak with tick and entity-count thresholds.

### `rooms-and-structures`

**Facts**

- The active build is Fabric 26.2; Paper/Folia modules are commented out. The
  core, rooms, structures, metrics, and Fabric modules contain 459 JUnit
  declarations but no Fabric GameTest source. CI runs `./gradlew build` on Java
  25. See [settings](https://github.com/ouroboros-smp/rooms-and-structures/blob/eb382d7254b01939cd90ed9bf4bbecd5cf400c10/settings.gradle),
  [Fabric build](https://github.com/ouroboros-smp/rooms-and-structures/blob/eb382d7254b01939cd90ed9bf4bbecd5cf400c10/platform/fabric/build.gradle),
  and [CI](https://github.com/ouroboros-smp/rooms-and-structures/blob/eb382d7254b01939cd90ed9bf4bbecd5cf400c10/.github/workflows/ci.yml).
- The packaged harness scenario fills the missing real-server layer for room
  discovery, diagnostics, SQLite persistence, lifecycle, and restart, but it
  uses one client and no Coffer/Homestead artifact.

**Recommendations**

- Add Fabric GameTests for boundary/door discovery, invalid/open structures,
  room-type effects, block-change invalidation, scheduler re-entrancy, and a
  minimum executed count. Preserve the broad pure-domain suite.
- Add Coffer and future Homestead to the harness with multiple players and real
  LuckPerms; prove access/durability/offline-protection ownership, abandonment
  and decay, overlapping structures, concurrent edits, restart, and a bounded
  scan/chunk-load soak.

### `test-harness`

**Facts**

- The documented boundary is correct: packaged jars, real network sessions,
  restarts, cross-mod behavior, persistence, and bounded soak belong here. See
  [architecture scope](https://github.com/ouroboros-smp/test-harness/blob/4a59a5ca8cf959c341b5d8d010170fa284ce0a35/docs/architecture.md#L3-L15).
- The repository has 16 TypeScript tests, two Rust client tests, one bridge
  JUnit test, and 15 schema-valid scenarios across 11 targets. Its catalog
  contract checks that every maintained scenario appears exactly once.
- CI verifies TypeScript, Rust formatting/lint/tests, bridge tests, validation,
  doctor, and a live Fabric self-smoke. The nightly job runs only
  `harness/stress-smoke`. Neither workflow runs `portfolio`.
- No assessed consumer workflow invokes the composite action. Mod repositories
  run their own Gradle/E2E jobs, so release-level harness failures are not
  currently per-repository merge gates.

**Recommendations**

- **P0 production manifest:** version the deployed first-party and third-party
  Fabric jar set, including exact versions/checksums and enabled/disabled state.
  Add a drift command that compares it with tested artifacts and fails before
  deploy when a jar/version is untested.
- **P0 full-manifest interop:** boot all production Fabric jars together, assert
  each expected mod id and service becomes ready, run a compact smoke for every
  first-party mod, and fail on duplicate ids, mixin errors, dependency errors,
  port collisions, or loader eviction. Start with the proven
  WildAnimalBalancer/Coffer nested-core collision.
- **P0 CI gate:** run the full portfolio on schedule and pre-release, publish the
  aggregate dashboard, and require a smaller full-manifest boot gate for
  production-manifest changes. Keep per-commit repo unit/GameTests fast.
- **P0 inventory contract:** compare `config/portfolio.yaml` with an explicit
  scope file that classifies every authenticated org repository as Fabric
  runtime, client-only, service, docs/governance, future engine, upstream fork,
  or retired. Public repository discovery alone is insufficient because most
  first-party mods are private.
- **P1 permission interop:** use a real LuckPerms jar and exercise deny, grant,
  and group-change-without-restart across permission-gated first-party commands.
- **P1 service seams:** test the Discord relay with a local fake endpoint only;
  assert outbound/inbound formatting, timeout/unreachable behavior, ordering,
  tick health, recovery, styled-chat interaction, and vanish non-leakage. Never
  call real Discord from the harness.
- **P1 harness unit contracts:** expand tests around server startup/shutdown
  timeout races, client disconnect/reconnect, bridge authentication failures,
  port allocation collisions, artifact checksum/name resolution, cleanup after
  partial startup, and report generation after secondary cleanup errors.
- **P2 production deltas:** retain proxy/Via and alternate protocol versions as
  documented gaps. Add them only when they become explicit supported claims.
- Protect `main` with the existing `verify` and `live-smoke` jobs. Make the
  production-manifest boot check required once it exists.

### `watershed`

**Facts**

- The current product is the Fabric 26.2 server mod plus optional client UI and
  portable core. It has 45 active core/Fabric JUnit declarations and no
  GameTests; the Paper plugin and Minestom spike contribute three additional
  non-runtime declarations. See the [module list](https://github.com/ouroboros-smp/watershed/blob/7f0a064b441a90c39563a443b581cea631e4b327/settings.gradle)
  and [Fabric manifest](https://github.com/ouroboros-smp/watershed/blob/7f0a064b441a90c39563a443b581cea631e4b327/fabric-server/src/main/resources/fabric.mod.json).
- The workflow is still named "Plugin build + tests", installs Java 21, and
  uploads only core/plugin test reports even though the Fabric compile requests
  a Java 25 toolchain. The baseline harness proves packaged spring commands,
  save/restart persistence, and removal, but not sustained hydrology, client UI,
  multiplayer, or performance bounds. See [CI](https://github.com/ouroboros-smp/watershed/blob/7f0a064b441a90c39563a443b581cea631e4b327/.github/workflows/build.yml)
  and [`spring-lifecycle`](https://github.com/ouroboros-smp/test-harness/blob/4a59a5ca8cf959c341b5d8d010170fa284ce0a35/scenarios/watershed/spring-lifecycle.yaml).

**Recommendations**

- Make CI explicitly Fabric/Java 25, retain Fabric test reports and the tested
  jars, and remove legacy plugin/Minestom experiments from production gating.
- Add Fabric GameTests for source/sink conservation, barriers and terrain,
  chunk unload/reload, save/restore, network payloads, and deterministic ticks.
  Add client GameTests for UI permission/data/expiry behavior.
- Expand the harness to multiple players/springs and full-manifest mod load;
  assert bounded tick time, queue/cell counts, memory growth, restart equality,
  and graceful degradation when the optional client is absent.

### `WildAnimalBalancer`

**Facts**

- The Fabric server behavior includes demand-scaled local population, overlap
  deduplication, deficit and hourly budgets, biome filtering, reload, status,
  audit logging, Prometheus output, permissions, and an optional admin HUD. See
  [features](https://github.com/ouroboros-smp/WildAnimalBalancer/blob/b2c26f64f2a4c7560242bbfd35b1391685d9660e/README.md#L23-L35)
  and [commands/permissions](https://github.com/ouroboros-smp/WildAnimalBalancer/blob/b2c26f64f2a4c7560242bbfd35b1391685d9660e/README.md#L147-L154).
- Forty-one JUnit methods cover the portable math/config/stats/logger core,
  Paper's legacy wild predicate, and Fabric census/surface helpers. Three
  annotated Fabric GameTests cover real grass/headroom/light behavior and
  full-column census. The protected `build` check executes unit tests,
  coverage thresholds for core, and Fabric GameTests. See the
  [build workflow](https://github.com/ouroboros-smp/WildAnimalBalancer/blob/b2c26f64f2a4c7560242bbfd35b1391685d9660e/.github/workflows/build.yml)
  and [Fabric GameTest](https://github.com/ouroboros-smp/WildAnimalBalancer/blob/b2c26f64f2a4c7560242bbfd35b1391685d9660e/fabric/src/gametest/java/com/ouroboros/wildlife/fabric/FabricSpawnSurfaceGameTest.java).
- The existing Fabric harness scenario exercises the packaged jar, one real
  client, bounded spawning, metrics, reload, audit-file creation, and restart
  persistence. See [`population-acceptance`](https://github.com/ouroboros-smp/test-harness/blob/4a59a5ca8cf959c341b5d8d010170fa284ce0a35/scenarios/wildanimalbalancer/population-acceptance.yaml).
- The optional Fabric HUD has no tests. The separate Paper/Folia workflow is
  legacy for Ouroboros; it should not drive new harness runtime work.
- Release metadata is inconsistent: the root build is `2.0.2`, the README names
  `2.0.0` artifacts, and `paper/plugin.yml` says `2.0.1`. See the
  [root version](https://github.com/ouroboros-smp/WildAnimalBalancer/blob/b2c26f64f2a4c7560242bbfd35b1391685d9660e/build.gradle.kts#L8-L13),
  [artifact table](https://github.com/ouroboros-smp/WildAnimalBalancer/blob/b2c26f64f2a4c7560242bbfd35b1391685d9660e/README.md#L11-L17),
  and [legacy plugin manifest](https://github.com/ouroboros-smp/WildAnimalBalancer/blob/b2c26f64f2a4c7560242bbfd35b1391685d9660e/paper/src/main/resources/plugin.yml#L1-L4).

**Recommendations**

- **P0 harness regression:** load packaged Coffer and WildAnimalBalancer together
  and assert both top-level and nested classes/mod ids remain available. Fold it
  into the full Fabric manifest scenario so future Jar-in-Jar collisions fail
  before deploy.
- **Unit/build contract:** derive all active Fabric artifact metadata from one
  version and inspect the built jar's `fabric.mod.json`. Treat Paper metadata as
  legacy rather than adding a Paper harness.
- **Client GameTest:** cover HUD permission denial, enable/disable payload
  negotiation, `H` toggle, values rendered from a server sample, and sample
  expiry. Add a minimum executed-test count.
- **Harness multiplayer:** connect overlapping and non-overlapping players,
  prove one census per shared cell, verify target scaling and hard cap, then
  change LuckPerms group membership without restart and prove `wildlife.admin`
  and `wildlife.hud` update.
- **Harness restart:** prove hourly budget and spawned-animal persistence cannot
  be reset into amplification, and that audit JSONL remains valid across
  restart. Add a bounded multi-player soak around census and spawn cycles.
- No custom adapter is justified yet: bridge entity reads, client messages,
  logs, files, and the Prometheus endpoint expose the required evidence.

### `world-border-veil` / OuroVeil

**Facts**

- OuroVeil is a server-only Fabric 26.2 mod (`ouroveil`) that gives vanilla
  clients circular per-dimension fog, inward impulse/slowness, bounded safe
  recovery for deep breaches, spectator/bypass behavior, and per-player packet
  budgets. See the [behavior contract](https://github.com/ouroboros-smp/world-border-veil/blob/0fdffbc57dd23931a7402ad2ef6522d920409852/README.md#L7-L24).
- Twenty-five JUnit declarations and three Fabric GameTests cover pure helpers
  and server behavior. CI runs tests/GameTests/coverage, then boots the tested
  jar on a downloaded Fabric server and verifies generated config; recent build
  and release runs succeeded. See the [workflow](https://github.com/ouroboros-smp/world-border-veil/blob/0fdffbc57dd23931a7402ad2ef6522d920409852/.github/workflows/build.yml).
- Despite this strong repo-level evidence and an active `v1.0.1` release, the
  baseline harness catalog has no OuroVeil target. This is a production-manifest
  and full-set compatibility blind spot.

**Recommendations**

- **P0:** add the packaged `ouroveil` jar to the catalog/production manifest and
  full-set boot. Record repository name, artifact name, and mod id separately so
  inventory checks do not miss the mapping.
- Add vanilla-client acceptance at inside/fog/actionbar/breach/deep-recovery
  distances in Overworld and Nether, including mount/boat, spectator, UUID and
  LuckPerms bypass, invalid reload rollback, restart, and no safe-column fallback.
- Add a bounded multi-player edge soak that asserts packet/tick budgets and no
  chunk loads. Contract-test the border value consumed by website/public stats
  so operator configuration cannot silently disagree across surfaces.

## Cross-mod scenario backlog derived from design context

These are recommendations, ordered for the Fabric 26.2 runtime.

| Priority | Scenario | Required evidence |
|---|---|---|
| P0 | Restore executable GitHub quality gates | Actions jobs start normally; fast repo checks run; active branches require meaningful checks; billing/spend rejection is cleared before interpreting run conclusions |
| P0 | Full production-manifest boot and side-by-side smoke | Every expected Fabric mod id loads; no duplicate nested ids/mixin/dependency errors; each first-party smoke passes; production artifact versions/checksums match the tested manifest |
| P0 | WildAnimalBalancer + Coffer packaging regression | Both mods initialize; both nested cores are loadable; WAB census and Coffer bind/open checks work in the same server |
| P0 | Ouroboros Relay fake-service acceptance | Packaged Fabric adapter; fake Discord only; name translation/unlinked drop; styled-chat and vanish privacy; ordering; timeout/down/recovery; bounded queues and tick health |
| P0 | Mehen schema and access-gate acceptance | One canonical V1-V3 migration source; self-contained proxy/E2E checkout; real MariaDB/Redis; Velocity/NanoLimbo allow/deny transfer; outage/reconnect/idempotency; CI |
| P0 | OuroVeil catalog and full-set smoke | `world-border-veil` repo, jar, and `ouroveil` mod id mapped; packaged server boot; config generated; mod coexists with full production set |
| P0 | LuckPerms grant/deny/hot group change | An unprivileged client is denied; a granted client succeeds; group membership changes take effect without server restart across representative Mehen, Kinship, Coffer, Patrol, Rooms, and WAB commands |
| P1 | Rooms + Coffer + Homestead ownership/protection handoff | Coffer controls open access, Rooms controls storage-container durability, Homestead controls offline inviolability; no layer overrides or bypasses another; state survives restart |
| P1 | Shared OuroMetrics registry with real consumers | At least two consumer series coexist on one endpoint; joins update server gauges; no second HTTP listener or duplicate registry appears; restart rebinds cleanly |
| P1 | Patrol + Mehen justice continuity | A qualifying PvP pattern creates Patrol heat/wanted state, the governance record sees the consequence, permission checks hold, and durable state decays/recovers correctly across restart |
| P2 | NovoAtlas packaged world continuity, if deployed | Fixed terrain/biome probes, chunk-seam checks, restart stability, and old/new chunk compatibility under the full production mod set |

Local design sources consulted for these interaction recommendations:

- `K:\github_repos\ron-kb\raw\ouroboros\test-portfolio-assessment-plan.md`
- `K:\github_repos\ron-kb\raw\ouroboros\drive-architecture-library\rooms-coffer\Storage Room Container Protection - Implementation Spec (Rooms + Coffer).md`
- `K:\github_repos\ron-kb\raw\ouroboros\drive-architecture-library\rooms-coffer\Rooms ADR-017 - Boundary at Structures (Claims Live in Homestead).md`
- `K:\github_repos\ron-kb\raw\ouroboros\drive-architecture-library\mehen-governance\Community Governance System - End-to-End Architecture (v0.3, canonical).md`
- `K:\github_repos\ron-kb\raw\ouroboros\drive-architecture-library\additions\Patrol - Systems Architecture (v0.1).md`
- `K:\github_repos\ron-kb\raw\ouroboros\discord-relay-architecture.md`

The Rooms/Coffer/Homestead handoff is explicit in the local ADR: access belongs
to Coffer, storage durability to Rooms, and offline inviolability to Homestead.
The relay design requires a fake external-service seam, linked-account name
translation, unlinked-author drops, and thread hops back to the server. These
are design intentions, not claims that the assessed repositories already
implement or test them.

## Issue-ready recommendations

Each issue should retain the supplied plan's acceptance rule: the new test must
be seen failing against a deliberate mutation or reverted fix before it counts
as coverage. The deployment-drift row is substantially implemented in this
branch. The behavioral interop row is filed as
[`test-harness#39`](https://github.com/ouroboros-smp/test-harness/issues/39) and
remains open until its domain assertions and a complete production mod-directory
run are green.

| Repository | Proposed issue title | Layer | Minimum acceptance criteria |
|---|---|---|---|
| `.github` / org settings | `[test-infra] restore executable GitHub Actions gates` | CI/operations | Representative private/public jobs start; billing annotation gone; results reported; protected branches cannot merge without completed checks |
| `test-harness` | `[test-gap] production Fabric mod set has no interop gate` | Harness | Versioned manifest; full-set boot; per-mod readiness; WAB/Coffer regression; failure evidence; scheduled/pre-release CI |
| `test-harness` | `[test-gap] tested artifacts can drift from deployed versions` | Harness/tooling | Deterministic comparison; actionable diff; missing/extra/version/checksum mismatch fail; deploy docs updated |
| `test-harness` | `[test-gap] catalog scope is not reconciled with org inventory` | Contract | Every authenticated repo classified; runtime targets cannot disappear silently; forks/client/services/future engines explicitly excluded or included |
| `ouroboros-relay` | `[test-gap] Fabric adapter is outside CI and runtime acceptance` | GameTest + harness | Java 25 adapter CI; packaged jar; fake Discord; delivery/privacy/order/down/recovery/tick evidence; no live credentials |
| `world-border-veil` / `test-harness` | `[test-gap] released OuroVeil jar is absent from the portfolio` | Harness | Repo/jar/mod-id mapping; packaged boot; config; full-set interop; client edge/recovery/restart acceptance |
| `mehen` + consumers | `[test-gap] governance schema tests depend on retired mehen-seed` | Contract/integration | V1-V3 canonical migrations from Mehen; proxy/E2E self-contained; upgrade path; no SQL replicas |
| `mehen-proxy` | `[test-gap] proxy integration tests are neither automatic nor part of build` | CI/integration | Workflow; `integrationTest` in verification; canonical schema; shaded jar; retained reports |
| `mehen-e2e` | `[test-gap] access E2E stops below the Minecraft protocol` | Service E2E | Velocity/NanoLimbo enabled; built proxy; allow/deny/reconnect/outage scenarios; clean teardown; CI |
| `ouroboros-smp-website` | `[test-gap] checks run only inside main-branch deploy` | CI/contract | Secret-free PR check; required branch status; versioned stats/auth fixtures; deploy gated downstream |
| `rooms-and-structures` | `[test-gap] 459 tests stop below a real Fabric GameTest` | GameTest + harness | Boundary/door/invalidation/scheduler tests; nonzero count; Coffer/Homestead interop plan |
| `watershed` | `[test-gap] Fabric hydrology has no GameTest or bounded soak` | GameTest + harness | Conservation/chunk/save/network tests; Java 25 CI; multi-source restart/perf thresholds |
| `Patrol` | `[test-gap] justice acceptance uses admin commands, not real PvP` | Harness/client GameTest | Multi-player heat/wanted flow; Mehen handoff; HUD contract; restart/decay/soak; Fabric-only gate |
| `KeepGear` | `[test-gap] Kinship and permission precedence are simulated` | Harness | Real Kinship/LuckPerms jars; hot policy changes; death/drop/pickup/restart races |
| `ouroboros-worldgen` | `[test-gap] deployable world assets have no machine contract` | Static + conditional harness | Pack/schema/palette/image/checksum validation; deterministic world probes once artifacts/deployment exist |
| `ouroboros-chronicle` | `[test-gap] Chronicle content has no declared source or publish gate` | Content CI | Authority decision; link/slug/case/HTML checks; index; publish dry run |
| `LocalBlindness` | `[test-gap] Blindfold config and launch lifecycle are partially unproven` | Unit + client GameTest | IO/recovery tests; reload/persistence; launch reset; respawn/dimension; keybind and icon; CI required |
| `novoatlas` or `test-harness` | `[test-gap] deployed image world generation has no automated contract` | Unit/GameTest + conditional harness | Explicit deploy decision; deterministic Fabric probes; restart/chunk seam; nonzero test count; full-manifest inclusion if deployed |
| `ouro-metrics` | `[test-gap] Fabric exporter tests do not run in CI` | CI | Build/tests on push/PR; required check; reports retained |
| `ouro-metrics` | `[test-gap] multiple real Fabric consumers are unproven` | Unit/GameTest + harness | Concurrency/registration tests; two packaged consumers; one endpoint; restart and bind-failure behavior |
| `WildAnimalBalancer` | `[test-gap] nested-core collision fix has no cross-mod regression` | Harness | Packaged WAB+Coffer; both mod trees active; behavioral smoke for both; mutation/revert seen red |
| `WildAnimalBalancer` | `[test-gap] optional Fabric HUD has zero automated tests` | Client GameTest | Permission paths; payload negotiation; toggle/render/expiry; nonzero count; required CI |
| `.github` | `[test-policy] require regression evidence for closed bugs` | Governance | Shared issue form; layer selection; seen-red checkbox; CI and traceability fields |

## Method and limitations

- Repository metadata, fork ancestry, branch status, Actions history, source,
  manifests, tests, and workflows were read from first-party GitHub data at the
  commit heads named above.
- The inventory was read with authenticated organization access and contains all
  26 repositories visible to that account: seven public and 19 private. None was
  archived or a template at the snapshot. `concord` and `homestead` were
  verified empty despite their metadata naming `main` as the intended default.
- Test counts are static source declarations/files, not dynamically discovered
  test cases. Authenticated workflow history and run annotations were inspected;
  no claim is made that an absent run means a developer never ran tests locally.
- Default-branch `protected` state is not the same as proving every organization
  rule and administrative bypass. The assessment therefore says what GitHub
  reports and names the observed required WAB context, rather than claiming
  merges are impossible by every route.
- Repository source and the supplied local knowledge base were assessed. The
  deployed server filesystem itself was not inventoried, so deploy/not-deploy
  decisions for NovoAtlas, OuroMetrics, and other optional artifacts remain
  explicit manifest questions rather than guesses.
