# Production manifest

`config/production-manifest.yaml` is the deploy-to-test contract for the
Ouroboros Fabric server. It is intentionally separate from the executable
portfolio: the portfolio records build/test targets, while this manifest
records the complete set of jars that must coexist in production.

The top-level Minecraft and Fabric Loader versions must match the harness pins;
the enabled Fabric API entry must match the Fabric API pin as well.

## What each entry records

- `id` is the stable harness artifact key.
- `modId` is the exact Fabric Loader id verified at runtime.
- `owner` separates first-party release obligations from upstream risk.
- `bucket` sets the third-party test obligation: critical dependency,
  gameplay, performance, protocol/infrastructure, or operational.
- `version` is the deployment pin. Missing third-party versions are warnings
  by default and errors under `--strict`; missing first-party pins are always
  errors.
- `file` is an exact jar basename. `filePattern` is allowed while completing
  an imported inventory, but it must resolve to exactly one file.
- `portfolioTarget` connects a deployed first-party mod to the exact
  `testedVersion` in `config/portfolio.yaml`.
- `obligations` and `touchpoints` preserve why the mod is present and which
  focused scenarios are needed beyond the broad boot gate.

Folia jars do not belong in this manifest. The project has selected Fabric as
the runtime; a Folia-only repository is legacy migration context until it
produces a Fabric artifact.

## Audit modes

`npm run validate` checks the manifest structure and scenario contracts. The
commands below add semantic deployment and directory drift checks.

```bash
# Catalog/version drift only
node dist/cli.js manifest-check

# Machine-readable output
node dist/cli.js manifest-check --json

# Exact directory inventory: missing, ambiguous, disabled, and undeclared jars
node dist/cli.js manifest-check --mods-directory /srv/minecraft/mods

# Require exact third-party version pins too
node dist/cli.js manifest-check --strict --mods-directory /srv/minecraft/mods
```

An error exits nonzero. Warnings identify incomplete upstream pins but do not
hide first-party drift.

## Full-stack run

```bash
node dist/cli.js interop \
  --mods-directory /srv/minecraft/mods \
  --output artifacts/production-interop
```

The command audits first, resolves each enabled entry to one exact jar, then
generates a scenario that:

1. boots the complete Fabric 26.2 set;
2. joins a real protocol-776 client;
3. queries `/v1/mods` and verifies every configured mod id/version;
4. restarts the same isolated server and reconnects the client; and
5. repeats the loader inventory and global error checks.

The command refuses to run while first-party drift or directory inventory
errors remain. That prevents a convenient smoke test from blessing a stack
different from the one the catalog claims to cover.

## Known initial failures

The July 18 source inventory is checked in without suppressing its gaps:

- production Mehen `2.0.0` differs from portfolio-tested `1.0.5`;
- Ouroboros Relay `0.1.0`, OuroVeil `1.0.0`, and Secret Spectator `1.1.1`
  have no executable portfolio targets; and
- several third-party versions still need exact pins from a fresh mods-folder
  export.

Resolve these findings by adding real coverage or correcting the manifest and
catalog. Do not allowlist the drift.
