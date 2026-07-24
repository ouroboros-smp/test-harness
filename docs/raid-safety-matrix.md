# Raid-safety released-jar matrix

`config/raid-safety-matrix.yaml` is the deterministic delivery ledger for
[test-harness issue #52](https://github.com/ouroboros-smp/test-harness/issues/52).
It separates evidence that is runnable against merged product code from the
final five-jar acceptance cases.

This distinction is deliberate:

- an `executable` entry names maintained harness scenarios and binds each
  product id to the scenario's real packaged-jar artifact slot;
- a `blocked` entry names no placeholder scenario and links every unmet
  contract to its owning GitHub issue;
- the production gate compares all five required artifact ids with
  `config/production-manifest.yaml` and their portfolio-tested versions; and
- release readiness requires every final acceptance entry to be executable
  with no inventory or version blockers.

The current executable foundations prove packaged Kinship/Rooms/Coffer
provider composition, Patrol conflict-v2 behavior, Rooms exact containment,
and Coffer lock splintering. They do not claim that Parcels offline protection,
Patrol participant tags, or inferred Rooms hulls exist.

## Inspect the matrix

Build and print the current readiness report:

```sh
npm run raid-matrix
```

The ordinary command exits successfully when the matrix is structurally valid,
even while upstream work is blocked. This lets CI protect the ledger without
pretending the release is ready.

Use the strict release gate only when preparing the final rollout:

```sh
npm run build
node dist/cli.js raid-matrix --require-complete
```

`--require-complete` exits nonzero until:

1. Kinship, Patrol, Rooms, Parcels, and Coffer all have production-manifest
   entries and matching portfolio-tested versions;
2. the owning portfolio targets supply every bound packaged-jar artifact slot;
3. every final entry has a real maintained scenario; and
4. no upstream contract blocker remains.

Machine consumers can add `--json`. A different matrix file can be inspected
with `--config`, but its production and portfolio paths remain safe
repository-relative YAML paths.

## Advancing a blocked case

After the owning product issue lands:

1. build the released server jar and add or update its exact production and
   portfolio version;
2. implement the real packaged-jar scenario using protocol clients for player
   actions and the bridge only for setup and assertions;
3. run the scenario locally and preserve deterministic report, JUnit, server
   log, and restart evidence;
4. change the matrix entry from `blocked` to `executable`, remove its blockers,
   and name the maintained scenario; and
5. run `npm test`, `npm run validate`, and
   `node dist/cli.js raid-matrix --require-complete`.

Issue #52 remains outside `TRACKED_ISSUES` until the final matrix is complete.
Foundation checks are reusable evidence, not issue-completion evidence.
