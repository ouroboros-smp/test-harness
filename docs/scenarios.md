# Scenario authoring

Scenarios are YAML files under `scenarios/` and validate against
`schemas/scenario.schema.json`. Use an id namespaced by consumer, list every
GitHub issue the scenario closes, and pin only when a consumer intentionally
deviates from `config/pins.yaml`.

## Minimal example

```yaml
schemaVersion: 1
id: example/restart
title: Example restart persistence
issues: [123]
artifacts:
  consumer: { required: true, description: Packaged server jar }
clients:
  - { name: owner, username: ExampleOwner }
server:
  reuseWorldOnRestart: true
steps:
  - id: start
    name: Boot and join
    actions: [{ type: server.start }]
  - id: before
    name: Capture state
    actions:
      - { type: snapshot.capture, name: before, path: /v1/player/state?name=ExampleOwner }
  - id: restart
    name: Restart and compare
    actions:
      - { type: server.restart, reconnect: true }
      - { type: snapshot.capture, name: after, path: /v1/player/state?name=ExampleOwner }
    assertions:
      - { type: snapshot.equals, left: before, right: after, path: inventory }
  - id: stop
    name: Stop even after a prior failure
    always: true
    actions: [{ type: server.stop }]
```

## Standard actions

| Family | Actions |
|---|---|
| Lifecycle | `server.start`, `server.stop`, `server.restart` |
| Client | `client.connect`, `disconnect`, `reconnect`, `chat`, `command`, `move`, `look`, `select_hotbar`, `use_block`, `place_block`, `break_block`, `attack`, `respawn`, `click_window` |
| Control | `console.command`, `bridge.request`, `http.request` |
| Time | `wait.duration`, `wait.ticks`, `wait.event` |
| State | `file.write`, `sqlite.query`, `snapshot.capture` |
| Load | `soak.run` with a repeatable nested `behavior` action list |
| Extension | `adapter.invoke` with nested standard actions or a registered bridge adapter |
| Service | `service.start`, `service.exec`, `service.stop` manage isolated Docker dependencies and retain logs |
| External suite | `process.exec` runs an explicit command array in a declared working directory and captures its output as evidence |

Values may reference `${run.directory}`, `${artifact.directory}`,
`${server.port}`, `${bridge.port}`, `${port.NAME}`, `${artifact.NAME}`,
`${platform.gradleWrapper}`, and scenario variables. Supply scenario overrides
with repeatable `--variable NAME=VALUE` flags.

## Standard assertions

| Family | Assertions |
|---|---|
| Server log | `log.absent`, `log.present`, `log.rate` |
| Client | `client.event`, `client.inventory`, `client.state`, `client.window` |
| Structured server state | `bridge.json`, `sqlite.query`, `value.json` |
| Persistence | `snapshot.equals` |
| Performance | `metric.threshold` |
| Artifacts | `file.exists`, `file.json`, `command.output` |
| Extension | `adapter.assert` |

Comparison operators are `equals`, `not_equals`, `contains`, `not_contains`, `matches`, `gte`,
`gt`, `lte`, `lt`, `exists`, and `absent`. JSON paths are dot-separated and may
address array indices, for example `inventory.38.item`.

## Design rules

1. Assert an observable outcome, not a fixed sleep. Use tick/event waits; a
   bounded short duration is appropriate only for wall-clock behavior.
2. Prepare state through real client actions when the behavior under test is
   attribution, placement, interaction, or event ordering. Use the bridge for
   deterministic setup that is not itself under test.
3. Capture state before and after destructive or persistence transitions.
4. Keep a final `always: true` stop step, while relying on the runner's process
   cleanup as the second line of defense.
5. Allowlist only an exact expected error signature. Broad ERROR or exception
   allowlists defeat global failure detection.
6. Put consumer probes in a separate harness-only adapter. Never add a bridge
   dependency or test entrypoint to a production jar.
7. Use `controlBridge: false` for a client-only mod or a server mod whose
   lifecycle must be observed without the harness bridge.

## Generated full-manifest scenario

`ouro-harness interop --mods-directory PATH` generates
`portfolio/full-manifest-interop` from `config/production-manifest.yaml`.
Every enabled entry becomes a required artifact. The scenario boots the full
stack, joins a real protocol client, asserts each Fabric Loader mod id and
pinned version through `/v1/mods`, restarts, and repeats the assertions. Keep
domain-specific interop behavior in focused scenarios; this generated gate is
the broad packaging, mixin, dependency-resolution, join, and restart safety
net.
