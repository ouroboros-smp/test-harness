# Verification and evidence reference

Use this reference to choose commands by intent. Run commands from the harness root unless a command explicitly targets a consumer checkout.

## Contents

- [Prerequisites](#prerequisites)
- [Verification tiers](#verification-tiers)
- [Production deploy gate](#production-deploy-gate)
- [Scenario authoring](#scenario-authoring)
- [Task-to-contract map](#task-to-contract-map)
- [Evidence triage](#evidence-triage)
- [Environment and path rules](#environment-and-path-rules)

## Prerequisites

- Use Node.js 24 or newer.
- Provide Java 25 for Minecraft 26.2 targets and Java 21 for maintained 1.21.11 compatibility targets.
- Install the repository-pinned Rust nightly with `rustfmt` and `clippy` components.
- Allow network access for the first download; reuse the harness cache afterward.
- Start Docker only for targets whose scenarios declare managed services.
- Provide packaged consumer and runtime-dependency jars at the exact paths declared by the scenario or portfolio catalog.
- Provide an exact production `mods` directory only for production-manifest directory audits and full-stack interoperability runs.

Invoke `npm` scripts instead of platform-specific binaries. Let the harness and portfolio resolve `npm`, the Gradle wrapper, executable suffixes, and repository-relative paths per platform.

## Verification tiers

### Tier 1: structure, schema, and resolution

Run only the checks relevant to the changed contract:

- For this skill, run the available Agent Skills structural validator against `.agents/skills/use-test-harness` (with Codex, invoke the Skill Creator's `scripts/quick_validate.py`).
- For harness scenarios, schemas, catalogs, or manifests, install dependencies and run contract validation:

  ```text
  npm ci
  npm run validate
  ```

- For an affected scenario, resolve variables and artifacts without launching Minecraft:

  ```text
  npm run harness -- run <scenario-id> --artifact <name>=<path> --dry-run --output <unique-output>
  ```

Treat dry-run success as proof of parsing, schema validation, variables, and artifact resolution only. Do not claim server boot, networking, actions, assertions, or cleanup.

### Tier 2: focused live behavior

Build required components, check the environment, and run the affected scenario:

```text
npm run build:all
npm run doctor
npm run harness -- run <scenario-id> --artifact <name>=<packaged-jar> --output <unique-output>
```

Run `npm run harness -- smoke --output <unique-output>` when changing core server/client/bridge lifecycle behavior without a more specific consumer scenario.

### Tier 3: full harness self-suite

Match pull-request CI:

```text
npm ci
npm test
npm run fmt:client
npm run lint:client
npm run test:client
npm run build:client
npm run test:bridge
npm run validate
npm run doctor
npm run harness -- smoke --output <unique-output>
```

Run commands sequentially to keep failures attributable. Build the client and bridge before `doctor`.

For a Coffer adapter change, first build the consumer's server and core jars. Then pass those compile-only inputs explicitly:

```text
node scripts/gradle.mjs -Pcoffer_jar=<coffer-server-jar> -Pcoffer_core_jar=<coffer-core-jar> :adapters:coffer:build
```

### Tier 4: complete Fabric portfolio

Use this tier for release gates, portfolio/catalog changes, cross-mod behavior, or an explicit request for the full suite. Build every configured checkout, run repository tests, consume exact packaged jars, and execute every maintained scenario exactly once.

Before starting, set both `OURO_HARNESS_JAVA_25` and `OURO_HARNESS_JAVA_21` to absolute paths for the corresponding `java` executables. Set `OURO_HARNESS_JAVA` to the same Java 25 executable for `doctor`. The portfolio probes each executable, requires the declared major, derives an authoritative `JAVA_HOME`, and fails fast instead of inheriting ambient Java.

The portfolio builds Coffer's Fabric server and core jars before invoking the harness-owned adapter with those exact compile-only inputs. An alternate `cofferRepository` override therefore remains self-contained and does not depend on a sibling checkout or stale adapter jar.

```text
npm ci
npm run build:all
npm run doctor
npm run harness -- portfolio --output <unique-output>
```

Place default sibling checkouts beside the harness or override a checkout without editing committed configuration:

```text
npm run harness -- portfolio --variable <repositoryVariable>=<checkout-path> --output <unique-output>
```

Treat any failed or skipped target as an incomplete portfolio even when later targets continue. When a request says only "full suite," use Tier 4. If a sibling checkout, Java version, Docker service, or artifact remains unavailable, report that prerequisite gap instead of silently downgrading to Tier 3.

Keep the production manifest audit and interoperability run separate from Tier 4. Require an explicit production inventory or mods directory before claiming production-stack coverage.

## Production deploy gate

Use this gate only when auditing the deployed inventory or explicitly testing the complete production jar set:

```text
npm run build
node dist/cli.js manifest-check --strict --mods-directory <production-mods-directory>
node dist/cli.js interop --mods-directory <production-mods-directory> --output <unique-output>
```

Treat checked-in drift and missing coverage as actionable failures. Do not relax strictness. Require the interop command to audit before launch, and limit a pass to packaging, loaded mod versions, real-client join, restart, and reconnect. Retain focused behavioral assertions in portfolio scenarios.

## Scenario authoring

1. Read `schemas/scenario.schema.json`, `docs/scenarios.md`, and the closest behaviorally similar scenario. Do not invent operation fields from memory.
2. Keep `schemaVersion: 1`, a namespaced stable `id`, a descriptive `title`, at least one issue number, and unique step ids.
3. Declare every packaged artifact and client explicitly. Use variables for checkout-specific paths or tunable inputs.
4. Prepare state through a real client when testing attribution, placement, interaction, or ordering. Use the bridge only for deterministic preconditions.
5. Capture state before and after destructive or persistence transitions.
6. Assert externally observable outcomes with schema-accepted standard actions and assertions.
7. Add each maintained scenario to exactly one `config/portfolio.yaml` target. Update `docs/issue-coverage.md` and the code-level tracked issue set when coverage changes.
8. Complete Tier 1, then run the affected Tier 2 scenario with the same resolved inputs.

## Task-to-contract map

| Task | Inspect first | Minimum proof |
|---|---|---|
| Update this skill | Skill Creator guidance and both skill files | Agent Skills structural validator, `npm run validate` |
| Edit scenario YAML | Scenario schema, scenario guide, nearest scenario | Tier 1, then affected Tier 2 scenario |
| Add or remove tracked coverage | Manifest coverage code, issue coverage doc, portfolio catalog | `npm test`, `npm run validate`, affected live scenario |
| Change runner, actions, or assertions | Types, runner tests, scenario schema, action-contract scenario | Tier 3 |
| Change server lifecycle or downloads | Server/runner tests, architecture, live-smoke scenario | Tier 3 |
| Change Rust client packets/actions | Client source, exact protocol pin, affected scenarios | Tier 3 plus affected scenario |
| Change bridge or adapter | Architecture, bridge tests, adapter build inputs, adapter scenario | Tier 3; build the consumer inputs and adapter explicitly; run the affected scenario |
| Change portfolio target/catalog | Portfolio contract tests, catalog, portfolio guide | `npm test`, `npm run validate`, Tier 4 |
| Change production manifest | Production manifest guide, portfolio `testedVersion` values, exact mods inventory | `npm test`, `npm run validate`, manifest audit; interop when the production directory is available |
| Integrate a consumer release gate | `action.yml`, consumer build output, scenario artifacts | Consumer tests plus pinned live harness run |
| Diagnose a scenario report | Scenario report schema and retained evidence | Reproduce at the narrowest live tier |
| Diagnose a portfolio report | `PortfolioReport` in `src/types.ts`, portfolio writer, retained evidence | Reproduce at the narrowest portfolio scope, then restore Tier 4 when required |

## Evidence triage

Inspect these scenario output-root files:

- `report.html` for the self-contained human dashboard.
- `summary.md` for the concise overview.
- `report.json` for the schema-validated scenario automation contract.
- `junit.xml` for CI test-report integration.
- `resolved-scenario.json` for the fully interpolated scenario.

Follow the paths recorded in `report.json.artifacts` for the server log, client events, service output, and other retained evidence. Find downloaded dependencies in the configured harness cache and read pins from `report.json`; do not assume every evidence type lives under `artifacts/`.

For portfolio output, inspect the same four top-level report views plus per-target build logs and linked scenario evidence. Interpret portfolio `report.json` through `PortfolioReport` in `src/types.ts`, not `schemas/report.schema.json`.

Diagnose in this order:

1. Find the first failed build or scenario step.
2. Read that step's structured evidence and error.
3. Inspect global findings such as ERROR/FATAL lines, stack traces, crashes, watchdog signatures, wrong-thread failures, premature exit, or timeouts.
4. Correlate relevant server/client/bridge/service logs and before/after snapshots.
5. Inspect cleanup failures last unless cleanup is the only failure.

## Environment and path rules

- Use a fresh output path per run to avoid confusing current evidence with a prior attempt.
- Quote paths that contain spaces and pass artifacts as `NAME=PATH` without changing the declared artifact name.
- Pass repeatable `--variable NAME=VALUE` flags for checkout or behavior overrides. Expect JSON-compatible primitive values to parse into their native types.
- Use `--verbose` only when live streaming helps diagnosis; treat retained logs as authoritative.
- Use `--keep-run-directory` only when generated world/config state is needed. Retain evidence artifacts without it.
- Share `--cache` between runs when appropriate, but never share output or isolated server directories.
