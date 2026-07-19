# Ouroboros Fabric Test Harness

Release-level integration and soak testing for Ouroboros SMP Fabric mods. The
harness boots an isolated Minecraft 26.2 dedicated server, loads packaged mod
artifacts, connects real offline-mode protocol clients, drives gameplay, and
publishes structured evidence for every assertion.

The harness is deliberately separate from unit tests and Fabric GameTests. It
tests the boundaries those layers cannot: packaged jars, real networking,
multiple simultaneous players, restart persistence, config reloads, production
mod interoperability, and bounded failure handling.

## Requirements

- Node.js 24 or newer
- Java 25 for Minecraft 26.2 and Java 21 for the included Minecraft 1.21.11
  compatibility targets
- Rustup (the repository pins `nightly-2026-07-13` for the exact-version
  headless protocol client)
- Network access on the first run (downloads are cached and checksum verified)

## Quick start

```bash
npm ci
npm run build:all
npm run validate
npm run doctor
```

Run the built-in live smoke, which downloads Fabric 26.2, starts a dedicated
server with the harness bridge, joins a real client, verifies state, and shuts
the server down:

```bash
npm run harness -- smoke --output artifacts/smoke
```

Run a consumer scenario with packaged jars:

```bash
npm run harness -- run keepgear/acceptance \
  --artifact consumer=../KeepGear/fabric/build/libs/keepgear-2.0.1-fabric.jar \
  --output artifacts/keepgear
```

Use `--dry-run` to resolve and validate a scenario without downloading or
launching Minecraft. `npm run harness -- list` prints every included scenario.

Run the complete Fabric portfolio—clean builds, repository tests, packaged-jar
acceptance, real-client GameTests, live servers, restarts, services, and soaks—
with one command:

```bash
npm run harness -- portfolio --output artifacts/full-portfolio
```

The catalog in `config/portfolio.yaml` is the inventory of tested repositories,
build commands, Java versions, packaged artifacts, and scenarios. Override a
checkout without editing the catalog, for example
`--variable watershedRepository=/path/to/checkout`.

## Production manifest and compatibility gate

`config/production-manifest.yaml` records the enabled first-party and
third-party Fabric stack, exact known versions, obligation buckets, and
cross-mod touchpoints. Audit deployment-to-test drift without starting a
server:

```bash
npm run build
node dist/cli.js manifest-check --json
node dist/cli.js manifest-check --mods-directory /path/to/production/mods
```

The directory form also rejects missing, ambiguous, disabled-but-present, and
undeclared jars. Once the audit is green, run the generated full-stack boot,
real-client join, loaded-mod/version inventory, and restart compatibility gate:

```bash
node dist/cli.js interop \
  --mods-directory /path/to/production/mods \
  --output artifacts/production-interop
```

The release command always requires exact third-party version pins, even when a
non-strict catalog audit would report them as warnings. It proves packaging,
loader/mixin compatibility, join, and restart. Behavioral cross-mod assertions
remain tracked in [issue #39](https://github.com/ouroboros-smp/test-harness/issues/39).

The checked-in manifest deliberately reports the known July 18 gaps: Mehen is
deployed ahead of its tested version, and Ouroboros Relay, OuroVeil, and Secret
Spectator do not yet have executable portfolio targets. These failures are the
pre-deploy work queue, not allowlisted drift. Folia is not a harness runtime;
legacy Folia-only repositories must migrate to Fabric or remain outside the
executable portfolio.

## Reading reports

Every run writes four complementary views to its output directory:

- `report.html` is the self-contained human dashboard. It leads with status,
  timing, step counts, and performance, then provides filters and expandable
  evidence, failures, findings, pins, and portable artifact links.
- `summary.md` is a GitHub-friendly overview with the same important sections
  and collapsible step evidence.
- `report.json` is the complete schema-validated automation contract.
- `junit.xml` integrates with CI test-report consumers.

Open `report.html` directly from a local run or after downloading a CI artifact;
it has no external assets or network dependencies.

A portfolio run writes the same four top-level files. Its dashboard first shows
the pass rate across repositories, builds, and scenarios, then links to every
build log and individual scenario dashboard. The runner continues after a
failure so one report describes the entire portfolio.

## Extending the harness

Scenarios are YAML contracts under `scenarios/`; their public shape is defined
by `schemas/scenario.schema.json`. A new mod normally needs only:

1. a packaged server jar supplied as the `consumer` artifact;
2. a scenario YAML using the standard server, client, bridge, wait, snapshot,
   log, and soak actions;
3. an optional test-only Fabric adapter jar implementing `HarnessAdapter` for
   domain-specific assertions that cannot be observed through standard APIs.

The bridge is a test-only server mod. It binds to loopback, requires a random
bearer token, runs Minecraft mutations on the server thread, emits NDJSON
events, and is never copied into consumer release jars.

See [Architecture](docs/architecture.md), [Scenario Authoring](docs/scenarios.md),
[Portfolio Catalog](docs/portfolio.md), [Production Manifest](docs/production-manifest.md),
[Organization Assessment](docs/portfolio-assessment.md), and
[Issue Coverage](docs/issue-coverage.md)
for the complete contracts.

## CI action

Consumer repositories can pin this repository as a composite action:

```yaml
- uses: ouroboros-smp/test-harness@v1
  with:
    scenario: keepgear/acceptance
    consumer-jar: build/libs/keepgear.jar
```

Stable outputs are `passed`, `report`, `html`, `junit`, `server-log`, and
`artifact-directory`. The action uploads evidence even when the scenario fails.
