import { execFile } from "node:child_process";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { parse } from "yaml";
import { errorMessage, HarnessError } from "./errors.js";
import { loadPins, repositoryRoot, resolveScenario } from "./manifest.js";
import { runScenario } from "./runner.js";
import type {
  JsonPrimitive,
  JsonValue,
  PortfolioBuildResult,
  PortfolioCommandSpec,
  PortfolioManifest,
  PortfolioReport,
  PortfolioScenarioResult,
  PortfolioTargetResult,
  RunOptions,
} from "./types.js";
import { ensureDirectory, interpolate } from "./utils.js";

export interface PortfolioRunOptions {
  config?: string;
  output?: string;
  cache?: string;
  variables?: Record<string, JsonPrimitive>;
  keepRunDirectory: boolean;
  verbose: boolean;
}

export async function loadPortfolioManifest(
  path = join(repositoryRoot(), "config", "portfolio.yaml"),
  overrides: Record<string, JsonPrimitive> = {},
): Promise<PortfolioManifest> {
  const raw = parse(await readFile(resolve(path), "utf8")) as unknown;
  const failures = validatePortfolioManifest(raw);
  if (failures.length) throw new HarnessError("INVALID_PORTFOLIO", failures.join("; "), { path, failures });
  const manifest = raw as PortfolioManifest;
  const variables: Record<string, JsonValue> = {
    ...manifest.variables,
    ...overrides,
    "platform.gradleWrapper": process.platform === "win32" ? "gradlew.bat" : "./gradlew",
    "platform.npm": process.platform === "win32" ? "npm.cmd" : "npm",
  };
  const resolved = interpolate(manifest as unknown as JsonValue, variables) as unknown as PortfolioManifest;
  const unresolved = unresolvedVariables(resolved as unknown as JsonValue);
  if (unresolved.length) {
    throw new HarnessError("INVALID_PORTFOLIO", `Unresolved portfolio variables: ${[...new Set(unresolved)].join(", ")}`);
  }
  return resolved;
}

export function validatePortfolioManifest(value: unknown): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return ["portfolio must be an object"];
  const manifest = value as Record<string, unknown>;
  const failures: string[] = [];
  if (manifest.schemaVersion !== 1) failures.push("schemaVersion must be 1");
  if (typeof manifest.title !== "string" || !manifest.title) failures.push("title must be a non-empty string");
  if (!isPrimitiveRecord(manifest.variables)) failures.push("variables must contain only primitive values");
  if (!Array.isArray(manifest.targets) || manifest.targets.length === 0) return [...failures, "targets must be a non-empty array"];
  const ids = new Set<string>();
  const scenarios = new Set<string>();
  for (const [index, rawTarget] of manifest.targets.entries()) {
    if (!rawTarget || typeof rawTarget !== "object" || Array.isArray(rawTarget)) {
      failures.push(`targets[${index}] must be an object`);
      continue;
    }
    const target = rawTarget as Record<string, unknown>;
    if (typeof target.id !== "string" || !/^[a-z0-9][a-z0-9_-]*$/.test(target.id)) failures.push(`targets[${index}].id is invalid`);
    else if (ids.has(target.id)) failures.push(`duplicate target id: ${target.id}`);
    else ids.add(target.id);
    if (typeof target.title !== "string" || !target.title) failures.push(`targets[${index}].title is required`);
    if (typeof target.repository !== "string" || !target.repository) failures.push(`targets[${index}].repository is required`);
    if (target.testedVersion !== undefined && (typeof target.testedVersion !== "string" || !target.testedVersion)) {
      failures.push(`targets[${index}].testedVersion must be a non-empty string`);
    }
    if (!Array.isArray(target.build) || target.build.length === 0) failures.push(`targets[${index}].build must be a non-empty array`);
    else for (const [commandIndex, rawCommand] of target.build.entries()) {
      if (!rawCommand || typeof rawCommand !== "object" || Array.isArray(rawCommand)) {
        failures.push(`targets[${index}].build[${commandIndex}] must be an object`);
        continue;
      }
      const command = rawCommand as Record<string, unknown>;
      if (typeof command.name !== "string" || !command.name) failures.push(`targets[${index}].build[${commandIndex}].name is required`);
      if (!Array.isArray(command.command) || command.command.length === 0 || command.command.some((part) => typeof part !== "string")) {
        failures.push(`targets[${index}].build[${commandIndex}].command must be a non-empty string array`);
      }
      if (command.base !== undefined && command.base !== "repository" && command.base !== "harness") {
        failures.push(`targets[${index}].build[${commandIndex}].base must be repository or harness`);
      }
      if (command.java !== undefined && (!Number.isInteger(command.java) || Number(command.java) < 1)) failures.push(`targets[${index}].build[${commandIndex}].java must be a positive integer`);
      if (command.timeoutMinutes !== undefined && (typeof command.timeoutMinutes !== "number" || command.timeoutMinutes <= 0)) failures.push(`targets[${index}].build[${commandIndex}].timeoutMinutes must be positive`);
      if (command.environment !== undefined && !isPrimitiveRecord(command.environment, false)) failures.push(`targets[${index}].build[${commandIndex}].environment must contain string, number, or boolean values`);
      if (command.environment && Object.keys(command.environment as Record<string, unknown>).some((name) => name.toUpperCase() === "JAVA_HOME")) {
        failures.push(`targets[${index}].build[${commandIndex}].environment must not override JAVA_HOME`);
      }
    }
    if (!Array.isArray(target.scenarios) || target.scenarios.length === 0 || target.scenarios.some((scenario) => typeof scenario !== "string" || !scenario)) {
      failures.push(`targets[${index}].scenarios must be a non-empty string array`);
    } else {
      for (const scenario of target.scenarios as string[]) {
        if (scenarios.has(scenario)) failures.push(`duplicate portfolio scenario: ${scenario}`);
        scenarios.add(scenario);
      }
    }
    if (target.artifacts !== undefined && (!target.artifacts || typeof target.artifacts !== "object" || Array.isArray(target.artifacts))) {
      failures.push(`targets[${index}].artifacts must be an object`);
    } else if (target.artifacts) {
      for (const [name, rawArtifact] of Object.entries(target.artifacts as Record<string, unknown>)) {
        if (!rawArtifact || typeof rawArtifact !== "object" || Array.isArray(rawArtifact)) {
          failures.push(`targets[${index}].artifacts.${name} must be an object`);
          continue;
        }
        const artifact = rawArtifact as Record<string, unknown>;
        if (typeof artifact.path !== "string" || !artifact.path) failures.push(`targets[${index}].artifacts.${name}.path is required`);
        if (artifact.base !== undefined && artifact.base !== "repository" && artifact.base !== "harness") failures.push(`targets[${index}].artifacts.${name}.base must be repository or harness`);
      }
    }
    if (!isPrimitiveRecord(target.variables)) failures.push(`targets[${index}].variables must contain only primitive values`);
  }
  return failures;
}

function isPrimitiveRecord(value: unknown, allowNull = true): boolean {
  if (value === undefined) return true;
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.values(value as Record<string, unknown>).every((entry) =>
    typeof entry === "string" || typeof entry === "number" || typeof entry === "boolean" || (allowNull && entry === null));
}

function unresolvedVariables(value: JsonValue): string[] {
  if (typeof value === "string") return [...value.matchAll(/\$\{([^}]+)}/g)].map((match) => match[1] ?? match[0]);
  if (Array.isArray(value)) return value.flatMap(unresolvedVariables);
  if (value && typeof value === "object") return Object.values(value).flatMap(unresolvedVariables);
  return [];
}

export async function runPortfolio(options: PortfolioRunOptions): Promise<PortfolioReport> {
  const manifest = await loadPortfolioManifest(options.config, options.variables);
  const started = Date.now();
  const output = await ensureDirectory(options.output ?? join(repositoryRoot(), "artifacts", `portfolio-${new Date().toISOString().replaceAll(/[:.]/g, "-")}`));
  const cache = options.cache ? resolve(options.cache) : undefined;
  const targets: PortfolioTargetResult[] = [];
  for (const target of manifest.targets) {
    const targetStarted = Date.now();
    const targetDirectory = await ensureDirectory(join(output, safeSegment(target.id)));
    const repository = isAbsolute(target.repository) ? resolve(target.repository) : resolve(repositoryRoot(), target.repository);
    const builds: PortfolioBuildResult[] = [];
    let buildFailed = false;
    try {
      if (!(await stat(repository)).isDirectory()) throw new Error("not a directory");
    } catch {
      buildFailed = true;
      const now = new Date().toISOString();
      builds.push({
        name: "Repository check",
        command: [],
        status: "failed",
        startedAt: now,
        finishedAt: now,
        durationMs: 0,
        log: join(targetDirectory, "build-repository-check.log"),
        error: `Repository not found: ${repository}`,
      });
      await writeFile(builds[0]!.log, builds[0]!.error! + "\n", "utf8");
    }
    for (const [index, command] of target.build.entries()) {
      if (buildFailed) break;
      const log = join(targetDirectory, `build-${String(index + 1).padStart(2, "0")}-${safeSegment(command.name)}.log`);
      const workingDirectory = command.base === "harness" ? repositoryRoot() : repository;
      const result = await runBuild(command, workingDirectory, log, options.verbose);
      builds.push(result);
      if (result.status === "failed") buildFailed = true;
    }

    const artifacts = Object.fromEntries(Object.entries(target.artifacts ?? {}).map(([name, artifact]) => [
      name,
      resolve(artifact.base === "harness" ? repositoryRoot() : repository, artifact.path),
    ]));
    const scenarios: PortfolioScenarioResult[] = [];
    for (const reference of target.scenarios) {
      if (buildFailed) {
        scenarios.push({ id: reference, title: reference, status: "skipped", durationMs: 0, issues: [], error: "Skipped because the target build failed" });
        continue;
      }
      const scenarioStarted = Date.now();
      try {
        const { scenario: loaded } = await resolveScenario(reference);
        const scenario = structuredClone(loaded);
        scenario.variables = {
          ...scenario.variables,
          ...target.variables,
          ...options.variables,
          repository,
        };
        const scenarioOutput = join(targetDirectory, "scenarios", safeSegment(reference));
        const runOptions: RunOptions = {
          artifacts,
          output: scenarioOutput,
          ...(cache ? { cache } : {}),
          dryRun: false,
          keepRunDirectory: options.keepRunDirectory,
          verbose: options.verbose,
        };
        console.log(`RUN   ${target.id} · ${reference}`);
        const report = await runScenario(scenario, await loadPins(), runOptions);
        scenarios.push({
          id: report.scenario.id,
          title: report.scenario.title,
          status: report.status,
          durationMs: report.durationMs,
          issues: report.scenario.issues,
          ...(report.artifacts.report ? { report: report.artifacts.report } : {}),
          ...(report.artifacts.html ? { html: report.artifacts.html } : {}),
          ...(report.failureSummary ? { error: report.failureSummary } : {}),
        });
        console.log(`${report.status === "passed" ? "PASS " : "FAIL "} ${target.id} · ${reference}`);
      } catch (error) {
        scenarios.push({
          id: reference,
          title: reference,
          status: "failed",
          durationMs: Date.now() - scenarioStarted,
          issues: [],
          error: errorMessage(error),
        });
        console.log(`FAIL  ${target.id} · ${reference}`);
      }
    }
    const targetFailed = buildFailed || scenarios.some((scenario) => scenario.status !== "passed");
    targets.push({
      id: target.id,
      title: target.title,
      repository,
      status: targetFailed ? "failed" : "passed",
      durationMs: Date.now() - targetStarted,
      builds,
      scenarios,
    });
  }
  const finished = Date.now();
  const report: PortfolioReport = {
    schemaVersion: 1,
    title: manifest.title,
    status: targets.every((target) => target.status === "passed") ? "passed" : "failed",
    startedAt: new Date(started).toISOString(),
    finishedAt: new Date(finished).toISOString(),
    durationMs: finished - started,
    targets,
    artifacts: {},
  };
  report.artifacts = await writePortfolioReport(report, output);
  return report;
}

async function runBuild(command: PortfolioCommandSpec, cwd: string, log: string, verbose: boolean): Promise<PortfolioBuildResult> {
  const started = Date.now();
  const startedAt = new Date(started).toISOString();
  console.log(`BUILD ${command.name} · ${cwd}`);
  const [program, ...args] = command.command;
  const batch = process.platform === "win32" && /\.(?:bat|cmd)$/i.test(program!);
  const executable = batch ? (process.env.ComSpec ?? "cmd.exe") : program!;
  const executableArgs = batch ? ["/d", "/s", "/c", program!, ...args] : args;
  let combined = "";
  let failure: string | undefined;
  try {
    const javaHome = await resolvePortfolioJavaHome(command.java);
    await new Promise<void>((resolveCommand, rejectCommand) => {
      const child = execFile(executable, executableArgs, {
        cwd,
        encoding: "utf8",
        timeout: (command.timeoutMinutes ?? 30) * 60_000,
        windowsHide: true,
        maxBuffer: 64 * 1024 * 1024,
        env: {
          ...process.env,
          ...Object.fromEntries(Object.entries(command.environment ?? {}).map(([name, value]) => [name, String(value)])),
          ...(javaHome ? { JAVA_HOME: javaHome } : {}),
        },
      }, (error, stdout, stderr) => {
        combined = `${stdout}${stderr}`;
        if (error) rejectCommand(error);
        else resolveCommand();
      });
      if (verbose) {
        child.stdout?.pipe(process.stdout);
        child.stderr?.pipe(process.stderr);
      }
    });
  } catch (error) {
    failure = errorMessage(error);
  }
  await mkdir(dirname(log), { recursive: true });
  await writeFile(log, `${command.command.join(" ")}\n\n${combined}${failure ? `\n${failure}\n` : ""}`, "utf8");
  const finished = Date.now();
  const result: PortfolioBuildResult = {
    name: command.name,
    command: command.command,
    status: failure ? "failed" : "passed",
    startedAt,
    finishedAt: new Date(finished).toISOString(),
    durationMs: finished - started,
    log,
    ...(failure ? { error: failure } : {}),
  };
  console.log(`${result.status === "passed" ? "PASS " : "FAIL "} build · ${command.name}`);
  return result;
}

const portfolioJavaHomes = new Map<string, Promise<string>>();

async function resolvePortfolioJavaHome(requiredMajor: number | undefined): Promise<string | undefined> {
  if (requiredMajor === undefined) return undefined;
  const variable = `OURO_HARNESS_JAVA_${requiredMajor}`;
  const executable = process.env[variable];
  if (!executable) {
    throw new HarnessError(
      "MISSING_PORTFOLIO_JAVA",
      `${variable} must point to the Java ${requiredMajor} executable; portfolio builds never fall back to ambient Java`,
    );
  }
  if (!isAbsolute(executable)) {
    throw new HarnessError(
      "INVALID_PORTFOLIO_JAVA",
      `${variable} must be an absolute path to the Java ${requiredMajor} executable: ${executable}`,
    );
  }
  const key = `${requiredMajor}\0${executable}`;
  let resolution = portfolioJavaHomes.get(key);
  if (!resolution) {
    resolution = inspectPortfolioJava(executable, requiredMajor, variable);
    portfolioJavaHomes.set(key, resolution);
  }
  return resolution;
}

async function inspectPortfolioJava(executable: string, requiredMajor: number, variable: string): Promise<string> {
  const output = await new Promise<string>((resolveVersion, rejectVersion) => {
    execFile(executable, ["-version"], {
      encoding: "utf8",
      timeout: 15_000,
      windowsHide: true,
      maxBuffer: 1024 * 1024,
    }, (error, stdout, stderr) => {
      if (error) {
        rejectVersion(new HarnessError(
          "INVALID_PORTFOLIO_JAVA",
          `${variable} could not execute Java ${requiredMajor}: ${errorMessage(error)}`,
        ));
      } else resolveVersion(`${stdout}${stderr}`);
    });
  });
  validatePortfolioJavaVersion(requiredMajor, output, executable);
  return dirname(dirname(executable));
}

export function validatePortfolioJavaVersion(requiredMajor: number, output: string, executable: string): void {
  const match = output.match(/\bversion\s+"(?:(1)\.)?(\d+)/i);
  if (!match) {
    throw new HarnessError(
      "INVALID_PORTFOLIO_JAVA",
      `Could not determine the Java major reported by ${executable}`,
    );
  }
  const actualMajor = Number(match[2]);
  if (actualMajor !== requiredMajor) {
    throw new HarnessError(
      "INVALID_PORTFOLIO_JAVA",
      `Portfolio build requires Java ${requiredMajor}, but ${executable} reported Java ${actualMajor}`,
    );
  }
}

async function writePortfolioReport(report: PortfolioReport, directory: string): Promise<Record<string, string>> {
  const paths = {
    report: join(directory, "report.json"),
    html: join(directory, "report.html"),
    summary: join(directory, "summary.md"),
    junit: join(directory, "junit.xml"),
  };
  Object.assign(report.artifacts, paths);
  await writeFile(paths.report, JSON.stringify(report, null, 2) + "\n", "utf8");
  await writeFile(paths.summary, renderPortfolioMarkdown(report, directory), "utf8");
  await writeFile(paths.html, renderPortfolioHtml(report, directory), "utf8");
  await writeFile(paths.junit, renderPortfolioJunit(report), "utf8");
  return paths;
}

function renderPortfolioMarkdown(report: PortfolioReport, directory: string): string {
  const scenarios = report.targets.flatMap((target) => target.scenarios);
  const builds = report.targets.flatMap((target) => target.builds);
  const lines = [
    `# ${report.status === "passed" ? "✅" : "❌"} ${markdown(report.title)}`,
    "",
    `> **${report.status.toUpperCase()}** · ${formatDuration(report.durationMs)} · ${scenarios.filter((entry) => entry.status === "passed").length}/${scenarios.length} scenarios · ${builds.filter((entry) => entry.status === "passed").length}/${builds.length} builds`,
    "",
    "| Mod / component | Build | Scenarios | Duration |",
    "|---|---|---|---:|",
    ...report.targets.map((target) => `| ${markdown(target.title)} | ${target.builds.every((build) => build.status === "passed") ? "✅" : "❌"} ${target.builds.filter((build) => build.status === "passed").length}/${target.builds.length} | ${target.scenarios.every((scenario) => scenario.status === "passed") ? "✅" : "❌"} ${target.scenarios.filter((scenario) => scenario.status === "passed").length}/${target.scenarios.length} | ${formatDuration(target.durationMs)} |`),
    "",
  ];
  for (const target of report.targets) {
    lines.push(`## ${target.status === "passed" ? "✅" : "❌"} ${markdown(target.title)}`, "", `Repository: \`${markdown(target.repository)}\``, "", "### Builds", "");
    for (const build of target.builds) {
      lines.push(`- ${build.status === "passed" ? "✅" : "❌"} **${markdown(build.name)}** · ${formatDuration(build.durationMs)} · [log](${href(directory, build.log)})${build.error ? ` — ${markdown(build.error)}` : ""}`);
    }
    lines.push("", "### Scenarios", "");
    for (const scenario of target.scenarios) {
      const link = scenario.html ? ` · [report](${href(directory, scenario.html)})` : "";
      lines.push(`- ${scenario.status === "passed" ? "✅" : scenario.status === "failed" ? "❌" : "⏭️"} **${markdown(scenario.title)}** · ${formatDuration(scenario.durationMs)}${link}${scenario.error ? ` — ${markdown(scenario.error)}` : ""}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

function renderPortfolioHtml(report: PortfolioReport, directory: string): string {
  const scenarios = report.targets.flatMap((target) => target.scenarios);
  const builds = report.targets.flatMap((target) => target.builds);
  const cards = report.targets.map((target) => `<article class="target ${target.status}">
    <header><div><span>${target.status === "passed" ? "✓" : "×"}</span><div><h2>${html(target.title)}</h2><code>${html(target.id)}</code></div></div><strong>${formatDuration(target.durationMs)}</strong></header>
    <p class="repo">${html(target.repository)}</p>
    <h3>Builds</h3><ul>${target.builds.map((build) => `<li><span class="status ${build.status}">${build.status}</span><b>${html(build.name)}</b><span>${formatDuration(build.durationMs)}</span><a href="${html(href(directory, build.log))}">log</a>${build.error ? `<pre>${html(build.error)}</pre>` : ""}</li>`).join("")}</ul>
    <h3>Scenarios</h3><ul>${target.scenarios.map((scenario) => `<li><span class="status ${scenario.status}">${scenario.status}</span><b>${html(scenario.title)}</b><span>${formatDuration(scenario.durationMs)}</span>${scenario.html ? `<a href="${html(href(directory, scenario.html))}">report</a>` : ""}${scenario.issues.length ? `<small>${scenario.issues.map((issue) => `#${issue}`).join(", ")}</small>` : ""}${scenario.error ? `<pre>${html(scenario.error)}</pre>` : ""}</li>`).join("")}</ul>
  </article>`).join("\n");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><title>${html(report.title)}</title><style>
  :root{color-scheme:light dark;--bg:#f4f7fb;--surface:#fff;--text:#172033;--muted:#657085;--border:#d8e0eb;--pass:#18794e;--pass-bg:#e7f7ef;--fail:#c43232;--fail-bg:#fff0f0;--skip:#8a5b12;--skip-bg:#fff7df;--accent:#3157d5;--shadow:0 8px 28px #17203312}@media(prefers-color-scheme:dark){:root{--bg:#0c111b;--surface:#151c29;--text:#edf2f9;--muted:#a6b1c2;--border:#2d3a4f;--pass:#6ee7a8;--pass-bg:#123c2a;--fail:#ff8e8e;--fail-bg:#481d22;--skip:#ffd37a;--skip-bg:#493718;--accent:#9cadff;--shadow:0 10px 30px #0005}}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.5 Inter,system-ui,sans-serif}.page{max-width:1180px;margin:auto;padding:38px 22px 60px}a{color:var(--accent);font-weight:700}code,pre{font-family:Consolas,monospace}.hero,.target{background:var(--surface);border:1px solid var(--border);border-radius:18px;box-shadow:var(--shadow)}.hero{border-left:7px solid ${report.status === "passed" ? "var(--pass)" : "var(--fail)"};padding:30px}.hero h1{margin:.2rem 0;font-size:clamp(1.8rem,4vw,2.7rem)}.eyebrow,.repo{color:var(--muted)}.summary{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-top:22px}.summary div{background:var(--bg);border:1px solid var(--border);border-radius:12px;padding:14px}.summary span{display:block;color:var(--muted);font-size:.75rem;text-transform:uppercase}.summary strong{font-size:1.35rem}.targets{display:grid;gap:16px;margin-top:22px}.target{padding:22px}.target.failed{border-left:5px solid var(--fail)}.target.passed{border-left:5px solid var(--pass)}.target header,.target header>div{display:flex;align-items:center;justify-content:space-between;gap:13px}.target header>div>span{display:grid;place-items:center;width:36px;height:36px;border-radius:50%;font-weight:900;background:var(--pass-bg);color:var(--pass)}.target.failed header>div>span{background:var(--fail-bg);color:var(--fail)}h2{margin:0}.repo{overflow-wrap:anywhere}h3{font-size:.78rem;text-transform:uppercase;color:var(--muted);margin:20px 0 8px}.target ul{list-style:none;margin:0;padding:0;border:1px solid var(--border);border-radius:11px;overflow:hidden}.target li{display:grid;grid-template-columns:72px minmax(220px,1fr) 90px 70px auto;gap:10px;padding:10px 12px;border-bottom:1px solid var(--border);align-items:center}.target li:last-child{border:0}.status{border-radius:99px;padding:.15rem .45rem;text-transform:uppercase;font-size:.65rem;font-weight:800;text-align:center}.status.passed{background:var(--pass-bg);color:var(--pass)}.status.failed{background:var(--fail-bg);color:var(--fail)}.status.skipped{background:var(--skip-bg);color:var(--skip)}pre{grid-column:2/-1;white-space:pre-wrap;overflow-wrap:anywhere;color:var(--fail);margin:3px 0}small{color:var(--muted)}@media(max-width:700px){.summary{grid-template-columns:1fr 1fr}.target li{grid-template-columns:70px 1fr}.target li span:nth-of-type(2),.target li a,.target li small{grid-column:2}.target header{align-items:flex-start!important}}@media print{body{background:#fff}.page{max-width:none}.hero,.target{box-shadow:none;break-inside:avoid}}
  </style></head><body><main class="page"><section class="hero"><div class="eyebrow">Ouroboros Fabric portfolio</div><h1>${html(report.title)}</h1><p><b>${report.status.toUpperCase()}</b> · ${formatDuration(report.durationMs)} · ${html(new Date(report.startedAt).toUTCString())}</p><div class="summary"><div><span>Targets</span><strong>${report.targets.filter((target) => target.status === "passed").length}/${report.targets.length}</strong></div><div><span>Builds</span><strong>${builds.filter((build) => build.status === "passed").length}/${builds.length}</strong></div><div><span>Scenarios</span><strong>${scenarios.filter((scenario) => scenario.status === "passed").length}/${scenarios.length}</strong></div><div><span>Failures</span><strong>${report.targets.filter((target) => target.status === "failed").length}</strong></div></div></section><section class="targets">${cards}</section></main></body></html>\n`;
}

function renderPortfolioJunit(report: PortfolioReport): string {
  const cases = report.targets.flatMap((target) => [
    ...target.builds.map((build) => ({ className: `${target.id}.build`, name: build.name, status: build.status, durationMs: build.durationMs, error: build.error })),
    ...target.scenarios.map((scenario) => ({ className: `${target.id}.scenario`, name: scenario.id, status: scenario.status, durationMs: scenario.durationMs, error: scenario.error })),
  ]);
  const body = cases.map((entry) => `  <testcase classname="${xml(entry.className)}" name="${xml(entry.name)}" time="${(entry.durationMs / 1_000).toFixed(3)}">${entry.status === "failed" ? `<failure message="${xml(entry.error ?? "failed")}">${xml(entry.error ?? "failed")}</failure>` : entry.status === "skipped" ? `<skipped message="${xml(entry.error ?? "skipped")}"/>` : ""}</testcase>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<testsuite name="portfolio" tests="${cases.length}" failures="${cases.filter((entry) => entry.status === "failed").length}" skipped="${cases.filter((entry) => entry.status === "skipped").length}" time="${(report.durationMs / 1_000).toFixed(3)}">\n${body}\n</testsuite>\n`;
}

function safeSegment(value: string): string {
  return value.replaceAll(/[^a-zA-Z0-9._-]+/g, "-");
}

function formatDuration(milliseconds: number): string {
  if (milliseconds < 1_000) return `${Math.round(milliseconds)}ms`;
  if (milliseconds < 60_000) return `${(milliseconds / 1_000).toFixed(1)}s`;
  return `${Math.floor(milliseconds / 60_000)}m ${Math.round((milliseconds % 60_000) / 1_000)}s`;
}

function href(directory: string, path: string): string {
  return relative(directory, path).split(sep).map(encodeURIComponent).join("/");
}

function html(value: unknown): string {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function markdown(value: unknown): string {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("|", "\\|").replaceAll("`", "\\`").replaceAll("\n", "<br>");
}

function xml(value: string): string {
  return html(value);
}
