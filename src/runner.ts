import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { copyFile, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
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
import { elapsedTimer, ensureDirectory, getFreePort, getJsonPath, interpolate, percentile, randomToken, withTimeout } from "./utils.js";

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
  services: Map<string, { container: string }>;
  serviceArtifacts: Record<string, string>;
}

export async function runScenario(scenario: Scenario, basePins: FabricPins, options: RunOptions): Promise<ScenarioReport> {
  const pins: FabricPins = { ...basePins, ...scenario.pins };
  const started = Date.now();
  const elapsed = elapsedTimer();
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
      durationMs: elapsed(),
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
  const allocatedPorts = new Set<number>();
  const allocatePort = async (): Promise<number> => {
    for (let attempt = 0; attempt < 20; attempt++) {
      const port = await getFreePort();
      if (!allocatedPorts.has(port)) {
        allocatedPorts.add(port);
        return port;
      }
    }
    throw new HarnessError("PORT_ALLOCATION_FAILED", "Could not allocate a unique loopback port");
  };
  const serverPort = await allocatePort();
  const bridgePort = await allocatePort();
  const namedPorts: Record<string, number> = {};
  for (const name of scenario.ports ?? []) namedPorts[name] = await allocatePort();
  const token = randomToken();
  const javaExecutable = process.env[`OURO_HARNESS_JAVA_${pins.java}`]
    ?? process.env.OURO_HARNESS_JAVA
    ?? "java";
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
      "platform.gradleWrapper": process.platform === "win32" ? "gradlew.bat" : "./gradlew",
      ...Object.fromEntries(Object.entries(namedPorts).map(([name, port]) => [`port.${name}`, port])),
      ...Object.fromEntries(Object.entries(installed).map(([name, path]) => [`artifact.${name}`, path])),
      ...scenario.variables,
    },
    snapshots: new Map(),
    tickSamples: [],
    services: new Map(),
    serviceArtifacts: {},
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
    try {
      await cleanupServices(context);
    } catch (cleanupError) {
      if (!originalError) originalError = cleanupError;
      else context.values["service.cleanup.error"] = errorMessage(cleanupError);
    } finally {
      await server.closeLog();
    }
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
  const durationMs = elapsed();
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
    durationMs,
    steps: results,
    findings,
    ...(context.tickSamples.length
      ? { performance: {
          samples: context.tickSamples.length,
          ...samplePerformance(context.tickSamples),
          errorLines: findings.length,
          errorsPerMinute: findings.length / Math.max(1 / 60, durationMs / 60_000),
        } }
      : {}),
    artifacts: {
      directory: artifactDirectory,
      "server-log": join(artifactDirectory, "harness-server.log"),
      ...clientEventPaths,
      ...context.serviceArtifacts,
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
  const elapsed = elapsedTimer();
  const evidence: Record<string, JsonValue> = {};
  try {
    const task = async () => {
      for (const action of step.actions ?? []) await executeAction(context, interpolate(action as JsonValue, context.values) as HarnessAction, evidence);
      for (const assertion of step.assertions ?? []) await executeAssertion(context, interpolate(assertion as JsonValue, context.values) as HarnessAssertion, evidence);
    };
    const hasLifecycleStart = (step.actions ?? []).some((action) =>
      action.type === "server.start" || action.type === "server.restart");
    const defaultTimeoutSeconds = hasLifecycleStart
      ? (context.scenario.server?.startupTimeoutSeconds ?? 180) + 30
      : context.scenario.server?.commandTimeoutSeconds ?? 30;
    await withTimeout(task(), (step.timeoutSeconds ?? defaultTimeoutSeconds) * 1000, `step ${step.id}`);
    const finished = Date.now();
    return {
      id: step.id,
      name: step.name,
      status: "passed",
      startedAt: new Date(started).toISOString(),
      finishedAt: new Date(finished).toISOString(),
      durationMs: elapsed(),
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
      durationMs: elapsed(),
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
      if (context.scenario.server?.controlBridge !== false) await context.bridge.waitUntilReady();
      for (const value of context.clients.values()) if (value.spec.connectOnStart !== false) await connectClient(context, value);
      return;
    case "server.stop":
      for (const value of context.clients.values()) await value.disconnect("Harness server stop");
      await context.server.stop();
      return;
    case "server.restart": {
      const reconnect = action.reconnect !== false;
      for (const value of context.clients.values()) await value.disconnect("Harness server restart");
      await context.server.stop();
      await context.server.start();
      if (context.scenario.server?.controlBridge !== false) await context.bridge.waitUntilReady();
      if (reconnect) for (const value of context.clients.values()) await connectClient(context, value, true);
      return;
    }
    case "client.connect": {
      try {
        await connectClient(context, client(), false, number("timeoutMs", 30_000));
      } catch (error) {
        if (action.allowFailure !== true) throw error;
        const failure = errorMessage(error);
        if (typeof action.as === "string") context.values[action.as] = failure;
        evidence[`client:${string("client")}:connect-failure`] = failure;
      }
      return;
    }
    case "client.disconnect": await client().disconnect(string("reason", "Scenario step")); return;
    case "client.reconnect": {
      try {
        await connectClient(context, client(), true, number("timeoutMs", 30_000));
      } catch (error) {
        if (action.allowFailure !== true) throw error;
        const failure = errorMessage(error);
        if (typeof action.as === "string") context.values[action.as] = failure;
        evidence[`client:${string("client")}:reconnect-failure`] = failure;
      }
      return;
    }
    case "client.chat": await client().chat(string("message")); return;
    case "client.command": await client().chat(`/${string("command").replace(/^\//, "")}`); return;
    case "client.look": await client().look(number("yaw"), number("pitch")); return;
    case "client.select_hotbar": await client().selectHotbar(number("slot")); return;
    case "client.move": await client().move(string("control") as never, number("durationMs", 500)); return;
    case "client.use_block": {
      const target = client();
      const pos = await clientBlockPosition(context, action, target);
      await target.useBlock(pos.x, pos.y, pos.z);
      return;
    }
    case "client.break_block": {
      const target = client();
      const pos = await clientBlockPosition(context, action, target);
      await target.breakBlock(pos.x, pos.y, pos.z);
      return;
    }
    case "client.place_block": {
      const face = action.face as { x?: number; y?: number; z?: number } | undefined;
      const target = client();
      const pos = await clientBlockPosition(context, action, target);
      const normalizedFace = { x: face?.x ?? 0, y: face?.y ?? 1, z: face?.z ?? 0 };
      const placed = {
        x: pos.x + normalizedFace.x,
        y: pos.y + normalizedFace.y,
        z: pos.z + normalizedFace.z,
      };
      const state = await target.state();
      const dimension = String(getJsonPath(state, "dimension"));
      const path = `/v1/world/block?dimension=${encodeURIComponent(dimension)}&x=${placed.x}&y=${placed.y}&z=${placed.z}`;
      const before = await context.bridge.request("GET", path) as Record<string, JsonValue>;
      let observed = before;
      const expectChange = action.expectChange !== false;
      const maximumAttempts = expectChange ? 3 : 1;
      for (let attempt = 1; attempt <= maximumAttempts; attempt++) {
        await target.placeBlock(pos.x, pos.y, pos.z, normalizedFace);
        const started = Date.now();
        while (Date.now() - started < 2_000) {
          await new Promise((resolveWait) => setTimeout(resolveWait, 100));
          observed = await context.bridge.request("GET", path) as Record<string, JsonValue>;
          if (observed.state !== before.state) {
            if (!expectChange) {
              throw new HarnessError(
                "UNEXPECTED_BLOCK_PLACEMENT",
                `${string("client")} placement at ${placed.x},${placed.y},${placed.z} unexpectedly changed state to ${String(observed.state)}`,
              );
            }
            evidence[`placement:${string("client")}`] = { attempts: attempt, before, after: observed };
            return;
          }
        }
      }
      if (!expectChange) {
        evidence[`placement-refused:${string("client")}`] = { attempts: maximumAttempts, before, after: observed };
        return;
      }
      throw new HarnessError(
        "BLOCK_PLACEMENT_TIMEOUT",
        `${string("client")} placement at ${placed.x},${placed.y},${placed.z} was not acknowledged; state remained ${String(observed.state)}`,
      );
    }
    case "client.attack": await client().attack(string("target")); return;
    case "client.respawn": await client().respawn(); return;
    case "client.click_window": await client().clickWindow(number("slot"), number("button", 0), number("mode", 0)); return;
    case "console.command": {
      const command = string("command");
      const before = context.server.monitor.lines.length;
      context.server.command(command);
      if (typeof action.waitFor === "string") {
        await waitForLog(context, new RegExp(action.waitFor), number("timeoutMs", 10_000), before);
      } else {
        await context.bridge.request("POST", "/v1/ticks/wait", { ticks: 1 });
      }
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
    case "wait.until": {
      const nested = action.assertion;
      if (!nested || typeof nested !== "object" || Array.isArray(nested) || typeof nested.type !== "string") {
        throw new HarnessError("INVALID_ACTION", "wait.until.assertion must be an assertion object");
      }
      const attempts = await waitUntilAssertion(
        async () => await executeAssertion(context, nested as HarnessAssertion, evidence),
        number("timeoutMs", 10_000),
        number("intervalMs", 100),
      );
      evidence["wait.until"] = { attempts, assertion: nested.type };
      return;
    }
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
    case "file.delete": {
      const target = await deleteConfinedFile(context.runDirectory, string("path"));
      evidence[`deleted:${relative(context.runDirectory, target)}`] = true;
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
    case "value.extract": {
      const sourceName = string("value");
      const outputName = string("as");
      const extracted = extractValue(context.values[sourceName], string("jsonPath", "$"));
      context.values[outputName] = extracted;
      evidence[`value.extract:${outputName}`] = extracted;
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
        try {
          const result = await context.bridge.request("POST", `/v1/adapters/${encodeURIComponent(string("adapter"))}/${encodeURIComponent(string("operation"))}`, action.args ?? {});
          if (typeof action.as === "string") context.values[action.as] = result;
        } catch (error) {
          if (action.allowFailure !== true) throw error;
          const failure = errorMessage(error);
          if (typeof action.as === "string") context.values[action.as] = failure;
          evidence[`adapter:${string("adapter")}:${string("operation")}:failure`] = failure;
        }
      }
      return;
    }
    case "http.request": {
      const url = string("url");
      const method = string("method", "GET");
      const rawHeaders = action.headers && typeof action.headers === "object" && !Array.isArray(action.headers)
        ? action.headers as Record<string, JsonValue>
        : {};
      const headers = Object.fromEntries(
        Object.entries(rawHeaders).map(([name, value]) => [name, String(value)]),
      );
      let body: string | undefined;
      if (typeof action.body === "string") body = action.body;
      else if (action.body !== undefined) {
        body = JSON.stringify(action.body);
        if (!Object.keys(headers).some((name) => name.toLowerCase() === "content-type")) {
          headers["content-type"] = "application/json";
        }
      }
      const response = await fetch(url, {
        method,
        headers,
        ...(body === undefined ? {} : { body }),
        signal: AbortSignal.timeout(number("timeoutMs", 15_000)),
      });
      const responseText = await response.text();
      let parsedBody: JsonValue = responseText;
      if (responseText && response.headers.get("content-type")?.includes("json")) {
        try { parsedBody = JSON.parse(responseText) as JsonValue; } catch { /* retain text for evidence */ }
      }
      const result: JsonValue = {
        status: response.status,
        ok: response.ok,
        headers: Object.fromEntries(response.headers.entries()),
        body: parsedBody,
      };
      if (!response.ok && action.allowFailure !== true) {
        throw new HarnessError("HTTP_REQUEST_FAILED", `${method} ${url} returned ${response.status}`, result);
      }
      if (typeof action.as === "string") context.values[action.as] = result;
      evidence[`http:${method}:${url}`] = result;
      return;
    }
    case "service.start": {
      const name = string("name");
      if (context.services.has(name)) throw new HarnessError("SERVICE_ALREADY_RUNNING", `Service ${name} is already running`);
      const runId = String(context.values["run.id"] ?? "run").replaceAll(/[^a-zA-Z0-9_.-]/g, "-");
      const container = `ouro-harness-${runId}-${name}`.slice(0, 120);
      const args = ["run", "--detach", "--name", container];
      const environment = action.environment && typeof action.environment === "object" && !Array.isArray(action.environment)
        ? action.environment as Record<string, JsonValue>
        : {};
      for (const [key, value] of Object.entries(environment)) args.push("--env", `${key}=${String(value)}`);
      const ports = action.ports && typeof action.ports === "object" && !Array.isArray(action.ports)
        ? action.ports as Record<string, JsonValue>
        : {};
      for (const [containerPort, hostPort] of Object.entries(ports)) {
        args.push("--publish", `127.0.0.1:${String(hostPort)}:${containerPort}`);
      }
      if (Array.isArray(action.options)) args.push(...action.options.map(String));
      args.push(string("image"));
      if (Array.isArray(action.command)) args.push(...action.command.map(String));
      const output = await runExternal("docker", args, number("timeoutMs", 120_000));
      context.services.set(name, { container });
      evidence[`service:${name}:start`] = { container, output: output.trim() };
      if (typeof action.waitForLog === "string") {
        const pattern = new RegExp(action.waitForLog, typeof action.flags === "string" ? action.flags : "i");
        const timeoutMs = number("waitTimeoutMs", 90_000);
        const started = Date.now();
        while (true) {
          const logs = await runExternal("docker", ["logs", container], 15_000).catch(() => "");
          if (pattern.test(logs)) break;
          if (Date.now() - started > timeoutMs) {
            throw new HarnessError("SERVICE_READINESS_TIMEOUT", `Service ${name} did not emit ${pattern}`, logs.slice(-8_000));
          }
          await new Promise((resolveWait) => setTimeout(resolveWait, 500));
        }
      }
      return;
    }
    case "service.exec": {
      const name = string("name");
      const service = context.services.get(name);
      if (!service) throw new HarnessError("UNKNOWN_SERVICE", `Service ${name} is not running`);
      if (!Array.isArray(action.command) || action.command.length === 0) {
        throw new HarnessError("INVALID_ACTION", "service.exec.command must contain one or more arguments");
      }
      const output = await runExternal(
        "docker",
        ["exec", service.container, ...action.command.map(String)],
        number("timeoutMs", 60_000),
      );
      if (typeof action.as === "string") context.values[action.as] = output;
      evidence[`service:${name}:exec`] = output;
      return;
    }
    case "service.stop": {
      const name = string("name");
      await cleanupService(context, name);
      return;
    }
    case "process.exec": {
      if (!Array.isArray(action.command) || action.command.length === 0 || action.command.some((part) => typeof part !== "string")) {
        throw new HarnessError("INVALID_ACTION", "process.exec.command must be a non-empty string array");
      }
      const [command, ...args] = action.command as string[];
      const batch = process.platform === "win32" && /\.(?:bat|cmd)$/i.test(command!);
      const executable = batch ? (process.env.ComSpec ?? "cmd.exe") : command!;
      const executableArgs = batch ? ["/d", "/s", "/c", command!, ...args] : args;
      const cwd = resolve(repositoryRoot(), string("cwd", "."));
      const javaMajor = number("java", context.pins.java);
      const javaExecutable = process.env[`OURO_HARNESS_JAVA_${javaMajor}`];
      const javaHome = javaExecutable ? dirname(dirname(javaExecutable)) : process.env.JAVA_HOME;
      const rawEnvironment = action.environment && typeof action.environment === "object" && !Array.isArray(action.environment)
        ? action.environment as Record<string, JsonValue>
        : {};
      const environment = Object.fromEntries(Object.entries(rawEnvironment).map(([name, value]) => [name, String(value)]));
      const output = await new Promise<string>((resolveCommand, rejectCommand) => {
        execFile(executable, executableArgs, {
          cwd,
          encoding: "utf8",
          timeout: number("timeoutMs", 600_000),
          windowsHide: true,
          maxBuffer: 32 * 1024 * 1024,
          env: { ...process.env, ...(javaHome ? { JAVA_HOME: javaHome } : {}), ...environment },
        }, (error, stdout, stderr) => {
          const combined = `${stdout}${stderr}`;
          if (error) {
            rejectCommand(new HarnessError(
              "EXTERNAL_COMMAND_FAILED",
              `${command} ${args.join(" ")} failed: ${(combined || error.message).trim()}`,
            ));
          } else resolveCommand(combined);
        });
      });
      if (typeof action.as === "string") context.values[action.as] = output;
      evidence[`process:${command}`] = output;
      if (typeof action.artifactName === "string") {
        const path = confinedPath(context.artifactDirectory, action.artifactName);
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, output, "utf8");
        context.serviceArtifacts[`process-${action.artifactName}`] = path;
      }
      return;
    }
    default: throw new HarnessError("UNSUPPORTED_ACTION", `Unsupported action ${action.type}`);
  }
}

export async function deleteConfinedFile(root: string, configuredPath: string): Promise<string> {
  const target = confinedPath(root, configuredPath);
  const canonicalRoot = await realpath(root);
  const canonicalTarget = await realpath(target);
  const canonicalRelation = relative(canonicalRoot, canonicalTarget);
  if (canonicalRelation === ".." || canonicalRelation.startsWith(`..${sep}`) || isAbsolute(canonicalRelation)) {
    throw new HarnessError("PATH_ESCAPE", `Path escapes run directory through a symbolic link: ${configuredPath}`);
  }
  await rm(target);
  return target;
}

export async function waitUntilAssertion(
  assertion: () => Promise<void>,
  timeoutMs = 10_000,
  intervalMs = 100,
): Promise<number> {
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
    throw new HarnessError("INVALID_ACTION", "wait.until.timeoutMs must be a non-negative number");
  }
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
    throw new HarnessError("INVALID_ACTION", "wait.until.intervalMs must be a positive number");
  }
  const started = Date.now();
  let attempts = 0;
  while (true) {
    attempts++;
    try {
      await assertion();
      return attempts;
    } catch (error) {
      if (!(error instanceof HarnessError)
        || (error.code !== "ASSERTION_FAILED" && !error.code.endsWith("_ASSERTION_FAILED"))) throw error;
      if (Date.now() - started >= timeoutMs) {
        throw new HarnessError(
          "WAIT_UNTIL_TIMEOUT",
          `wait.until timed out after ${timeoutMs}ms; last observed assertion failure: ${error.message}`,
          { attempts, lastFailure: error.message },
        );
      }
      await new Promise((resolveWait) => setTimeout(resolveWait, intervalMs));
    }
  }
}

export function extractValue(value: JsonValue | undefined, path: string): JsonValue {
  const extracted = getJsonPath(value ?? null, path);
  if (extracted === undefined) {
    throw new HarnessError("VALUE_PATH_MISSING", `value.extract path ${path} is missing`);
  }
  return extracted;
}

export async function readClientStateValue(
  target: Pick<ProtocolClient, "connected" | "state">,
  path: string,
): Promise<JsonValue | undefined> {
  // A server kick can close the protocol process before a follow-up state RPC.
  // Connection state belongs to the supervisor, so it remains observable after
  // that clean exit without racing a request against process shutdown.
  if (path === "connected") return target.connected;
  return getJsonPath(await target.state(), path);
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
      const matching = (): ReturnType<ProtocolClient["matchingEvents"]> => {
        let matches = target.matchingEvents(string("event"), Number(assertion.since ?? 0));
        if (typeof assertion.pattern === "string") {
          const pattern = new RegExp(assertion.pattern, typeof assertion.flags === "string" ? assertion.flags : "i");
          matches = matches.filter((event) => pattern.test(JSON.stringify(event.data)));
        }
        return matches;
      };
      const operator = assertion.operator ?? "gte";
      const expectedCount = Number(assertion.count ?? 1);
      let events = matching();
      if ((operator === "gte" || operator === "equals") && expectedCount > 0 && events.length < expectedCount) {
        const deadline = Date.now() + Number(assertion.timeoutMs ?? 2_000);
        while (events.length < expectedCount && Date.now() < deadline) {
          await new Promise((resolveWait) => setTimeout(resolveWait, 50));
          events = matching();
        }
      }
      assertComparison(events.length, operator, expectedCount, "client event count");
      evidence[`events:${target.spec.name}:${string("event")}`] = JSON.parse(JSON.stringify(events)) as JsonValue;
      return;
    }
    case "client.inventory":
    case "client.state":
    case "client.window": {
      const target = context.clients.get(string("client"));
      if (!target) throw new HarnessError("UNKNOWN_CLIENT", string("client"));
      const defaultPath = assertion.type === "client.inventory" ? "inventory" : assertion.type === "client.window" ? "window" : "";
      const path = string("path", defaultPath);
      const actual = await readClientStateValue(target, path);
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
    case "performance.threshold": {
      if (context.tickSamples.length === 0) {
        throw new HarnessError("PERFORMANCE_SAMPLES_MISSING", "performance.threshold requires soak.run samples");
      }
      const summary = samplePerformance(context.tickSamples);
      const path = string("path");
      const actual = getJsonPath(summary, path);
      assertComparison(actual, assertion.operator ?? "lte", assertion.expected, `performance ${path}`);
      evidence.performance = summary;
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
    case "value.json": {
      const name = string("value");
      const value = context.values[name];
      const actual = getJsonPath(value ?? null, string("jsonPath", "$"));
      assertComparison(actual, assertion.operator ?? "equals", assertion.expected, `value ${name}`);
      evidence[`value:${name}`] = value ?? null;
      return;
    }
    default: throw new HarnessError("UNSUPPORTED_ASSERTION", `Unsupported assertion ${assertion.type}`);
  }
}

export function samplePerformance(values: number[]): { mspt: { p50: number; p95: number; p99: number; max: number } } {
  if (values.length === 0) throw new HarnessError("PERFORMANCE_SAMPLES_MISSING", "performance samples are empty");
  return {
    mspt: {
      p50: percentile(values, 0.5),
      p95: percentile(values, 0.95),
      p99: percentile(values, 0.99),
      max: Math.max(...values),
    },
  };
}

export function assertComparison(actual: unknown, operator: JsonValue, expected: unknown, label: string): void {
  const encodedActual = JSON.stringify(actual) ?? String(actual);
  let passed = false;
  switch (operator) {
    case "equals": passed = isDeepStrictEqual(actual, expected); break;
    case "not_equals": passed = !isDeepStrictEqual(actual, expected); break;
    case "contains": passed = typeof actual === "string"
      ? actual.includes(String(expected))
      : Array.isArray(actual)
        ? actual.some((item) => isDeepStrictEqual(item, expected))
          || JSON.stringify(actual).includes(String(expected))
        : encodedActual.includes(String(expected)); break;
    case "not_contains": passed = typeof actual === "string"
      ? !actual.includes(String(expected))
      : Array.isArray(actual)
        ? !actual.some((item) => isDeepStrictEqual(item, expected))
          && !JSON.stringify(actual).includes(String(expected))
        : !encodedActual.includes(String(expected)); break;
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

async function clientBlockPosition(
  context: RunnerContext,
  action: HarnessAction,
  client: ProtocolClient,
): Promise<{ x: number; y: number; z: number }> {
  const requested = {
    x: Number(action.x ?? 0),
    y: Number(action.y ?? 0),
    z: Number(action.z ?? 0),
  };
  if (typeof action.relativeTo !== "string" && action.relative !== true) return requested;
  const relativeTo = typeof action.relativeTo === "string" ? action.relativeTo : undefined;
  const serverAnchored = relativeTo !== undefined;
  const state = serverAnchored
    ? await context.bridge.request("GET", `/v1/player/state?name=${encodeURIComponent(relativeTo)}`)
    : await client.state();
  const base = serverAnchored
    ? {
        x: Number(getJsonPath(state, "x")),
        y: Number(getJsonPath(state, "y")),
        z: Number(getJsonPath(state, "z")),
      }
    : {
        x: Number(getJsonPath(state, "position.x")),
        y: Number(getJsonPath(state, "position.y")),
        z: Number(getJsonPath(state, "position.z")),
      };
  if (![...Object.values(requested), ...Object.values(base)].every(Number.isFinite)) {
    throw new HarnessError("CLIENT_POSITION_UNAVAILABLE", `Cannot resolve a relative block position for ${client.spec.name}`);
  }
  return {
    x: Math.floor(base.x) + requested.x,
    y: Math.floor(base.y) + requested.y,
    z: Math.floor(base.z) + requested.z,
  };
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

async function runExternal(command: string, args: string[], timeoutMs: number): Promise<string> {
  return await new Promise<string>((resolveCommand, rejectCommand) => {
    execFile(command, args, { encoding: "utf8", timeout: timeoutMs, windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          rejectCommand(new HarnessError(
            "EXTERNAL_COMMAND_FAILED",
            `${command} ${args[0] ?? ""} failed: ${(stderr || stdout || error.message).trim()}`,
          ));
          return;
        }
        resolveCommand(`${stdout}${stderr}`);
      });
  });
}

async function cleanupService(context: RunnerContext, name: string): Promise<void> {
  const service = context.services.get(name);
  if (!service) return;
  const logs = await runExternal("docker", ["logs", service.container], 15_000)
    .catch((error) => errorMessage(error));
  const logPath = join(context.artifactDirectory, `service-${name}.log`);
  await writeFile(logPath, logs, "utf8");
  context.serviceArtifacts[`service-${name}-log`] = logPath;
  try {
    await runExternal("docker", ["rm", "--force", "--volumes", service.container], 30_000);
  } catch (error) {
    const failure = errorMessage(error);
    context.values[`service.${name}.cleanupError`] = failure;
    throw new HarnessError("SERVICE_CLEANUP_FAILED", `Could not remove service ${name}: ${failure}`);
  }
  context.services.delete(name);
}

async function cleanupServices(context: RunnerContext): Promise<void> {
  const failures: string[] = [];
  for (const name of [...context.services.keys()]) {
    try { await cleanupService(context, name); }
    catch (error) { failures.push(errorMessage(error)); }
  }
  if (failures.length) throw new HarnessError("SERVICE_CLEANUP_FAILED", failures.join("; "));
}
