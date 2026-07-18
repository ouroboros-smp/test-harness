import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse } from "yaml";
import { issueCoverage, loadAllScenarios, loadPins, repositoryRoot, validateScenario } from "./manifest.js";

test("all issue contracts load with unique ids and complete 1-22 coverage", async () => {
  const entries = await loadAllScenarios();
  assert.equal(entries.length, 22);
  const ids = entries.map(({ scenario }) => scenario.id);
  assert.equal(new Set(ids).size, ids.length);
  const coverage = issueCoverage(entries.map(({ scenario }) => scenario));
  assert.deepEqual(coverage.missing, []);
  assert.deepEqual([...coverage.coverage.keys()].sort((a, b) => a - b), Array.from({ length: 22 }, (_, index) => index + 1));
});

test("Fabric runtime pins are internally consistent", async () => {
  const pins = await loadPins();
  assert.deepEqual(pins, {
    minecraft: "26.2",
    loader: "0.19.3",
    fabricApi: "0.154.2+26.2",
    installer: "1.1.1",
    java: 25,
    protocol: 776,
  });
});

test("composite action exposes the stable consumer contract", async () => {
  const action = parse(await readFile(join(repositoryRoot(), "action.yml"), "utf8")) as Record<string, unknown>;
  const inputs = action.inputs as Record<string, unknown>;
  const outputs = action.outputs as Record<string, unknown>;
  for (const input of ["scenario", "consumer-jar", "minecraft-version", "loader-version", "fabric-api-version"]) {
    assert.ok(input in inputs, `missing action input ${input}`);
  }
  for (const output of ["passed", "report", "junit", "server-log", "artifact-directory"]) {
    assert.ok(output in outputs, `missing action output ${output}`);
  }
});

test("the published schema rejects unknown fields and invalid Minecraft usernames", () => {
  const invalid = {
    schemaVersion: 1,
    id: "schema/invalid",
    title: "Invalid schema fixture",
    issues: [1],
    clients: [{ name: "bot", username: "not-valid!" }],
    steps: [{ id: "check", name: "Check", assertions: [{ type: "log.absent", pattern: "ERROR" }] }],
    unexpected: true,
  };
  const failures = validateScenario(invalid);
  assert.ok(failures.some((failure) => failure.includes("additional properties")));
  assert.ok(failures.some((failure) => failure.includes("pattern")));
});
