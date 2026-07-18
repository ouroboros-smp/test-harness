#!/usr/bin/env node
import { spawn } from "node:child_process";
import { join } from "node:path";
import { clientExecutable } from "./client.js";
import { errorMessage, HarnessError } from "./errors.js";
import { issueCoverage, loadAllScenarios, loadPins, repositoryRoot, resolveScenario } from "./manifest.js";
import { runScenario } from "./runner.js";
import type { RunOptions } from "./types.js";
import { fileExists, withTimeout } from "./utils.js";

interface ParsedArgs {
  positionals: string[];
  flags: Map<string, string[]>;
}

async function main(): Promise<void> {
  const [command = "help", ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);
  switch (command) {
    case "help": printHelp(); return;
    case "list": await listScenarios(args.flags.has("json")); return;
    case "validate": await validateScenarios(args.flags.has("require-all-issues"), args.flags.has("json")); return;
    case "doctor": await doctor(args.flags.has("json")); return;
    case "run": {
      const reference = args.positionals[0];
      if (!reference) throw new HarnessError("USAGE", "run requires a scenario id or path");
      await run(reference, args);
      return;
    }
    case "smoke": await run("harness/live-smoke", args); return;
    default: throw new HarnessError("USAGE", `Unknown command: ${command}`);
  }
}

function printHelp(): void {
  console.log(`Ouroboros Fabric Test Harness

Usage:
  ouro-harness list [--json]
  ouro-harness validate [--require-all-issues] [--json]
  ouro-harness doctor [--json]
  ouro-harness run <scenario-id|path> [options]
  ouro-harness smoke [options]

Run options:
  --artifact NAME=PATH    Supply a packaged consumer/dependency jar (repeatable)
  --output PATH           Evidence and isolated server directory
  --cache PATH            Download cache directory
  --minecraft VERSION    Override the scenario/default Minecraft pin
  --loader VERSION       Override the Fabric Loader pin
  --fabric-api VERSION   Override the Fabric API pin
  --dry-run               Resolve and validate without launching Minecraft
  --keep-run-directory    Retain generated server state (artifacts are always retained)
  --verbose               Stream full server output
`);
}

async function listScenarios(asJson: boolean): Promise<void> {
  const entries = await loadAllScenarios();
  const values = entries.map(({ path, scenario }) => ({ id: scenario.id, title: scenario.title, issues: scenario.issues, path }));
  if (asJson) console.log(JSON.stringify(values, null, 2));
  else for (const value of values) console.log(`${value.id.padEnd(42)} #${value.issues.join(", #")}  ${value.title}`);
}

async function validateScenarios(requireAllIssues: boolean, asJson: boolean): Promise<void> {
  const entries = await loadAllScenarios();
  const ids = new Map<string, string[]>();
  for (const { path, scenario } of entries) ids.set(scenario.id, [...(ids.get(scenario.id) ?? []), path]);
  const duplicates = [...ids.entries()].filter(([, paths]) => paths.length > 1);
  const coverage = issueCoverage(entries.map(({ scenario }) => scenario));
  const failures = [
    ...duplicates.map(([id]) => `duplicate scenario id: ${id}`),
    ...(requireAllIssues ? coverage.missing.map((issue) => `GitHub issue #${issue} is not covered by a scenario`) : []),
  ];
  const output = {
    valid: failures.length === 0,
    scenarios: entries.length,
    coveredIssues: [...coverage.coverage.keys()].sort((a, b) => a - b),
    missingIssues: coverage.missing,
    failures,
  };
  if (asJson) console.log(JSON.stringify(output, null, 2));
  else {
    console.log(`Validated ${entries.length} scenarios; issue coverage ${output.coveredIssues.length}/22.`);
    for (const failure of failures) console.error(`- ${failure}`);
  }
  if (failures.length) throw new HarnessError("VALIDATION_FAILED", failures.join("; "));
}

async function doctor(asJson: boolean): Promise<void> {
  const pins = await loadPins();
  const java = await commandOutput(process.env.OURO_HARNESS_JAVA ?? "java", ["-version"]).catch((error) => errorMessage(error));
  const javaMajor = Number(/version "(?:1\.)?(\d+)/.exec(java)?.[1] ?? 0);
  const executable = clientExecutable();
  const clientOutput = await commandOutput(executable, ["--version"]).catch((error) => errorMessage(error));
  let clientVersion: { minecraft?: string; protocol?: number; engine?: string; engineRevision?: string } = {};
  try { clientVersion = JSON.parse(clientOutput) as typeof clientVersion; } catch { /* reported by the failed check */ }
  const checks = [
    { name: "node", ok: Number(process.versions.node.split(".")[0]) >= 24, detail: process.version },
    { name: "java", ok: javaMajor === pins.java, detail: java.split(/\r?\n/)[0] ?? java },
    {
      name: "protocol",
      ok: clientVersion.minecraft === pins.minecraft && clientVersion.protocol === pins.protocol,
      detail: clientVersion.minecraft
        ? `${clientVersion.engine ?? "client"} ${clientVersion.minecraft} / protocol ${String(clientVersion.protocol)} @ ${clientVersion.engineRevision ?? "unknown"}`
        : `${executable}: ${clientOutput.split(/\r?\n/)[0] ?? "unavailable"}`,
    },
    {
      name: "bridge",
      ok: await fileExists(join(repositoryRoot(), "bridge", "build", "libs", "ouro-harness-bridge-1.0.0.jar")),
      detail: "gradlew :bridge:build",
    },
  ];
  const output = { ok: checks.every((check) => check.ok), pins, checks };
  if (asJson) console.log(JSON.stringify(output, null, 2));
  else for (const check of checks) console.log(`${check.ok ? "PASS" : "FAIL"} ${check.name.padEnd(10)} ${check.detail}`);
  if (!output.ok) throw new HarnessError("DOCTOR_FAILED", "One or more environment checks failed");
}

async function run(reference: string, args: ParsedArgs): Promise<void> {
  const { scenario } = await resolveScenario(reference);
  const artifacts: Record<string, string> = {};
  for (const value of args.flags.get("artifact") ?? []) {
    const index = value.indexOf("=");
    if (index < 1) throw new HarnessError("USAGE", `Invalid --artifact ${value}; expected NAME=PATH`);
    artifacts[value.slice(0, index)] = value.slice(index + 1);
  }
  const output = lastFlag(args, "output");
  const cache = lastFlag(args, "cache");
  const options: RunOptions = {
    artifacts,
    dryRun: args.flags.has("dry-run"),
    keepRunDirectory: args.flags.has("keep-run-directory"),
    verbose: args.flags.has("verbose"),
    ...(output ? { output } : {}),
    ...(cache ? { cache } : {}),
  };
  const basePins = await loadPins();
  const report = await runScenario(scenario, {
    ...basePins,
    ...(lastFlag(args, "minecraft") ? { minecraft: lastFlag(args, "minecraft")! } : {}),
    ...(lastFlag(args, "loader") ? { loader: lastFlag(args, "loader")! } : {}),
    ...(lastFlag(args, "fabric-api") ? { fabricApi: lastFlag(args, "fabric-api")! } : {}),
  }, options);
  console.log(`${report.status.toUpperCase()} ${report.scenario.id}`);
  console.log(`Report: ${report.artifacts.report}`);
  if (report.status === "failed") {
    console.error(report.failureSummary);
    process.exitCode = 1;
  }
}

function parseArgs(values: string[]): ParsedArgs {
  const positionals: string[] = [];
  const flags = new Map<string, string[]>();
  const valueFlags = new Set(["artifact", "output", "cache", "minecraft", "loader", "fabric-api"]);
  for (let index = 0; index < values.length; index++) {
    const value = values[index]!;
    if (!value.startsWith("--")) {
      positionals.push(value);
      continue;
    }
    const [rawName, inline] = value.slice(2).split("=", 2);
    const name = rawName!;
    let flagValue = inline ?? "true";
    if (inline === undefined && valueFlags.has(name)) {
      const next = values[++index];
      if (!next) throw new HarnessError("USAGE", `--${name} requires a value`);
      flagValue = next;
    }
    flags.set(name, [...(flags.get(name) ?? []), flagValue]);
  }
  return { positionals, flags };
}

function lastFlag(args: ParsedArgs, name: string): string | undefined {
  return args.flags.get(name)?.at(-1);
}

async function commandOutput(command: string, args: string[]): Promise<string> {
  return await withTimeout(new Promise<string>((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    const chunks: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve(Buffer.concat(chunks).toString()) : reject(new Error(`${command} exited ${code}`)));
  }), 10_000, command);
}

main().catch((error) => {
  console.error(errorMessage(error));
  process.exitCode = 1;
});
