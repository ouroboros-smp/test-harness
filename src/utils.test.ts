import assert from "node:assert/strict";
import test from "node:test";
import { getJsonPath, interpolate, percentile } from "./utils.js";

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
