import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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

test("portfolio validation rejects duplicate and malformed targets", () => {
  const failures = validatePortfolioManifest({
    schemaVersion: 1,
    title: "Invalid",
    targets: [
      { id: "same", title: "One", repository: ".", build: [{ name: "build", command: ["true"] }], scenarios: ["one"] },
      { id: "same", title: "Two", repository: ".", build: [{ name: "", command: [] }], scenarios: [] },
    ],
  });
  assert.ok(failures.some((failure) => failure.includes("duplicate target id")));
  assert.ok(failures.some((failure) => failure.includes("command must be")));
  assert.ok(failures.some((failure) => failure.includes("scenarios must be")));
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
