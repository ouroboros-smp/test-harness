# Verification and evidence reference

Use this reference to choose commands by intent. Run commands from the harness root unless the command is explicitly for a consumer checkout.

## Contents

- [Prerequisites](#prerequisites)
- [Verification tiers](#verification-tiers)
- [Task-to-contract map](#task-to-contract-map)
- [Evidence triage](#evidence-triage)
- [Environment and path rules](#environment-and-path-rules)

## Prerequisites

- Node.js 24 or newer.
- Java 25 for Minecraft 26.2 targets and Java 21 for maintained 1.21.11 compatibility targets.
- Rustup with the repository-pinned nightly and `rustfmt` and `clippy` components.
- Network access on the first download; subsequent downloads use the harness cache.
- Docker only for targets whose scenarios declare managed services.
- Packaged consumer and runtime-dependency jars at the exact paths declared by the scenario or portfolio catalog.
- An exact production `mods` directory only for production-manifest directory audits and full-stack interoperability runs.

Use `npm` scripts instead of invoking platform-specific binaries directly. The harness and portfolio resolve `npm`, Gradle wrapper, executable suffixes, and repository-relative paths per platform.

## Verification tiers

### Tier 1: schema and resolution

Use for documentation-only skill changes, scenario authoring feedback, and the first pass on catalog changes.

```text
npm ci
npm run build
npm run validate
npm run harness -- run <scenario-id> --artifact <name>=<path> --dry-run --output <unique-output>
```

Dry-run success proves parsing, schema validation, variables, and artifact resolution. It does not prove server boot, networking, actions, assertions, or cleanup.

### Tier 2: focused live behavior

Build required components, check the environment, then run the affected scenario.

```text
npm run build:all
npm run doctor
npm run harness -- run <scenario-id> --artifact <name>=<packaged-jar> --output <unique-output>
```

Use `npm run harness -- smoke --output <unique-output>` when changing core server/client/bridge lifecycle behavior without a more specific consumer scenario.

### Tier 3: full harness self-suite

This tier matches the pull-request CI verification and live-smoke coverage. Use it for changes to harness source, schemas, client, bridge, adapters, build scripts, or CI behavior.

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

Run commands sequentially so a failure remains attributable. `doctor` expects the built client and bridge artifacts.

### Tier 4: complete Fabric portfolio

The repository calls this the complete Fabric portfolio or full suite. It builds every configured checkout, runs repository tests, consumes the exact packaged jars, and executes every maintained scenario exactly once. Use it for release gates, portfolio/catalog changes, cross-mod behavior, or an explicit request for the full suite.

```text
npm ci
npm run build
npm run harness -- portfolio --output <unique-output>
```

The defaults in `config/portfolio.yaml` expect sibling checkouts. Override a checkout without editing committed configuration:

```text
npm run harness -- portfolio --variable <repositoryVariable>=<checkout-path> --output <unique-output>
```

Set `OURO_HARNESS_JAVA_25` and `OURO_HARNESS_JAVA_21` to the corresponding Java executables when the default Java installation cannot cover both target lines. Treat any failed or skipped target as an incomplete portfolio even though later targets continue.

When a request says only "full suite," use Tier 4. If required sibling checkouts, Java versions, Docker, or artifacts are unavailable, report the exact prerequisite gap; do not silently downgrade to Tier 3. A production manifest audit or interoperability run is a separate deploy gate and requires an explicit production inventory or mods directory; do not imply that Tier 4 exercised an unavailable production stack.

### Production deploy gate

Use this only when auditing the deployed inventory or explicitly testing the complete production jar set.

```text
npm run build
node dist/cli.js manifest-check --strict --mods-directory <production-mods-directory>
node dist/cli.js interop --mods-directory <production-mods-directory> --output <unique-output>
```

The checked-in manifest may intentionally expose known drift and missing coverage. A nonzero audit is an actionable result, not a reason to relax strictness. The interop command audits before launch and proves packaging, loaded mod versions, real-client join, restart, and reconnect; focused portfolio scenarios continue to own behavioral cross-mod assertions.

## Task-to-contract map

| Task | Inspect first | Minimum proof |
|---|---|---|
| Edit scenario YAML | Scenario schema, scenario guide, nearest scenario | Tier 1, then affected Tier 2 scenario |
| Add or remove tracked coverage | Manifest coverage code, issue coverage doc, portfolio catalog | `npm test`, `npm run validate`, affected live scenario |
| Change runner, actions, or assertions | Types, runner tests, scenario schema, action-contract scenario | Tier 3 |
| Change server lifecycle or downloads | Server/runner tests, architecture, live-smoke scenario | Tier 3 |
| Change Rust client packets/actions | Client source, exact protocol pin, affected scenarios | Tier 3 plus affected scenario |
| Change bridge or adapter | Architecture, bridge tests, adapter scenario | Tier 3 plus affected scenario |
| Change portfolio target/catalog | Portfolio schema tests, catalog, portfolio guide | `npm test`, `npm run validate`, Tier 4 |
| Change production manifest | Production manifest guide, portfolio `testedVersion` values, exact mods inventory | `npm test`, `npm run validate`, manifest audit; interop when the production directory is available |
| Integrate a consumer release gate | `action.yml`, consumer build output, scenario artifacts | Consumer tests plus pinned live harness run |
| Diagnose a report | Report schema and retained evidence | Reproduce at the narrowest live tier |

## Evidence triage

Every scenario output should retain:

- `report.html`: self-contained human dashboard.
- `summary.md`: concise, GitHub-friendly overview.
- `report.json`: complete schema-validated automation contract.
- `junit.xml`: CI test-report integration.
- `artifacts/`: server logs, bridge/client events, snapshots, service logs, commands, downloads, pins, and other step evidence.

Portfolio output has the same top-level views plus per-target build logs and linked per-scenario evidence. Diagnose in this order:

1. First failed build or scenario step.
2. That step's structured evidence and error.
3. Global findings such as ERROR/FATAL lines, stack traces, crashes, watchdog signatures, wrong-thread failures, premature exit, or timeouts.
4. Relevant server/client/bridge/service logs and before/after snapshots.
5. Cleanup failures, unless cleanup is the only failure.

## Environment and path rules

- Use a fresh output path per run so evidence cannot be confused with a prior attempt.
- Quote paths that contain spaces and pass artifacts as `NAME=PATH` without changing the declared artifact name.
- Use repeatable `--variable NAME=VALUE` flags for checkout or behavior overrides. Values parse as JSON primitives when possible.
- Use `--verbose` only when live streaming helps diagnosis; retained logs remain authoritative.
- Use `--keep-run-directory` only when generated world/config state is needed. Evidence artifacts are retained without it.
- Share `--cache` between runs when appropriate, but never share output or isolated server directories.
