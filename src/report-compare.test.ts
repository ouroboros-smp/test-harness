import assert from "node:assert/strict";
import test from "node:test";
import { compareScenarioReports, semanticReportView } from "./report-compare.js";
import type { ScenarioReport, StepResult } from "./types.js";

function step(id: string, status: StepResult["status"], evidence: Record<string, string>, error?: string): StepResult {
  return {
    id,
    name: `step ${id}`,
    status,
    startedAt: "2026-07-24T00:00:00.000Z",
    finishedAt: "2026-07-24T00:00:01.000Z",
    durationMs: 1_000,
    ...(error === undefined ? {} : { error }),
    evidence,
  };
}

function report(overrides: Partial<ScenarioReport> = {}): ScenarioReport {
  return {
    schemaVersion: 1,
    runId: "run-a",
    scenario: { id: "patrol/native-afk-v3-contract", title: "Native AFK", issues: [38, 52] },
    pins: { minecraft: "26.2", fabricLoader: "0.19.3", fabricApi: "7.1.0", java: 25 },
    status: "passed",
    exitCode: 0,
    startedAt: "2026-07-24T00:00:00.000Z",
    finishedAt: "2026-07-24T00:10:00.000Z",
    durationMs: 600_000,
    steps: [step("boot", "passed", { "server.port": "25565" }), step("afk", "passed", { probe: "a" })],
    findings: [],
    artifacts: { directory: "/tmp/run-a" },
    ...overrides,
  } as ScenarioReport;
}

test("two-run comparison ignores run-specific noise", () => {
  const first = report();
  const second = report({
    runId: "run-b",
    startedAt: "2026-07-24T05:00:00.000Z",
    finishedAt: "2026-07-24T05:12:00.000Z",
    durationMs: 720_000,
    steps: [step("boot", "passed", { "server.port": "40021" }), step("afk", "passed", { probe: "b" })],
    artifacts: { directory: "/tmp/run-b" },
  });
  assert.deepEqual(compareScenarioReports(first, second), []);
  assert.deepEqual(semanticReportView(first), semanticReportView(second));
});

test("two-run comparison surfaces semantic divergence", () => {
  const first = report();
  const diverged = report({
    status: "failed",
    exitCode: 1,
    steps: [step("boot", "passed", { "server.port": "25565" }), step("afk", "failed", {}, "combat authority is unavailable")],
  });
  const differences = compareScenarioReports(first, diverged);
  assert.ok(differences.some((entry) => entry.startsWith("status:")));
  assert.ok(differences.some((entry) => entry.startsWith("steps[1].status:")));
  assert.ok(differences.some((entry) => entry.startsWith("steps[1].evidenceKeys:")));
});

test("two-run comparison reports step count and identity drift", () => {
  const first = report();
  const reordered = report({ steps: [step("afk", "passed", { probe: "a" }), step("boot", "passed", { "server.port": "1" })] });
  const truncated = report({ steps: [step("boot", "passed", { "server.port": "1" })] });
  assert.ok(compareScenarioReports(first, reordered).some((entry) => entry.startsWith("steps[0].id:")));
  assert.ok(compareScenarioReports(first, truncated).some((entry) => entry.startsWith("steps.length:")));
});
