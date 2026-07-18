import { randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import { DatabaseSync } from "node:sqlite";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { prepareArtifacts, installArtifacts } from "./artifacts.js";
import { BridgeClient } from "./bridge-client.js";
import { ProtocolClient } from "./client.js";
import { errorMessage, HarnessError } from "./errors.js";
import { repositoryRoot } from "./manifest.js";
import { writeReport } from "./report.js";
import { MinecraftServer } from "./server.js";
import type {
  FabricPins,
  HarnessAction,
  HarnessAssertion,
  JsonValue,
  RunOptions,
  Scenario,
  ScenarioReport,
  ScenarioStep,
  StepResult,
} from "./types.js";
import { ensureDirectory, getFreePort, getJsonPath, interpolate, percentile, randomToken, withTimeout } from "./utils.js";

interface RunnerContext {
  scenario: Scenario;
  pins: FabricPins;
  runDirectory: string;
  artifactDirectory: string;
  server: MinecraftServer;
  bridge: BridgeClient;
  clients: Map<string, ProtocolClient>;
  values: Record<string, JsonValue>;
  snapshots: Map<string, JsonValue>;
  tickSamples: number[];
}

export async function runScenario(scenario: Scenario, basePins: FabricPins, options: RunOptions): Promise<ScenarioReport> {
  const pins: FabricPins = { ...basePins, ...scenario.pins };
  const started = Date.now();
  const runId = `${new Date().toISOString().replaceAll(/[:.]/g, "-")}-${scenario.id.replaceAll("/", "-")}-${randomUUID().slice(0, 8)}`;
  const output = await ensureDirectory(options.output ?? join(repositoryRoot(), ".ouro-harness", "runs", runId));
  const runDirectory = await ensureDirectory(join(output, "server"));
  const artifactDirectory = await ensureDirectory(join(output, "artifacts"));
  await writeFile(join(output, "resolved-scenario.json"), JSON.stringify(scenario, null, 2) + "\n", "utf8");

  if (options.dryRun) {
    const now = new Date().toISOString();
    const steps: StepResult[] = scenario.steps.map((step) => ({
      id: step.id,
      name: step.name,
      status: "skipped",
      startedAt: now,
      finishedAt: now,
      durationMs: 0,
      evidence: { reason: "dry-run" },
    }));
    const report: ScenarioReport = {
      schemaVersion: 1,
      runId,
      scenario: { id: scenario.id, title: scenario.title, issues: scenario.issues },
      pins,
      status: "passed",
      exitCode: 0,
      startedAt: new Date(started).toISOString(),
      finishedAt: now,
      durationMs: Date.now() - started,
      steps,
      findings: [],
      artifacts: {},
    };
    report.artifacts = await writeReport(report, output);
    if (!options.keepRunDirectory) await removeRunDirectory(output, runDirectory);
    return report;
  }

  const cacheDirectory = options.cache ?? join(repositoryRoot(), ".ouro-harness", "cache");
  const prepared = await prepareArtifacts(scenario, pins, options.artifacts, cacheDirectory);
  const installed = await installArtifacts(runDirectory, scenario, prepared);
  const serverPort = await getFreePort();
  const bridgePort = await getFreePort();
  const token = randomToken();
  const javaExecutable = process.env.OURO_HARNESS_JAVA ?? "java";
  const server = new MinecraftServer(runDirectory, javaExecutable, scenario.server ?? {}, {
    ...process.env,
    OURO_HARNESS_PORT: String(bridgePort),
    OURO_HARNESS_TOKEN: token,
    OURO_HARNESS_EVENTS: join(artifactDirectory, "bridge-events.ndjson"),
    OURO_HARNESS_VERBOSE: options.verbose ? "1" : "0",
  });
  await server.writeStandardFiles(serverPort);
  const clients = new Map(
    (scenario.clients ?? []).map((spec) => [spec.name, new ProtocolClient(spec, "127.0.0.1", serverPort, pins.minecraft)]),
  );
  const context: RunnerContext = {
    scenario,
    pins,
    runDirectory,
    artifactDirectory,
    server,
    bridge: new BridgeClient(bridgePort, token),
    clients,
    values: {
      "run.id": runId,
      "run.directory": runDirectory,
      "artifact.directory": artifactDirectory,
      "server.port": serverPort,
      "bridge.port": bridgePort,
      ...Object.fromEntries(Object.entries(installed).map(([name, path]) => [`artifact.${name}`, path])),
      ...scenario.variables,
    },
    snapshots: new Map(),
    tickSamples: [],
  };

  const results: StepResult[] = [];
  let originalError: unknown;
  try {
    for (const step of scenario.steps) {
      if (originalError && !step.always) {
        const now = new Date().toISOString();
        results.push({ id: step.id, name: step.name, status: "skipped", startedAt: now, finishedAt: now, durationMs: 0, evidence: {} });
        continue;
      }
      const result = await executeStep(context, step);
      results.push(result);
      if (result.status === "failed" && !originalError) originalError = new HarnessError("STEP_FAILED", result.error ?? step.name);
    }
    const allowed = (scenario.server?.allowedLogPatterns ?? []).map((pattern) => new RegExp(pattern));
    const unallowedFindings = server.monitor.findings.filter((finding) => !allowed.some((pattern) => pattern.test(finding.line)));
    if (unallowedFindings.length > 0 && !originalError) {
      originalError = new HarnessError("GLOBAL_LOG_FAILURE", `${unallowedFindings.length} unallowed error finding(s) in server log`);
    }
  } catch (error) {
    originalError ??= error;
  } finally {
    for (const client of clients.values()) {
      try { await client.disconnect("Harness complete"); } catch { /* not connected */ }
    }
    try {
      await server.stop();
    } catch (cleanupError) {
      if (!originalError) originalError = cleanupError;
      else context.values["cleanup.error"] = errorMessage(cleanupError);
    }
    await server.closeLog();
  }

  const clientEventPaths: Record<string, string> = {};
  for (const [name, client] of clients) {
    const path = join(artifactDirectory, `client-${name}.json`);
    await writeFile(path, JSON.stringify({ spec: client.spec, events: client.events }, null, 2) + "\n", "utf8");
    clientEventPaths[`client-${name}`] = path;
  }
  await copyIfExists(join(runDirectory, "logs", "latest.log"), join(artifactDirectory, "latest.log"));
  await copyIfExists(join(runDirectory, "logs", "debug.log"), join(artifactDirectory, "debug.log"));
  await copyIfExists(server.logPath, join(artifactDirectory, "harness-server.log"));
  await writeFile(join(artifactDirectory, "artifact-checksums.json"), JSON.stringify(prepared.checksums, null, 2) + "\n", "utf8");
  if (!options.keepRunDirectory) {
    try {
      await removeRunDirectory(output, runDirectory);
    } catch (cleanupError) {
      originalError ??= cleanupError;
    }
  }

  const finished = Date.now();
  const allowed = (scenario.server?.allowedLogPatterns ?? []).map((pattern) => new RegExp(pattern));
  const findings = server.monitor.findings.filter((finding) => !allowed.some((pattern) => pattern.test(finding.line)));
  const report: ScenarioReport = {
    schemaVersion: 1,
    runId,
    scenario: { id: scenario.id, title: scenario.title, issues: scenario.issues },
    pins,
    status: originalError ? "failed" : "passed",
    exitCode: originalError ? 1 : 0,
    startedAt: new Date(started).toISOString(),
    finishedAt: new Date(finished).toISOString(),
    durationMs: finished - started,
    steps: results,
    findings,
    ...(context.tickSamples.length
      ? { performance: {
          samples: context.tickSamples.length,
          mspt: {
            p50: percentile(context.tickSamples, 0.5),
            p95: percentile(context.tickSamples, 0.95),
            p99: percentile(context.tickSamples, 0.99),
            max: Math.max(...context.tickSamples),
          },
          errorLines: findings.length,
          errorsPerMinute: findings.length / Math.max(1 / 60, (finished - started) / 60_000),
        } }
      : {}),
    artifacts: {
      directory: artifactDirectory,
      "server-log": join(artifactDirectory, "harness-server.log"),
      ...clientEventPaths,
    },
    ...(originalError
      ? { failureSummary: `${errorMessage(originalError)}\n\nServer log tail:\n${server.monitor.tail(80).join("\n")}` }
      : {}),
  };
  Object.assign(report.artifacts, await writeReport(report, output));
  return report;
}

async function executeStep(context: RunnerContext, step: ScenarioStep): Promise<StepResult> {
  const started = Date.now();
  const evidence: Record<string, JsonValue> = {};
  try {
    const task = async () => {
      for (const action of step.actions ?? []) await executeAction(context, interpolate(action as JsonValue, context.values) as HarnessAction, evidence);
      for (const assertion of step.assertions ?? []) await executeAssertion(context, interpolate(assertion as JsonValue, context.values) as HarnessAssertion, evidence);
    };
    await withTimeout(task(), (step.timeoutSeconds ?? context.scenario.server?.commandTimeoutSeconds ?? 30) * 1000, `step ${step.id}`);
    const finished = Date.now();
    return {
      id: step.id,
      name: step.name,
      status: "passed",
      startedAt: new Date(started).toISOString(),
      finishedAt: new Date(finished).toISOString(),
      durationMs: finished - started,
      evidence,
    };
  } catch (error) {
    const finished = Date.now();
    return {
      id: step.id,
      name: step.name,
      status: "failed",
      startedAt: new Date(started).toISOString(),
      finishedAt: new Date(finished).toISOString(),
      durationMs: finished - started,
      error: errorMessage(error),
      evidence,
    };
  }
}

async function executeAction(context: RunnerContext, action: HarnessAction, evidence: Record<string, JsonValue>): Promise<void> {
  const string = (name: string, fallback?: string) => {
    const value = action[name];
    if (typeof value === "string") return value;
    if (fallback !== undefined) return fallback;
    throw new HarnessError("INVALID_ACTION", `${action.type}.${name} must be a string`);
  };
  const number = (name: string, fallback?: number) => {
    const value = action[name];
    if (typeof value === "number") return value;
    if (fallback !== undefined) return fallback;
    throw new HarnessError("INVALID_ACTION", `${action.type}.${name} must be a number`);
  };
  const client = () => {
    const name = string("client");
    const value = context.clients.get(name);
    if (!value) throw new HarnessError("UNKNOWN_CLIENT", `Unknown client ${name}`);
    return value;
  };

  switch (action.type) {
    case "server.start":
      await context.server.start();
      await context.bridge.waitUntilReady();
      for (const value of context.clients.values()) if (value.spec.connectOnStart !== false) await connectClient(context, value);
      return;
    case "server.stop":
      await context.server.stop();
      return;
    case "server.restart": {
      const reconnect = action.reconnect !== false;
      await context.server.stop();
      await context.server.start();
      await context.bridge.waitUntilReady();
      if (reconnect) for (const value of context.clients.values()) await connectClient(context, value, true);
      return;
    }
    case "client.connect": await connectClient(context, client(), false, number("timeoutMs", 30_000)); return;
    case "client.disconnect": await client().disconnect(string("reason", "Scenario step")); return;
    case "client.reconnect": await connectClient(context, client(), true, number("timeoutMs", 30_000)); return;
    case "client.chat": await client().chat(string("message")); return;
    case "client.command": await client().chat(`/${string("command").replace(/^\//, "")}`); return;
    case "client.look": await client().look(number("yaw"), number("pitch")); return;
    case "client.move": await client().move(string("control") as never, number("durationMs", 500)); return;
    case "client.use_block": await client().useBlock(number("x"), number("y"), number("z")); return;
    case "client.break_block": await client().breakBlock(number("x"), number("y"), number("z")); return;
    case "client.place_block": {
      const face = action.face as { x?: number; y?: number; z?: number } | undefined;
      await client().placeBlock(number("x"), number("y"), number("z"), { x: face?.x ?? 0, y: face?.y ?? 1, z: face?.z ?? 0 });
      return;
    }
    case "client.attack": await client().attack(string("target")); return;
    case "client.respawn": await client().respawn(); return;
    case "client.click_window": await client().clickWindow(number("slot"), number("button", 0), number("mode", 0)); return;
    case "console.command": {
      const command = string("command");
      const before = context.server.monitor.lines.length;
      context.server.command(command);
      if (typeof action.waitFor === "string") await waitForLog(context, new RegExp(action.waitFor), number("timeoutMs", 10_000), before);
      const output = context.server.monitor.lines.slice(before);
      if (typeof action.as === "string") context.values[action.as] = output;
      evidence[`command:${command}`] = output;
      return;
    }
    case "bridge.request": {
      const result = await context.bridge.request(string("method", "GET"), string("path"), action.body, number("timeoutMs", 15_000));
      if (typeof action.as === "string") context.values[action.as] = result;
      evidence[`bridge:${string("path")}`] = result;
      return;
    }
    case "wait.duration": await new Promise((resolveWait) => setTimeout(resolveWait, number("milliseconds", number("seconds", 0) * 1000))); return;
    case "wait.ticks": await context.bridge.request("POST", "/v1/ticks/wait", { ticks: number("ticks") }); return;
    case "wait.event": {
      const target = client();
      const type = string("event");
      const since = typeof action.since === "number" ? action.since : 0;
      const count = number("count", 1);
      const started = Date.now();
      const timeout = number("timeoutMs", 10_000);
      while (target.matchingEvents(type, since).length < count) {
        if (Date.now() - started > timeout) throw new HarnessError("EVENT_TIMEOUT", `Waiting for ${target.spec.name}:${type}`);
        await new Promise((resolveWait) => setTimeout(resolveWait, 50));
      }
      return;
    }
    case "file.write": {
      const target = confinedPath(context.runDirectory, string("path"));
      await mkdir(dirname(target), { recursive: true });
      const content = typeof action.content === "string" ? action.content : JSON.stringify(action.content, null, 2) + "\n";
      await writeFile(target, content, "utf8");
      evidence[`file:${relative(context.runDirectory, target)}`] = target;
      return;
    }
    case "snapshot.capture": {
      const name = string("name");
      let value: JsonValue;
      if (typeof action.client === "string") value = await context.clients.get(action.client)?.state() ?? null;
      else if (typeof action.path === "string") value = await context.bridge.request(string("method", "GET"), action.path, action.body);
      else if (typeof action.value === "string") value = context.values[action.value] ?? null;
      else throw new HarnessError("INVALID_ACTION", "snapshot.capture needs client, path, or value");
      context.snapshots.set(name, value);
      evidence[`snapshot:${name}`] = value;
      return;
    }
    case "sqlite.query": {
      const database = new DatabaseSync(confinedPath(context.runDirectory, string("path")), { readOnly: true });
      try {
        const statement = database.prepare(string("sql"));
        const parameters = Array.isArray(action.parameters) ? action.parameters : [];
        const rows = statement.all(...parameters as never[]) as unknown as JsonValue;
        if (typeof action.as === "string") context.values[action.as] = rows;
        evidence[`sqlite:${string("path")}`] = rows;
      } finally {
        database.close();
      }
      return;
    }
    case "soak.run": {
      const durationMs = number("durationSeconds", 60) * 1000;
      const intervalMs = number("intervalMs", 1000);
      const started = Date.now();
      while (Date.now() - started < durationMs) {
        if (Array.isArray(action.behavior)) {
          for (const nested of action.behavior) await executeAction(context, nested as HarnessAction, evidence);
        }
        const metrics = await context.bridge.request("GET", "/v1/metrics");
        const mspt = getJsonPath(metrics, "mspt.current");
        if (typeof mspt === "number") context.tickSamples.push(mspt);
        await new Promise((resolveWait) => setTimeout(resolveWait, intervalMs));
      }
      return;
    }
    case "adapter.invoke": {
      if (Array.isArray(action.actions)) {
        for (const nested of action.actions) await executeAction(context, nested as HarnessAction, evidence);
      } else {
        const result = await context.bridge.request("POST", `/v1/adapters/${encodeURIComponent(string("adapter"))}/${encodeURIComponent(string("operation"))}`, action.args ?? {});
        if (typeof action.as === "string") context.values[action.as] = result;
      }
      return;
    }
    default: throw new HarnessError("UNSUPPORTED_ACTION", `Unsupported action ${action.type}`);
  }
}

async function executeAssertion(context: RunnerContext, assertion: HarnessAssertion, evidence: Record<string, JsonValue>): Promise<void> {
  const string = (name: string, fallback?: string) => {
    const value = assertion[name];
    if (typeof value === "string") return value;
    if (fallback !== undefined) return fallback;
    throw new HarnessError("INVALID_ASSERTION", `${assertion.type}.${name} must be a string`);
  };
  switch (assertion.type) {
    case "log.absent": {
      const pattern = new RegExp(string("pattern"), string("flags", "i"));
      const matches = context.server.monitor.lines.filter((line) => pattern.test(line));
      if (matches.length) throw new HarnessError("LOG_ASSERTION_FAILED", `Unexpected log pattern ${pattern}`, matches.slice(-20));
      return;
    }
    case "log.present": {
      const pattern = new RegExp(string("pattern"), string("flags", "i"));
      const matches = context.server.monitor.lines.filter((line) => pattern.test(line));
      assertComparison(matches.length, assertion.operator ?? "gte", assertion.count ?? 1, `${pattern} log count`);
      evidence[`log:${pattern}`] = matches.slice(-20);
      return;
    }
    case "log.rate": {
      const pattern = new RegExp(string("pattern", "\\bERROR\\b"), string("flags", "i"));
      const count = context.server.monitor.lines.filter((line) => pattern.test(line)).length;
      const minutes = Math.max(1 / 60, Number(assertion.windowSeconds ?? 60) / 60);
      assertComparison(count / minutes, "lte", assertion.maxPerMinute ?? 0, "log rate");
      return;
    }
    case "client.event": {
      const target = context.clients.get(string("client"));
      if (!target) throw new HarnessError("UNKNOWN_CLIENT", string("client"));
      let events = target.matchingEvents(string("event"), Number(assertion.since ?? 0));
      if (typeof assertion.pattern === "string") {
        const pattern = new RegExp(assertion.pattern);
        events = events.filter((event) => pattern.test(JSON.stringify(event.data)));
      }
      assertComparison(events.length, assertion.operator ?? "gte", assertion.count ?? 1, "client event count");
      evidence[`events:${target.spec.name}:${string("event")}`] = JSON.parse(JSON.stringify(events)) as JsonValue;
      return;
    }
    case "client.inventory":
    case "client.state":
    case "client.window": {
      const target = context.clients.get(string("client"));
      if (!target) throw new HarnessError("UNKNOWN_CLIENT", string("client"));
      const state = await target.state();
      const defaultPath = assertion.type === "client.inventory" ? "inventory" : assertion.type === "client.window" ? "window" : "";
      const actual = getJsonPath(state, string("path", defaultPath));
      assertComparison(actual, assertion.operator ?? "equals", assertion.expected, `${assertion.type} ${string("path", defaultPath)}`);
      evidence[assertion.type] = actual ?? null;
      return;
    }
    case "bridge.json": {
      const result = await context.bridge.request(string("method", "GET"), string("path"), assertion.body);
      const actual = getJsonPath(result, string("jsonPath", "$"));
      assertComparison(actual, assertion.operator ?? "equals", assertion.expected, `bridge ${string("path")}`);
      evidence[`assert:${string("path")}`] = result;
      return;
    }
    case "snapshot.equals": {
      const left = context.snapshots.get(string("left"));
      const right = context.snapshots.get(string("right"));
      const path = typeof assertion.path === "string" ? assertion.path : "$";
      assertComparison(getJsonPath(left ?? null, path), assertion.operator ?? "equals", getJsonPath(right ?? null, path), `snapshots ${string("left")}/${string("right")}`);
      return;
    }
    case "metric.threshold": {
      const metrics = await context.bridge.request("GET", "/v1/metrics");
      const actual = getJsonPath(metrics, string("path"));
      assertComparison(actual, assertion.operator ?? "lte", assertion.expected, `metric ${string("path")}`);
      evidence.metrics = metrics;
      return;
    }
    case "file.exists": {
      const target = assertion.scope === "repository"
        ? confinedPath(repositoryRoot(), string("path"))
        : confinedPath(context.runDirectory, string("path"));
      await readFile(target);
      return;
    }
    case "file.json": {
      const target = confinedPath(context.runDirectory, string("path"));
      const value = JSON.parse(await readFile(target, "utf8")) as JsonValue;
      const actual = getJsonPath(value, string("jsonPath", "$"));
      assertComparison(actual, assertion.operator ?? "equals", assertion.expected, `file ${relative(context.runDirectory, target)}`);
      return;
    }
    case "sqlite.query": {
      const database = new DatabaseSync(confinedPath(context.runDirectory, string("path")), { readOnly: true });
      try {
        const statement = database.prepare(string("sql"));
        const parameters = Array.isArray(assertion.parameters) ? assertion.parameters : [];
        const rows = statement.all(...parameters as never[]) as unknown as JsonValue;
        const actual = getJsonPath(rows, string("jsonPath", "$"));
        assertComparison(actual, assertion.operator ?? "equals", assertion.expected, `sqlite ${string("path")}`);
        evidence[`sqlite:${string("path")}`] = rows;
      } finally {
        database.close();
      }
      return;
    }
    case "command.output": {
      const value = context.values[string("value")];
      assertComparison(value, assertion.operator ?? "contains", assertion.expected, `command output ${string("value")}`);
      return;
    }
    case "adapter.assert": {
      const result = await context.bridge.request("POST", `/v1/adapters/${encodeURIComponent(string("adapter"))}/${encodeURIComponent(string("operation"))}`, assertion.args ?? {});
      const actual = getJsonPath(result, string("jsonPath", "$"));
      assertComparison(actual, assertion.operator ?? "equals", assertion.expected, `${string("adapter")}.${string("operation")}`);
      return;
    }
    default: throw new HarnessError("UNSUPPORTED_ASSERTION", `Unsupported assertion ${assertion.type}`);
  }
}

function assertComparison(actual: unknown, operator: JsonValue, expected: unknown, label: string): void {
  let passed = false;
  switch (operator) {
    case "equals": passed = isDeepStrictEqual(actual, expected); break;
    case "not_equals": passed = !isDeepStrictEqual(actual, expected); break;
    case "contains": passed = typeof actual === "string"
      ? actual.includes(String(expected))
      : Array.isArray(actual)
        ? actual.some((item) => isDeepStrictEqual(item, expected))
        : JSON.stringify(actual).includes(String(expected)); break;
    case "matches": passed = new RegExp(String(expected)).test(String(actual)); break;
    case "gte": passed = Number(actual) >= Number(expected); break;
    case "gt": passed = Number(actual) > Number(expected); break;
    case "lte": passed = Number(actual) <= Number(expected); break;
    case "lt": passed = Number(actual) < Number(expected); break;
    case "exists": passed = actual !== undefined && actual !== null; break;
    case "absent": passed = actual === undefined || actual === null; break;
    default: throw new HarnessError("INVALID_OPERATOR", `Unknown comparison operator ${String(operator)}`);
  }
  if (!passed) throw new HarnessError("ASSERTION_FAILED", `${label}: expected ${String(operator)} ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function confinedPath(root: string, path: string): string {
  const target = resolve(root, path);
  const relation = relative(resolve(root), target);
  if (relation === ".." || relation.startsWith(`..${sep}`) || isAbsolute(relation)) {
    throw new HarnessError("PATH_ESCAPE", `Path escapes run directory: ${path}`);
  }
  return target;
}

async function waitForLog(context: RunnerContext, pattern: RegExp, timeoutMs: number, since: number): Promise<void> {
  const started = Date.now();
  while (!context.server.monitor.lines.slice(since).some((line) => pattern.test(line))) {
    if (Date.now() - started > timeoutMs) throw new HarnessError("LOG_TIMEOUT", `Waiting for log ${pattern}`);
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  }
}

async function copyIfExists(source: string, destination: string): Promise<void> {
  try {
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(source, destination);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

async function connectClient(context: RunnerContext, client: ProtocolClient, reconnect = false, timeoutMs = 30_000): Promise<void> {
  if (reconnect) await client.reconnect(timeoutMs);
  else await client.connect(timeoutMs);
  if (client.spec.gameMode) {
    await context.bridge.request("POST", "/v1/command", {
      command: `gamemode ${client.spec.gameMode} ${client.spec.username}`,
    });
  }
}

async function removeRunDirectory(output: string, runDirectory: string): Promise<void> {
  const outputPath = resolve(output);
  const runPath = resolve(runDirectory);
  if (relative(outputPath, runPath) !== "server") {
    throw new HarnessError("UNSAFE_CLEANUP_PATH", `Refusing to remove unexpected run directory: ${runPath}`);
  }
  await rm(runPath, { recursive: true, force: true });
}
