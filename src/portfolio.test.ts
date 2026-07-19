import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadAllScenarios } from "./manifest.js";
import { loadPortfolioManifest, runPortfolio, validatePortfolioManifest } from "./portfolio.js";

test("portfolio catalog maps every maintained scenario exactly once", async () => {
  const manifest = await loadPortfolioManifest();
  const catalogScenarios = manifest.targets.flatMap((target) => target.scenarios).sort();
  const maintainedScenarios = (await loadAllScenarios()).map(({ scenario }) => scenario.id).sort();
  assert.deepEqual(catalogScenarios, maintainedScenarios);
  assert.equal(new Set(catalogScenarios).size, catalogScenarios.length);
  assert.equal(manifest.targets.length, 11);
  assert.equal(manifest.targets.find((target) => target.id === "test-harness")?.repository, ".");
});

test("portfolio catalog builds only maintained Fabric modules and orders the Coffer adapter after its jars", async () => {
  const manifest = await loadPortfolioManifest();
  const commands = manifest.targets.flatMap((target) => target.build.flatMap((build) => build.command));
  assert.equal(commands.some((part) => /(?:^|:)(?:folia|paper|minecraft-plugin|plugin|minestom-spike)(?::|$)/i.test(part)), false);
  for (const targetId of ["coffer", "kinship", "mehen", "patrol", "watershed", "wildanimalbalancer", "ourometrics"]) {
    const target = manifest.targets.find((candidate) => candidate.id === targetId)!;
    for (const build of target.build) {
      const gradleTasks = build.command.slice(1).filter((part) => !part.startsWith("-"));
      assert.ok(gradleTasks.length > 0, `${targetId} must declare explicit Gradle tasks`);
      assert.ok(gradleTasks.every((task) => task.startsWith(":")), `${targetId} must not invoke an aggregate root task`);
    }
  }

  const harness = manifest.targets.find((target) => target.id === "test-harness")!;
  assert.deepEqual(harness.build.at(-1)?.command.slice(1), [":bridge:build"]);

  const coffer = manifest.targets.find((target) => target.id === "coffer")!;
  assert.equal(coffer.build.length, 2);
  assert.equal(coffer.build[1]?.base, "harness");
  assert.ok(coffer.build[1]?.command.some((part) => part.includes("coffer-fabric-server-1.3.0.jar")));
  assert.ok(coffer.build[1]?.command.some((part) => part.includes("core-1.3.0.jar")));
  assert.equal(coffer.build[1]?.command.at(-1), ":adapters:coffer:build");
});

test("portfolio validation rejects duplicate and malformed targets", () => {
  const failures = validatePortfolioManifest({
    schemaVersion: 1,
    title: "Invalid",
    targets: [
      { id: "same", title: "One", repository: ".", build: [{ name: "build", command: ["true"] }], scenarios: ["one"] },
      { id: "same", title: "Two", repository: ".", build: [{ name: "", command: [], base: "elsewhere" }], scenarios: [] },
    ],
  });
  assert.ok(failures.some((failure) => failure.includes("duplicate target id")));
  assert.ok(failures.some((failure) => failure.includes("command must be")));
  assert.ok(failures.some((failure) => failure.includes("base must be")));
  assert.ok(failures.some((failure) => failure.includes("scenarios must be")));
});

test("portfolio commands can run from repository and harness bases", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ouro-portfolio-base-test-"));
  try {
    const repository = join(directory, "consumer");
    const repositoryMarker = join(directory, "repository-cwd.txt");
    const harnessMarker = join(directory, "harness-cwd.txt");
    await mkdir(repository);
    const config = join(directory, "portfolio.yaml");
    await writeFile(config, JSON.stringify({
      schemaVersion: 1,
      title: "Command bases",
      targets: [{
        id: "command-bases",
        title: "Command bases",
        repository,
        build: [
          { name: "repository", command: [process.execPath, "-e", `require('node:fs').writeFileSync(${JSON.stringify(repositoryMarker)}, process.cwd())`] },
          { name: "harness", base: "harness", command: [process.execPath, "-e", `require('node:fs').writeFileSync(${JSON.stringify(harnessMarker)}, process.cwd())`] },
          { name: "stop before live scenario", command: [process.execPath, "-e", "process.exit(1)"] },
        ],
        scenarios: ["harness/action-contract"],
      }],
    }), "utf8");

    const report = await runPortfolio({ config, output: join(directory, "output"), keepRunDirectory: false, verbose: false });
    assert.deepEqual(report.targets[0]?.builds.map((build) => build.status), ["passed", "passed", "failed"]);
    assert.equal(await readFile(repositoryMarker, "utf8"), repository);
    assert.equal(await readFile(harnessMarker, "utf8"), process.cwd());
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("portfolio builds never inherit ambient Java when a declared toolchain is absent", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ouro-portfolio-java-test-"));
  const javaMajor = 2_147_483_647;
  const variable = `OURO_HARNESS_JAVA_${javaMajor}`;
  const previous = process.env[variable];
  delete process.env[variable];
  try {
    const config = join(directory, "portfolio.yaml");
    await writeFile(config, JSON.stringify({
      schemaVersion: 1,
      title: "Strict Java",
      targets: [{
        id: "strict-java",
        title: "Strict Java",
        repository: directory,
        build: [{ name: "must not run", command: [process.execPath, "-e", "process.exit(0)"], java: javaMajor }],
        scenarios: ["harness/action-contract"],
      }],
    }), "utf8");

    const report = await runPortfolio({ config, output: join(directory, "output"), keepRunDirectory: false, verbose: false });
    assert.equal(report.targets[0]?.builds[0]?.status, "failed");
    assert.match(report.targets[0]?.builds[0]?.error ?? "", new RegExp(variable));
    assert.match(report.targets[0]?.builds[0]?.error ?? "", /never fall back to ambient Java/);
  } finally {
    if (previous === undefined) delete process.env[variable];
    else process.env[variable] = previous;
    await rm(directory, { recursive: true, force: true });
  }
});

test("portfolio failures still produce escaped aggregate HTML, JSON, Markdown, and JUnit", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ouro-portfolio-test-"));
  try {
    const config = join(directory, "portfolio.yaml");
    const output = join(directory, "output");
    await writeFile(config, JSON.stringify({
      schemaVersion: 1,
      title: "Portfolio <script>alert(1)</script>",
      targets: [{
        id: "missing-repository",
        title: "Missing <repository>",
        repository: join(directory, "does-not-exist"),
        build: [{ name: "Not run", command: ["unused"] }],
        scenarios: ["harness/action-contract"],
      }],
    }), "utf8");
    const report = await runPortfolio({ config, output, keepRunDirectory: false, verbose: false });
    assert.equal(report.status, "failed");
    assert.equal(report.targets[0]?.scenarios[0]?.status, "skipped");
    const html = await readFile(report.artifacts.html!, "utf8");
    const summary = await readFile(report.artifacts.summary!, "utf8");
    const junit = await readFile(report.artifacts.junit!, "utf8");
    assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
    assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    assert.match(summary, /Portfolio &lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    assert.match(junit, /<skipped/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
