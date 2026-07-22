import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadPins, resolveScenario } from "./manifest.js";
import { assertComparison, deleteConfinedFile, extractValue, runScenario, samplePerformance, waitUntilAssertion } from "./runner.js";
import { HarnessError } from "./errors.js";

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

test("wait.until retries assertion failures and returns after success", async () => {
  let attempts = 0;
  await waitUntilAssertion(async () => {
    attempts++;
    if (attempts < 3) throw new HarnessError("ASSERTION_FAILED", `observed ${attempts}`);
  }, 100, 1);
  assert.equal(attempts, 3);
});

test("wait.until does not retry invalid assertions", async () => {
  let attempts = 0;
  await assert.rejects(
    waitUntilAssertion(async () => {
      attempts++;
      throw new HarnessError("INVALID_ASSERTION", "missing path");
    }, 100, 1),
    /missing path/,
  );
  assert.equal(attempts, 1);
});

test("wait.until timeout reports the last observed assertion failure", async () => {
  let attempts = 0;
  await assert.rejects(
    waitUntilAssertion(async () => {
      attempts++;
      throw new HarnessError("ASSERTION_FAILED", `last observed value ${attempts}`);
    }, 5, 1),
    /last observed value/,
  );
  assert.ok(attempts > 1);
});

test("contains comparisons handle missing JSON paths as assertion results", () => {
  assert.doesNotThrow(() => assertComparison(undefined, "not_contains", "item", "missing path"));
  assert.throws(() => assertComparison(undefined, "contains", "item", "missing path"), /got undefined/);
});

test("value extraction reads structured action output and rejects missing paths", () => {
  const value = [{ id: "structure-1", anchor: { x: 4 } }];
  assert.equal(extractValue(value, "0.id"), "structure-1");
  assert.equal(extractValue(value, "0.anchor.x"), 4);
  assert.throws(() => extractValue(value, "0.anchor.y"), /path 0\.anchor\.y is missing/);
});

test("sampled performance exposes release-gate percentiles", () => {
  assert.deepEqual(samplePerformance([4, 1, 5, 3, 2]), {
    mspt: { p50: 3, p95: 5, p99: 5, max: 5 },
  });
  assert.throws(() => samplePerformance([]), /performance samples are empty/);
});

test("file deletion is confined to the generated run directory", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ouro-harness-delete-"));
  try {
    const target = join(directory, "mods", "optional.jar");
    await mkdir(join(directory, "mods"));
    await writeFile(target, "jar");
    assert.equal(await deleteConfinedFile(directory, "mods/optional.jar"), target);
    await assert.rejects(readFile(target));
    await assert.rejects(deleteConfinedFile(directory, "../outside.jar"), /escapes run directory/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
