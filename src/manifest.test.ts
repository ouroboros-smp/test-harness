import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse } from "yaml";
import { issueCoverage, loadAllScenarios, loadPins, repositoryRoot, TRACKED_ISSUES, validateScenario } from "./manifest.js";
import type { Scenario, ScenarioStep } from "./types.js";

test("all issue contracts load with unique ids and explicit tracked-issue coverage", async () => {
  const entries = await loadAllScenarios();
  assert.ok(entries.length > 0);
  const ids = entries.map(({ scenario }) => scenario.id);
  assert.equal(new Set(ids).size, ids.length);
  const coverage = issueCoverage(entries.map(({ scenario }) => scenario));
  assert.deepEqual(coverage.missing, []);
  assert.deepEqual(
    [...coverage.coverage.keys()].sort((a, b) => a - b),
    TRACKED_ISSUES,
  );
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

test("Mehen waits for the final MariaDB server instead of its temporary initializer", async () => {
  const entry = (await loadAllScenarios()).find(({ scenario }) => scenario.id === "mehen/governance-acceptance");
  const mariadb = entry?.scenario.steps
    .flatMap((step) => step.actions ?? [])
    .find((action) => action.type === "service.start" && action.name === "mariadb");
  assert.equal(mariadb?.waitForLog, "port: 3306");
});

test("Coffer LuckPerms acceptance denies and grants every documented command family", async () => {
  const expected = [
    "copy", "flag", "gui", "help", "info", "lock", "paste", "persist",
    "policy", "quiet", "reload", "transfer", "trust", "unlock", "untrust",
  ];
  const scenario: Scenario | undefined = (await loadAllScenarios())
    .find(({ scenario }) => scenario.id === "coffer/permissions-luckperms")
    ?.scenario;
  assert.ok(scenario);

  for (const [stepId, decision] of [
    ["deny_command_families", "false"],
    ["grant_command_families", "true"],
  ] as const) {
    const step: ScenarioStep | undefined = scenario.steps.find((candidate) => candidate.id === stepId);
    assert.ok(step, `missing ${stepId}`);
    const configured: string[] = (step.actions ?? [])
      .filter((action) => action.type === "console.command" && typeof action.command === "string")
      .map((action) => /^lp user PermOwner permission set coffer\.command\.([a-z_]+) (?:true|false)$/.exec(String(action.command)))
      .filter((match): match is RegExpExecArray => match !== null && String(match.input).endsWith(` ${decision}`))
      .map((match) => match[1]!)
      .sort();
    const exercised: string[] = (step.actions ?? [])
      .filter((action) => action.type === "client.command"
        && action.client === "owner"
        && typeof action.command === "string")
      .map((action) => String(action.command).split(/\s+/, 3)[1])
      .filter((family): family is string => family !== undefined)
      .filter((family, index, families) => families.indexOf(family) === index)
      .sort();
    assert.deepEqual(configured, expected, `${stepId} permission decisions`);
    assert.deepEqual(exercised, expected, `${stepId} real-client commands`);
  }
});

test("composite action exposes the stable consumer contract", async () => {
  const action = parse(await readFile(join(repositoryRoot(), "action.yml"), "utf8")) as Record<string, unknown>;
  const inputs = action.inputs as Record<string, unknown>;
  const outputs = action.outputs as Record<string, unknown>;
  for (const input of ["scenario", "consumer-jar", "named-artifacts", "minecraft-version", "loader-version", "fabric-api-version"]) {
    assert.ok(input in inputs, `missing action input ${input}`);
  }
  for (const output of ["passed", "report", "html", "junit", "server-log", "artifact-directory"]) {
    assert.ok(output in outputs, `missing action output ${output}`);
  }
});

test("wait.until accepts exactly one known assertion", () => {
  const valid = {
    schemaVersion: 1,
    id: "schema/wait-until",
    title: "Wait until schema fixture",
    issues: [1],
    steps: [{
      id: "wait",
      name: "Wait",
      actions: [{
        type: "wait.until",
        timeoutMs: 500,
        intervalMs: 10,
        assertion: { type: "bridge.json", path: "/v1/health", expected: true },
      }],
    }],
  };
  assert.deepEqual(validateScenario(valid), []);
  const invalid: any = structuredClone(valid);
  invalid.steps[0]!.actions[0]!.assertion = { type: "server.stop" };
  assert.ok(validateScenario(invalid).some((failure) => failure.includes("known assertion")));
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
