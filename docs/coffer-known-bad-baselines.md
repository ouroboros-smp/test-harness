# Coffer known-bad baselines

Captured on July 21, 2026 before or during the hardening program. Full local
reports are generated under `artifacts/` and are intentionally not committed.
The commands below make each observation reproducible from the recorded source
revision and packaged artifacts.

| Contract | Known-bad revision or artifact | Red evidence | Regression gate |
| --- | --- | --- | --- |
| Permission nodes | Coffer `f11ae07` | `/coffer help` and bare `/coffer` bypassed `coffer.command.help`; `/coffer policy` checked `coffer.command.lock`. The first LuckPerms run reached the direct deny step but observed no denial event. | `coffer/permissions-luckperms` exercises default allow, direct and group deny/grant, hot changes, op fallback, and audited bypass. |
| API server thread | Coffer `f11ae07` | Every `CofferApi` mutation reached block-entity reads without checking `MinecraftServer.isSameThread()`. An off-thread call therefore had no required fail-fast exception. | `CofferAutomationGameTest.offThreadApiMutationsFailBeforeSideEffects` plus the exact exception contract. |
| Disabled automation | Coffer `f11ae07` | Only the in-repository owner/disabled hopper fixture exercised the override. The packaged scenario changed the stored flag but never ran a real disabled hopper, minecart, or copper-golem extraction afterward. | `coffer/automation-extraction` performs real extraction and inventory conservation checks after flag changes and restart. |
| Continuity replay identity | Coffer `f11ae07` plus Rooms contributor head `b3103e5` | `coffer-civilization-stack-continuity-green/report.json` failed with `value continuity-after-registry: expected equals 4, got 5`. Restore published a new mutation and advanced the captured revision. | Coffer storage GameTests and `coffer/civilization-stack` require exact aggregate, event, and revision identity across pack, revive, relocation, and restart. |
| Denial metric ownership | Coffer `f11ae07` | `coffer-metrics/report.json` scraped `coffer_access_denied_total 0.0` after a player-visible denial. The callback and container backstop also had split responsibility, which made a future duplicate increment possible. | The interaction callback owns the single visible-denial increment; the mixin is a side-effect-free backstop. Unit and packaged scrape tests cover zero, one, read-only probes, and restart. |
| Nested module collision | Coffer `0fca13a` with WildAnimalBalancer `v2.0.1` | Both jars exposed nested module ID `com_ouroboros_core`. `coffer-wab-known-bad-nested-collision/report.json` failed startup with `NoClassDefFoundError: com/ouroboros/coffer/core/LockPolicy`. | `coffer/wildanimalbalancer-compatibility` checks top-level and nested IDs/classes, WAB census, Coffer bind/open, and restart with current artifacts. |

The corresponding green evidence from this implementation includes:

- all six focused Coffer packaged scenarios;
- `coffer/civilization-stack`, including Rooms pack/revive continuity;
- `coffer/wildanimalbalancer-compatibility`;
- automation p95 MSPT at or below 50 ms, with p99 retained in the report;
- Coffer server and client GameTests and merged JaCoCo execution data.
