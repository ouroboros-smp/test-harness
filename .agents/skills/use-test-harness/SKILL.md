---
name: use-test-harness
description: Operate and extend the Ouroboros SMP Fabric release-level test harness. Use when an agent needs to run or diagnose harness scenarios, verify packaged mod jars with real clients and a dedicated server, author or update scenario YAML, add a portfolio target or harness-only adapter, audit the production mod manifest or run the full-stack interoperability gate, integrate the composite GitHub Action, inspect evidence reports, or choose and execute the correct test-harness verification suite.
---

# Use the Ouroboros Fabric Test Harness

Exercise packaged Fabric mods at real process and network boundaries. Preserve the distinction between release-level harness coverage and consumer-owned unit tests or Fabric GameTests.

## Establish the operating context

1. Find the harness root by locating `package.json` with the name `@ouroboros-smp/test-harness`. Do not assume the current working directory is the harness checkout.
2. Read the root `README.md` only when entering the repository for the first time or when the task scope remains unclear.
3. Load only the canonical files needed for the task:
   - For scenario work, read `schemas/scenario.schema.json`, `docs/scenarios.md`, and the closest existing file under `scenarios/`.
   - For portfolio work, read `config/portfolio.yaml` and `docs/portfolio.md`.
   - For production-stack work, read `config/production-manifest.yaml` and `docs/production-manifest.md`.
   - For runtime or bridge work, read `docs/architecture.md` and the relevant implementation under `src/`, `bridge/`, `client/`, or `adapters/`.
   - For scenario-report diagnosis, read `schemas/report.schema.json` and the generated evidence.
   - For portfolio-report diagnosis, read the `PortfolioReport` contract in `src/types.ts`, the report writer in `src/portfolio.ts`, and the generated evidence. Do not apply the scenario report schema to a portfolio report.
   - For consumer CI integration, read `action.yml` and its pinned usage in the consumer repository.
4. Treat schemas, source, and committed configuration as authoritative if this skill and the checkout differ.
5. Read [references/verification.md](references/verification.md) only when authoring a scenario, selecting a verification tier, interpreting "full suite," auditing production, or diagnosing a failure.

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
- End lifecycle scenarios with an `always: true` server stop step. Use runner cleanup only as the fallback.

## Follow the task workflow

1. State the observable behavior, packaged artifacts, affected issue coverage, and required environment before editing.
2. Inspect the nearest existing scenario or implementation pattern and make the smallest compatible change.
3. Validate in increasing-cost order: schema and static checks, dry-run resolution, focused live scenario, self-suite, then complete portfolio when required.
4. Inspect structured evidence instead of relying on the process exit code alone.
5. Report the exact commands, output directory, pass or failure status, and the first causal failure. Keep cleanup errors secondary.

## Apply the task playbooks

- For scenario changes, follow [Scenario authoring](references/verification.md#scenario-authoring), preserve issue traceability, and add each maintained scenario to exactly one portfolio target.
- For production-stack work, follow [Production deploy gate](references/verification.md#production-deploy-gate), keep first-party deployment versions aligned with portfolio `testedVersion` values, and preserve known drift as blocking evidence.
- For failures, follow [Evidence triage](references/verification.md#evidence-triage), fix the earliest causal failure, rerun the narrowest live reproducer, and then restore the required wider verification tier.
- For consumer integration, build the release jar first, pass its exact path as the `consumer` artifact or `consumer-jar` action input, pin the harness to a reviewed immutable ref, and upload evidence even on failure.
- For production interop, claim only full-stack packaging, Loader/mixin compatibility, exact loaded mod identity/version, real-client join, restart, reconnect, and global error coverage. Keep focused behavioral interactions in portfolio scenarios.

## Communicate results

Name the scenario, portfolio target, or production manifest; pins; packaged artifacts; exact verification tier; and evidence path. If verification remains incomplete, name the skipped command, reason, and residual risk. Never describe a dry run, schema validation, manifest audit, or unit suite as a live harness pass.
