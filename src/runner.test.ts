import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadPins, resolveScenario } from "./manifest.js";
import { runScenario } from "./runner.js";

test("dry-run executes the application contract without downloads or Java", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ouro-harness-test-"));
  try {
    const { scenario } = await resolveScenario("harness/live-smoke");
    const report = await runScenario(scenario, await loadPins(), {
      artifacts: {},
      output: directory,
      dryRun: true,
      keepRunDirectory: true,
      verbose: false,
    });
    assert.equal(report.status, "passed");
    assert.ok(report.steps.every((step) => step.status === "skipped"));
    const stored = JSON.parse(await readFile(join(directory, "report.json"), "utf8")) as { scenario: { id: string }; artifacts: Record<string, string> };
    assert.equal(stored.scenario.id, "harness/live-smoke");
    assert.equal(stored.artifacts.report, join(directory, "report.json"));
    assert.equal(stored.artifacts.html, join(directory, "report.html"));
    assert.ok(await readFile(join(directory, "junit.xml"), "utf8"));
    const html = await readFile(join(directory, "report.html"), "utf8");
    assert.match(html, /Ouroboros Fabric test harness/);
    assert.match(html, /data-filter="failed"/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
