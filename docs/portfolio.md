# Portfolio catalog

`config/portfolio.yaml` is the reproducible inventory for the complete
Ouroboros Fabric test suite. It keeps repository builds and packaged-jar runtime
tests together without putting repository-specific paths into scenario files.

Each target declares:

- a stable id, title, and checkout path;
- the exact `testedVersion` used by production drift checks;
- one or more clean build/test commands with an explicit Java major;
- a command base when a consumer build must invoke a harness-owned adapter;
- the exact packaged jars supplied to scenario artifact names;
- optional scenario variables, such as a real-client GameTest checkout; and
- every maintained scenario owned by that target.

The runner executes targets sequentially because Minecraft servers, Gradle, and
Docker-backed integration tests are resource-intensive. A failed build skips
only that target's runtime scenarios; later targets still run. The aggregate
`report.html`, `summary.md`, `report.json`, and `junit.xml` therefore describe
the entire attempt, while each scenario retains its full evidence bundle.

## Run the portfolio

```bash
npm run build
npm run harness -- portfolio --output artifacts/full-portfolio
```

Repository variables default to sibling checkouts. Override any one of them
without changing committed configuration:

```bash
npm run harness -- portfolio \
  --variable watershedRepository=/worktrees/watershed-clean \
  --output artifacts/full-portfolio
```

Set `OURO_HARNESS_JAVA_25` and `OURO_HARNESS_JAVA_21` to the corresponding
absolute `java` executable paths before every mixed-Java portfolio run. The
runner derives `JAVA_HOME` for each build from those values and fails before a
build rather than silently inheriting an ambient Java. Downloads share the
normal harness cache.

Build commands run from the target repository by default. A command with
`base: harness` runs from the harness root; Coffer uses this after its Fabric
server and core jars exist so the harness-only adapter always compiles against
the same isolated checkout that the scenario exercises.

## Add another Fabric mod

1. Add a target with its repository variable, clean build/test command, Java
   major, release jar mapping, and scenario ids.
2. Add one or more schema-valid scenarios under `scenarios/<mod>/`. Prefer
   externally observable client, command, HTTP, file, database, and restart
   behavior. Add a harness-only adapter only for state that no public boundary
   exposes.
3. Add any issue numbers to `TRACKED_ISSUES` and the traceability table.
4. Run `npm test` and `npm run validate`. The portfolio contract test fails if
   a maintained scenario is absent from the catalog or appears more than once.
5. Run the full portfolio and inspect both the aggregate dashboard and each
   linked scenario report before publishing.

Artifact paths intentionally name versioned release jars. Updating a mod
version therefore requires an explicit catalog change, preventing a stale jar
from silently satisfying a glob.

## Relate the portfolio to production

The catalog answers "what do we test?" while
`config/production-manifest.yaml` answers "what do we deploy together?" Run
`node dist/cli.js manifest-check` to compare them. Enabled first-party mods
must name a portfolio target, and its production version must equal the
target's `testedVersion`. An optional `--mods-directory` check also makes the
manifest exhaustive over the concrete jar set.

The portfolio contains runnable Fabric targets only. Repositories that are
websites, documentation, external services, alternate server engines, or
legacy Folia implementations belong in the assessment matrix but not in this
executable catalog.
