import assert from "node:assert/strict";
import test from "node:test";
import { LogMonitor } from "./log-monitor.js";

test("global rules flag errors, stack traces, watchdogs, and thread violations", () => {
  const monitor = new LogMonitor();
  monitor.accept("[Server thread/ERROR]: consumer failed\n");
  monitor.accept("    at example.Mod.run(Mod.java:10)\n");
  monitor.accept("Watchdog: server has not responded\n");
  monitor.accept("IllegalStateException: not on the server thread\n");
  assert.deepEqual(monitor.findings.map((finding) => finding.rule), [
    "error-line",
    "stack-trace",
    "watchdog",
    "thread-violation",
  ]);
});

test("zero-valued diagnostic summaries are not treated as failures", () => {
  const monitor = new LogMonitor();
  monitor.accept("error rate=0\n0 errors\n");
  assert.equal(monitor.findings.length, 0);
});
