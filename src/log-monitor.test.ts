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

test("ordinary installed and disabled messages do not look like a stalled server thread", () => {
  const monitor = new LogMonitor();
  monitor.accept("[Server thread/INFO]: FabricExporter is not installed; application metrics are disabled\n");
  assert.equal(monitor.findings.length, 0);
});

test("orderly Minecraft client teardown ignores only the first Netty frame attached to the stackless exception", () => {
  const monitor = new LogMonitor();
  monitor.accept("io.netty.channel.StacklessClosedChannelException\n");
  monitor.accept("\tat io.netty.channel.AbstractChannel$AbstractUnsafe.write(Object, ChannelPromise)(Unknown Source)\n");
  monitor.accept("\tat example.Consumer.explode(Consumer.java:42)\n");
  monitor.accept("\tat io.netty.channel.AbstractChannel.close(ChannelPromise)(Unknown Source)\n");
  assert.equal(monitor.findings.length, 2);
  assert.match(monitor.findings[0]!.line, /Consumer\.explode/);
  assert.match(monitor.findings[1]!.line, /AbstractChannel\.close/);
});

test("a standalone closed-channel-looking frame remains actionable", () => {
  const monitor = new LogMonitor();
  monitor.accept("\tat io.netty.channel.AbstractChannel.close(ChannelPromise)(Unknown Source)\n");
  assert.equal(monitor.findings.length, 1);
});
