import assert from "node:assert/strict";
import test from "node:test";
import { elapsedTimer, formatDuration, getJsonPath, interpolate, percentile } from "./utils.js";

test("elapsed timers report non-negative, non-decreasing integer durations", async () => {
  const elapsed = elapsedTimer();
  const first = elapsed();
  await new Promise((resolve) => setTimeout(resolve, 5));
  const second = elapsed();
  assert.ok(Number.isInteger(first) && first >= 0);
  assert.ok(Number.isInteger(second) && second >= first);
});

test("interpolation preserves typed exact variables and replaces embedded values", () => {
  const values = { port: 25565, name: "Alice" };
  assert.equal(interpolate("${port}", values), 25565);
  assert.equal(interpolate("hello-${name}", values), "hello-Alice");
});

test("JSON paths support objects and arrays", () => {
  assert.equal(getJsonPath({ players: [{ name: "Alice" }] }, "players.0.name"), "Alice");
  assert.equal(getJsonPath({ players: [] }, "players.1.name"), undefined);
});

test("percentiles use nearest-rank ordering", () => {
  assert.equal(percentile([50, 10, 30, 20, 40], 0.5), 30);
  assert.equal(percentile([50, 10, 30, 20, 40], 0.99), 50);
  assert.equal(percentile([], 0.95), 0);
});

test("durations never round the seconds component up to sixty", () => {
  // Regression: independent minute-floor and second-round rendered impossible "1m 60s" / "60.0s".
  assert.equal(formatDuration(119_600), "2m 0s");
  assert.equal(formatDuration(179_600), "3m 0s");
  assert.equal(formatDuration(59_999), "1m 0s");
  assert.equal(formatDuration(59_999, 2), "1m 0s");
  assert.equal(formatDuration(60_000), "1m 0s");
});

test("durations preserve unit precision below the rollover boundary", () => {
  assert.equal(formatDuration(500), "500ms");
  assert.equal(formatDuration(5_432, 2), "5.43s");
  assert.equal(formatDuration(5_432), "5.4s");
  assert.equal(formatDuration(30_000), "30.0s");
  assert.equal(formatDuration(61_250), "1m 1s");
  assert.equal(formatDuration(90_000), "1m 30s");
});
