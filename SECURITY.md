# Security

The harness starts intentionally unauthenticated Minecraft servers only on the
loopback interface in isolated temporary directories. Do not bind a harness
server or bridge to a public interface.

The test bridge requires a random per-run bearer token, accepts requests only on
`127.0.0.1`, and does not persist its token. Never package the bridge or a
consumer test adapter into a production mod jar.

Remote artifact URLs should be immutable and include SHA-256 in the scenario.
Locally supplied jars are checksummed into the run evidence. CI credentials,
production worlds, player data, and server secrets do not belong in scenarios,
overlays, reports, or uploaded failure artifacts.

This public repository intentionally does not run `pull_request` workflows on
its persistent self-hosted runner. Maintainers validate contributions from
forks by pushing the reviewed commit to an organization-owned branch, which
triggers the same required workflow without executing fork-controlled workflow
definitions on the runner.
