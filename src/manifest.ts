import { readdir, readFile } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { HarnessError } from "./errors.js";
import { scenarioSchemaErrors } from "./schema.js";
import { SUPPORTED_SCHEMA_VERSION, type FabricPins, type Scenario } from "./types.js";

const ACTION_TYPES = new Set([
  "server.start",
  "server.stop",
  "server.restart",
  "client.connect",
  "client.disconnect",
  "client.reconnect",
  "client.chat",
  "client.command",
  "client.move",
  "client.look",
  "client.select_hotbar",
  "client.use_block",
  "client.place_block",
  "client.break_block",
  "client.attack",
  "client.respawn",
  "client.click_window",
  "console.command",
  "bridge.request",
  "wait.duration",
  "wait.ticks",
  "wait.until",
  "wait.event",
  "file.write",
  "file.delete",
  "snapshot.capture",
  "sqlite.query",
  "value.extract",
  "soak.run",
  "adapter.invoke",
  "http.request",
  "service.start",
  "service.exec",
  "service.stop",
  "process.exec",
]);

const ASSERTION_TYPES = new Set([
  "log.absent",
  "log.present",
  "log.rate",
  "client.event",
  "client.inventory",
  "client.state",
  "client.window",
  "bridge.json",
  "snapshot.equals",
  "metric.threshold",
  "performance.threshold",
  "file.exists",
  "file.json",
  "sqlite.query",
  "command.output",
  "adapter.assert",
  "value.json",
]);

export function repositoryRoot(): string {
  return fileURLToPath(new URL("../", import.meta.url));
}

export async function loadPins(path = join(repositoryRoot(), "config", "pins.yaml")): Promise<FabricPins> {
  const value = parse(await readFile(path, "utf8")) as Partial<FabricPins>;
  const failures: string[] = [];
  for (const key of ["minecraft", "loader", "fabricApi", "installer"] as const) {
    if (typeof value[key] !== "string" || value[key]?.length === 0) failures.push(`${key} must be a string`);
  }
  if (!Number.isInteger(value.java) || (value.java ?? 0) < 1) failures.push("java must be an integer");
  if (!Number.isInteger(value.protocol) || (value.protocol ?? 0) < 1) failures.push("protocol must be an integer");
  if (failures.length) throw new HarnessError("INVALID_PINS", failures.join("; "));
  return value as FabricPins;
}

export async function discoverScenarioFiles(directory = join(repositoryRoot(), "scenarios")): Promise<string[]> {
  const files: string[] = [];
  async function walk(current: string): Promise<void> {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if ([".yaml", ".yml", ".json"].includes(extname(entry.name).toLowerCase())) files.push(path);
    }
  }
  await walk(resolve(directory));
  return files.sort();
}

export async function loadScenario(path: string): Promise<Scenario> {
  const raw = await readFile(path, "utf8");
  const scenario = (extname(path).toLowerCase() === ".json" ? JSON.parse(raw) : parse(raw)) as unknown;
  const failures = validateScenario(scenario);
  if (failures.length) {
    throw new HarnessError("INVALID_SCENARIO", `${basename(path)}: ${failures.join("; ")}`, { path, failures });
  }
  return scenario as Scenario;
}

export async function loadAllScenarios(directory?: string): Promise<Array<{ path: string; scenario: Scenario }>> {
  return await Promise.all((await discoverScenarioFiles(directory)).map(async (path) => ({ path, scenario: await loadScenario(path) })));
}

export async function resolveScenario(reference: string): Promise<{ path: string; scenario: Scenario }> {
  const direct = resolve(reference);
  if ([".yaml", ".yml", ".json"].includes(extname(direct).toLowerCase())) {
    return { path: direct, scenario: await loadScenario(direct) };
  }
  const matches = (await loadAllScenarios()).filter(({ scenario }) => scenario.id === reference);
  if (matches.length === 0) throw new HarnessError("SCENARIO_NOT_FOUND", `Unknown scenario: ${reference}`);
  if (matches.length > 1) throw new HarnessError("DUPLICATE_SCENARIO", `Multiple scenarios have id ${reference}`);
  return matches[0]!;
}

export function validateScenario(value: unknown): string[] {
  const failures: string[] = scenarioSchemaErrors(value);
  if (!value || typeof value !== "object" || Array.isArray(value)) return ["scenario must be an object"];
  const scenario = value as Record<string, unknown>;
  if (scenario.schemaVersion !== SUPPORTED_SCHEMA_VERSION) failures.push(`schemaVersion must be ${SUPPORTED_SCHEMA_VERSION}`);
  for (const field of ["id", "title"] as const) {
    if (typeof scenario[field] !== "string" || scenario[field].length === 0) failures.push(`${field} must be a non-empty string`);
  }
  if (typeof scenario.id === "string" && !/^[a-z0-9][a-z0-9/_-]*$/.test(scenario.id)) {
    failures.push("id must contain only lowercase letters, digits, slash, underscore, and dash");
  }
  if (!Array.isArray(scenario.issues) || scenario.issues.length === 0 || scenario.issues.some((issue) => !Number.isInteger(issue))) {
    failures.push("issues must contain one or more integer issue numbers");
  }
  if (!Array.isArray(scenario.steps) || scenario.steps.length === 0) {
    failures.push("steps must contain at least one step");
    return failures;
  }
  const ids = new Set<string>();
  for (const [index, rawStep] of scenario.steps.entries()) {
    if (!rawStep || typeof rawStep !== "object" || Array.isArray(rawStep)) {
      failures.push(`steps[${index}] must be an object`);
      continue;
    }
    const step = rawStep as Record<string, unknown>;
    if (typeof step.id !== "string" || !/^[a-z0-9][a-z0-9_-]*$/.test(step.id)) failures.push(`steps[${index}].id is invalid`);
    else if (ids.has(step.id)) failures.push(`duplicate step id: ${step.id}`);
    else ids.add(step.id);
    if (typeof step.name !== "string" || step.name.length === 0) failures.push(`steps[${index}].name is required`);
    const actions = Array.isArray(step.actions) ? step.actions : [];
    const assertions = Array.isArray(step.assertions) ? step.assertions : [];
    if (actions.length === 0 && assertions.length === 0) failures.push(`steps[${index}] has no actions or assertions`);
    for (const [actionIndex, action] of actions.entries()) {
      if (!action || typeof action !== "object" || Array.isArray(action) || typeof (action as { type?: unknown }).type !== "string") {
        failures.push(`steps[${index}].actions[${actionIndex}] must have a type`);
      } else if (!ACTION_TYPES.has((action as { type: string }).type)) {
        failures.push(`steps[${index}].actions[${actionIndex}] has unknown type ${(action as { type: string }).type}`);
      } else if ((action as { type: string }).type === "wait.until") {
        const nested = (action as { assertion?: unknown }).assertion;
        if (!nested || typeof nested !== "object" || Array.isArray(nested)
          || typeof (nested as { type?: unknown }).type !== "string"
          || !ASSERTION_TYPES.has((nested as { type: string }).type)) {
          failures.push(`steps[${index}].actions[${actionIndex}].assertion must be one known assertion`);
        }
      }
    }
    for (const [assertionIndex, assertion] of assertions.entries()) {
      if (!assertion || typeof assertion !== "object" || Array.isArray(assertion) || typeof (assertion as { type?: unknown }).type !== "string") {
        failures.push(`steps[${index}].assertions[${assertionIndex}] must have a type`);
      } else if (!ASSERTION_TYPES.has((assertion as { type: string }).type)) {
        failures.push(`steps[${index}].assertions[${assertionIndex}] has unknown type ${(assertion as { type: string }).type}`);
      }
    }
  }
  return failures;
}

export const TRACKED_ISSUES = [
  ...Array.from({ length: 22 }, (_, index) => index + 1),
  24, 25, 26, 27, 28, 29,
  32, 33, 34, 36, 39, 42, 44, 45, 46,
];

export function issueCoverage(scenarios: Scenario[], expected = TRACKED_ISSUES) {
  const coverage = new Map<number, string[]>();
  for (const scenario of scenarios) {
    for (const issue of scenario.issues) coverage.set(issue, [...(coverage.get(issue) ?? []), scenario.id]);
  }
  return {
    coverage,
    missing: expected.filter((issue) => !coverage.has(issue)),
    duplicates: [...coverage.entries()].filter(([, ids]) => new Set(ids).size !== ids.length),
  };
}
