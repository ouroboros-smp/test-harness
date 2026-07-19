---
name: use-test-harness
description: Operate and extend the Ouroboros SMP Fabric release-level test harness. Use when an agent needs to run or diagnose harness scenarios, verify packaged mod jars with real clients and a dedicated server, author or update scenario YAML, add a portfolio target or harness-only adapter, audit the production mod manifest or run the full-stack interoperability gate, integrate the composite GitHub Action, inspect evidence reports, or choose and execute the correct test-harness verification suite.
---

# Use the Ouroboros Fabric Test Harness

Exercise packaged Fabric mods at real process and network boundaries. Preserve the distinction between release-level harness coverage and consumer-owned unit tests or Fabric GameTests.

## Establish the operating context

1. Locate the harness root by finding `package.json` with the name `@ouroboros-smp/test-harness`. Do not assume the current working directory is the harness checkout.
2. Read the root `README.md`, then load only the canonical files required by the task:
   - Scenario work: `schemas/scenario.schema.json`, `docs/scenarios.md`, and the closest existing file under `scenarios/`.
   - Portfolio work: `config/portfolio.yaml` and `docs/portfolio.md`.
   - Production-stack work: `config/production-manifest.yaml` and `docs/production-manifest.md`.
   - Runtime or bridge work: `docs/architecture.md` and the relevant implementation under `src/`, `bridge/`, `client/`, or `adapters/`.
   - Report diagnosis: `schemas/report.schema.json` and the generated `summary.md`, `report.json`, logs, and event files.
   - Consumer CI integration: `action.yml` and its pinned usage in the consumer repository.
3. Treat schemas, source, and committed configuration as authoritative if this skill and the checkout differ.
4. Read [references/verification.md](references/verification.md) before choosing a test tier, interpreting "full suite," or diagnosing a failed run.

## Preserve the harness boundaries

- Test packaged release jars. Do not replace them with source sets, development run configurations, or copied consumer tests.
- Use real protocol clients for networking, attribution, placement, interaction, death/respawn, reconnect, and event-order behavior.
- Use the authenticated loopback bridge for deterministic setup and server-observable assertions. Never let it stand in for a client action whose packet path is under test.
- Require server acknowledgement or server-observed state before asserting that a client mutation succeeded.
- Keep probes in a separate harness-only adapter. Never add bridge dependencies or test entrypoints to a production jar.
- Use the versions in `config/pins.yaml` unless the scenario intentionally declares a supported deviation. Never silently fall back to another Java, Minecraft, Loader, Fabric API, or protocol version.
- Give every run a dedicated output directory. Preserve evidence after failure; use `--keep-run-directory` only when inspecting generated server state.
- Prefer bounded tick or event waits over fixed sleeps. Use wall-clock waits only for behavior that is inherently time-based.
- Keep global log failure detection strict. Allowlist only an exact, expected signature.
- End lifecycle scenarios with an `always: true` server stop step. Runner cleanup remains the fallback, not the primary lifecycle assertion.

## Follow the task workflow

1. State the observable behavior, packaged artifacts, affected issue coverage, and required environment before editing.
2. Inspect the nearest existing scenario or implementation pattern and make the smallest compatible change.
3. Validate in increasing-cost order: schema and static checks, dry-run resolution, focused live scenario, self-suite, then complete portfolio when required.
4. Inspect structured evidence instead of relying on the process exit code alone.
5. Report the exact commands, output directory, pass or failure status, and the first causal failure. Keep cleanup errors secondary.

## Author or update a scenario

1. Start from the closest behaviorally similar scenario; do not invent operation fields from memory.
2. Keep `schemaVersion: 1`, a namespaced stable `id`, a descriptive `title`, at least one issue number, and unique step ids.
3. Declare every packaged artifact and client explicitly. Use variables for checkout-specific paths or tunable inputs.
4. Prepare state through a real client when attribution, placement, interaction, or ordering is under test. Use the bridge for deterministic state that is only a precondition.
5. Capture before/after snapshots around destructive actions, reconnects, reloads, and restarts.
6. Assert externally observable outcomes with the standard actions and assertions documented in `docs/scenarios.md` and accepted by the schema.
7. Add maintained scenarios to exactly one target in `config/portfolio.yaml`. Update `docs/issue-coverage.md` and the code-level tracked issue set when coverage changes.
8. Run validation and a dry run before launching Minecraft:

```text
npm run validate
npm run harness -- run <scenario-id> --artifact <name>=<packaged-jar> --dry-run --output <unique-output>
```

9. Run the live scenario with the same resolved inputs, then inspect all four report views and retained logs.

## Audit or run the production stack

1. Treat `config/production-manifest.yaml` as the exact deploy-to-test inventory and `config/portfolio.yaml` as the executable coverage inventory. Keep first-party production versions aligned with their `testedVersion` values.
2. Run `npm run validate` for structure, then use `node dist/cli.js manifest-check` for catalog/version drift. Add `--mods-directory <path>` to audit the exact jar directory and `--strict` to require every third-party version pin.
3. Expect the checked-in manifest audit to report documented gaps until they are resolved. Do not weaken, allowlist, or omit drift to obtain a green result.
4. Run `node dist/cli.js interop --mods-directory <path> --output <unique-output>` only against the intended production jar directory. The command must reject incomplete pins, missing or undeclared jars, ambiguous patterns, and portfolio/version drift before launching.
5. Interpret a passing interop run narrowly: it proves full-stack packaging, Loader/mixin compatibility, exact loaded mod ids and versions, real-client join, restart, reconnect, and global error checks. It does not replace focused behavioral interaction scenarios.

## Diagnose a failed run

1. Open `summary.md` for orientation and `report.json` for the automation contract.
2. Find the first failed step and its evidence. Then inspect `failureSummary`, global findings, server logs, client events, bridge events, service logs, and snapshots as applicable.
3. Classify the failure as environment, artifact resolution, server lifecycle, client protocol/action, assertion, global log rule, timeout, cleanup, or consumer behavior.
4. Fix the earliest causal failure. Do not mask it with broader timeouts, sleeps, retries, or log allowlists.
5. Re-run the narrowest scenario that reproduces the failure, then restore the required wider verification tier.

## Integrate a consumer repository

- Build the consumer release jar first and pass its exact path as the `consumer` artifact or the composite action's `consumer-jar` input.
- Pin `ouroboros-smp/test-harness` to a reviewed immutable ref for release gates.
- Upload the evidence directory even on failure. Stable outputs are `passed`, `report`, `html`, `junit`, `server-log`, and `artifact-directory`.
- Keep fast unit and GameTest coverage in the consumer repository; use the harness for packaged-jar, networking, process, persistence, restart, interoperability, and soak boundaries.

## Communicate results

Name the scenario, portfolio target, or production manifest, pins, packaged artifacts, exact verification tier, and evidence path. If verification is incomplete, name the skipped command, reason, and residual risk. Never describe a dry run, schema validation, manifest audit, or unit suite as a live harness pass.
