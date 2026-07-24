# Cross-repository CI authentication

Harness workflows build sibling mods from private `ouroboros-smp`
repositories. The repository-scoped `GITHUB_TOKEN` cannot read those
repositories, so checkouts of sibling sources authenticate with the
`OUROBOROS_CI_READ_TOKEN` repository secret instead.

## Credential contract

- The secret holds a read-only credential whose only job is
  `actions/checkout` of approved sibling repositories: Coffer, Rooms and
  Structures, Kinship, Parcels, Patrol, and WildAnimalBalancer.
- It must never carry write, workflow, packages, or administration
  scopes. If the credential is a fine-grained token or GitHub App
  installation token, grant `contents: read` on the approved
  repositories only.
- Every checkout that uses it sets `persist-credentials: false` so the
  credential never survives into later steps, the Gradle build, or the
  scenario runtime.

## Where it is used

Search for `OUROBOROS_CI_READ_TOKEN` under `.github/workflows/`. As of
this writing it authenticates sibling checkouts in `ci.yml`,
`coffer-nightly.yml`, and `coffer-release-candidate.yml`. New jobs that
build a sibling repository should follow the same pattern: pin an exact
commit `ref`, set `persist-credentials: false`, and record commit and
jar provenance in the uploaded evidence.

## Fork protection

Fork pull requests never receive this secret because no persistent
self-hosted workflow in this repository executes pull-request-defined
code at all:

- Every workflow that targets `[self-hosted, crucible-pc]` triggers only
  on `push`, `schedule`, or `workflow_dispatch`.
- `src/workflow-security.test.ts` fails the unit suite if any
  self-hosted workflow adds a `pull_request` or `pull_request_target`
  trigger, so this boundary is regression-tested on every build.

Checks appear on pull requests because contributors push branches to
this repository; the workflows run for the branch push, not for the
pull request event.

## Rotation and ownership

- Owner: the `ouroboros-smp` organization administrator (currently the
  repository owner) manages the underlying credential and the
  `OUROBOROS_CI_READ_TOKEN` secret in this repository's settings.
- Rotate by issuing a replacement credential with the same read-only
  grants, updating the repository secret, and re-running the `verify`
  job plus one workflow that performs a sibling checkout (for example
  `coffer-nightly` via `workflow_dispatch`). No workflow changes are
  needed to rotate.
- Rotate immediately if a workflow ever prints the credential, if a
  checkout step runs with `persist-credentials` enabled, or if the
  credential's grants drift beyond `contents: read`.
- The credential value exists only in the repository secret store.
  Nothing in this repository, its history, or its evidence artifacts
  may contain it.
