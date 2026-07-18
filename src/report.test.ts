import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeReport } from "./report.js";
import type { ScenarioReport } from "./types.js";

test("human reports surface failures, evidence, performance, and portable links safely", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ouro-report-test-"));
  try {
    const report: ScenarioReport = {
      schemaVersion: 1,
      runId: "readable-report-test",
      scenario: { id: "harness/readable", title: "Readable <script>alert(1)</script>", issues: [1] },
      pins: { minecraft: "26.2", loader: "0.19.3", fabricApi: "0.154.2+26.2", installer: "1.1.1", java: 25, protocol: 776 },
      status: "failed",
      exitCode: 1,
      startedAt: "2026-07-18T12:00:00.000Z",
      finishedAt: "2026-07-18T12:01:01.250Z",
      durationMs: 61_250,
      steps: [
        {
          id: "unsafe-step",
          name: "Render evidence",
          status: "failed",
          startedAt: "2026-07-18T12:00:00.000Z",
          finishedAt: "2026-07-18T12:01:01.250Z",
          durationMs: 61_250,
          error: "Expected value but got <img src=x onerror=alert(1)>",
          evidence: { metrics: { p99: 12.5 }, message: "<script>not executable</script>" },
        },
      ],
      findings: [{ rule: "error-line", severity: "error", line: "consumer | failed", lineNumber: 42 }],
      performance: { samples: 10, mspt: { p50: 0, p95: 8, p99: 12.5, max: 18 }, errorLines: 1, errorsPerMinute: 0.98 },
      artifacts: { "server-log": join(directory, "artifacts", "harness server.log") },
      failureSummary: "The scenario failed visibly.",
    };

    const paths = await writeReport(report, directory);
    const html = await readFile(paths.html!, "utf8");
    const summary = await readFile(paths.summary!, "utf8");
    const stored = JSON.parse(await readFile(paths.report!, "utf8")) as ScenarioReport;

    assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
    assert.match(html, /Readable &lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    assert.match(html, /Failure summary/);
    assert.match(html, /MSPT p99/);
    assert.match(html, /<span>MSPT p50<\/span><strong>0ms<\/strong>/);
    assert.match(html, /artifacts\/harness%20server\.log/);
    assert.doesNotMatch(summary, /Readable <script>alert\(1\)<\/script>/);
    assert.match(summary, /Readable &lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    assert.match(summary, /## Performance/);
    assert.match(summary, /<details><summary>Evidence/);
    assert.match(summary, /## Log findings/);
    assert.equal(stored.artifacts.html, join(directory, "report.html"));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
