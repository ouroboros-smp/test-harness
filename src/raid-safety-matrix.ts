import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parse } from "yaml";
import { HarnessError } from "./errors.js";
import { repositoryRoot } from "./manifest.js";
import { raidSafetyMatrixSchemaErrors } from "./schema.js";
import type {
  PortfolioManifest,
  ProductionManifest,
  RaidSafetyMatrix,
  RaidSafetyMatrixAudit,
  RaidSafetyMatrixEntry,
  RaidSafetyMatrixFinding,
  Scenario,
} from "./types.js";

const ENTRY_FIELDS = new Set([
  "id", "title", "status", "artifacts", "scenarios", "proves", "limitations", "blockers",
]);

export async function loadRaidSafetyMatrix(
  path = join(repositoryRoot(), "config", "raid-safety-matrix.yaml"),
): Promise<RaidSafetyMatrix> {
  const raw = parse(await readFile(resolve(path), "utf8")) as unknown;
  const failures = validateRaidSafetyMatrix(raw);
  if (failures.length) {
    throw new HarnessError("INVALID_RAID_SAFETY_MATRIX", failures.join("; "), { path, failures });
  }
  return raw as RaidSafetyMatrix;
}

export function validateRaidSafetyMatrix(value: unknown): string[] {
  if (!isRecord(value)) return ["raid-safety matrix must be an object"];
  const failures: string[] = raidSafetyMatrixSchemaErrors(value);
  failures.push(...unknownFields(
    value,
    new Set(["schemaVersion", "title", "issue", "production", "foundations", "acceptance"]),
    "$",
  ));
  if (value.schemaVersion !== 1) failures.push("schemaVersion must be 1");
  if (!nonEmptyString(value.title)) failures.push("title must be a non-empty string");
  if (!githubIssueUrl(value.issue)) failures.push("issue must be a GitHub issue URL");

  let requiredArtifacts: string[] = [];
  if (!isRecord(value.production)) {
    failures.push("production must be an object");
  } else {
    failures.push(...unknownFields(
      value.production,
      new Set(["manifest", "portfolio", "requiredArtifacts"]),
      "production",
    ));
    for (const field of ["manifest", "portfolio"] as const) {
      if (!safeRelativeYaml(value.production[field])) {
        failures.push(`production.${field} must be a safe relative YAML path`);
      }
    }
    if (!nonEmptyStringArray(value.production.requiredArtifacts)) {
      failures.push("production.requiredArtifacts must contain non-empty artifact ids");
    } else {
      requiredArtifacts = value.production.requiredArtifacts;
      if (new Set(requiredArtifacts).size !== requiredArtifacts.length) {
        failures.push("production.requiredArtifacts must be unique");
      }
    }
  }

  const ids = new Set<string>();
  validateEntries("foundations", value.foundations, requiredArtifacts, ids, failures, true);
  validateEntries("acceptance", value.acceptance, requiredArtifacts, ids, failures, false);
  return failures;
}

export function auditRaidSafetyMatrix(
  matrix: RaidSafetyMatrix,
  scenarios: Scenario[],
  production: ProductionManifest,
  portfolio: PortfolioManifest,
): RaidSafetyMatrixAudit {
  const findings: RaidSafetyMatrixFinding[] = [];
  const scenarioIds = new Set(scenarios.map((scenario) => scenario.id));
  const productionMods = new Map(production.mods.map((mod) => [mod.id, mod]));
  const targets = new Map(portfolio.targets.map((target) => [target.id, target]));

  for (const artifact of matrix.production.requiredArtifacts) {
    const mod = productionMods.get(artifact);
    if (!mod) {
      findings.push({
        severity: "blocker",
        code: "MISSING_PRODUCTION_ARTIFACT",
        artifact,
        message: `${artifact} is absent from the production manifest`,
      });
      continue;
    }
    if (!mod.enabled) {
      findings.push({
        severity: "blocker",
        code: "DISABLED_PRODUCTION_ARTIFACT",
        artifact,
        message: `${artifact} is disabled in the production manifest`,
      });
    }
    if (!mod.portfolioTarget) {
      findings.push({
        severity: "blocker",
        code: "MISSING_PORTFOLIO_TARGET",
        artifact,
        message: `${artifact} has no portfolio target`,
      });
      continue;
    }
    const target = targets.get(mod.portfolioTarget);
    if (!target) {
      findings.push({
        severity: "blocker",
        code: "UNKNOWN_PORTFOLIO_TARGET",
        artifact,
        message: `${artifact} points to missing portfolio target ${mod.portfolioTarget}`,
      });
    } else if (!mod.version || !target.testedVersion || mod.version !== target.testedVersion) {
      findings.push({
        severity: "blocker",
        code: "VERSION_DRIFT",
        artifact,
        message: `${artifact} production ${mod.version ?? "unversioned"} != portfolio ${target.testedVersion ?? "unversioned"}`,
      });
    }
  }

  for (const entry of [...matrix.foundations, ...matrix.acceptance]) {
    if (entry.status !== "executable") continue;
    for (const scenario of entry.scenarios) {
      if (!scenarioIds.has(scenario)) {
        findings.push({
          severity: "error",
          code: "UNKNOWN_SCENARIO",
          entry: entry.id,
          message: `${entry.id} references unknown runnable scenario ${scenario}`,
        });
      }
    }
  }

  const blockedCases = matrix.acceptance
    .filter((entry) => entry.status === "blocked")
    .map((entry) => entry.id);
  const valid = findings.every((finding) => finding.severity !== "error");
  return {
    valid,
    ready: valid && blockedCases.length === 0 && findings.length === 0,
    title: matrix.title,
    executableFoundations: matrix.foundations.filter((entry) => entry.status === "executable").length,
    executableAcceptance: matrix.acceptance.filter((entry) => entry.status === "executable").length,
    acceptanceCases: matrix.acceptance.length,
    blockedCases,
    findings,
  };
}

export function formatRaidSafetyMatrixAudit(audit: RaidSafetyMatrixAudit): string {
  const headline = audit.ready ? "READY" : audit.valid ? "BLOCKED" : "INVALID";
  const lines = [
    `${headline} ${audit.title}: ${audit.executableAcceptance}/${audit.acceptanceCases} final cases executable; ${audit.executableFoundations} merged-foundation checks reusable`,
  ];
  if (audit.blockedCases.length) lines.push(`- Blocked cases: ${audit.blockedCases.join(", ")}`);
  for (const finding of audit.findings) {
    lines.push(`- ${finding.severity.toUpperCase()} ${finding.code}${finding.artifact ? ` [${finding.artifact}]` : ""}${finding.entry ? ` [${finding.entry}]` : ""}: ${finding.message}`);
  }
  return lines.join("\n");
}

function validateEntries(
  group: "foundations" | "acceptance",
  rawEntries: unknown,
  requiredArtifacts: string[],
  ids: Set<string>,
  failures: string[],
  foundations: boolean,
): void {
  if (!Array.isArray(rawEntries) || rawEntries.length === 0) {
    failures.push(`${group} must be a non-empty array`);
    return;
  }
  const required = new Set(requiredArtifacts);
  for (const [index, rawEntry] of rawEntries.entries()) {
    const prefix = `${group}[${index}]`;
    if (!isRecord(rawEntry)) {
      failures.push(`${prefix} must be an object`);
      continue;
    }
    failures.push(...unknownFields(rawEntry, ENTRY_FIELDS, prefix));
    if (!nonEmptyString(rawEntry.id) || !/^[a-z0-9][a-z0-9-]*$/.test(rawEntry.id)) {
      failures.push(`${prefix}.id is invalid`);
    } else if (ids.has(rawEntry.id)) {
      failures.push(`duplicate matrix entry id: ${rawEntry.id}`);
    } else {
      ids.add(rawEntry.id);
    }
    if (!nonEmptyString(rawEntry.title)) failures.push(`${prefix}.title is required`);
    if (rawEntry.status !== "executable" && rawEntry.status !== "blocked") {
      failures.push(`${prefix}.status must be executable or blocked`);
    }
    if (foundations && rawEntry.status !== "executable") {
      failures.push(`${prefix}.status must be executable`);
    }
    for (const field of ["artifacts", "scenarios", "proves"] as const) {
      if (!nonEmptyStringArray(rawEntry[field], field === "scenarios")) {
        failures.push(`${prefix}.${field} must be ${field === "scenarios" ? "a string array" : "a non-empty string array"}`);
      } else if (new Set(rawEntry[field]).size !== rawEntry[field].length) {
        failures.push(`${prefix}.${field} must be unique`);
      }
    }
    if (Array.isArray(rawEntry.artifacts)) {
      for (const artifact of rawEntry.artifacts) {
        if (typeof artifact === "string" && !required.has(artifact)) {
          failures.push(`${prefix}.artifacts contains unknown required artifact ${artifact}`);
        }
      }
    }
    if (rawEntry.limitations !== undefined && !nonEmptyStringArray(rawEntry.limitations)) {
      failures.push(`${prefix}.limitations must be a non-empty string array when present`);
    }
    const blockers = validateBlockers(rawEntry.blockers, prefix, failures);
    if (rawEntry.status === "executable") {
      if (!Array.isArray(rawEntry.scenarios) || rawEntry.scenarios.length === 0) {
        failures.push(`${prefix} executable entries require scenarios`);
      }
      if (blockers > 0) failures.push(`${prefix} executable entries cannot have blockers`);
    } else if (rawEntry.status === "blocked") {
      if (Array.isArray(rawEntry.scenarios) && rawEntry.scenarios.length > 0) {
        failures.push(`${prefix} blocked entries cannot name placeholder scenarios`);
      }
      if (blockers === 0) failures.push(`${prefix} blocked entries require at least one owned blocker`);
    }
  }
}

function validateBlockers(value: unknown, prefix: string, failures: string[]): number {
  if (value === undefined) return 0;
  if (!Array.isArray(value)) {
    failures.push(`${prefix}.blockers must be an array`);
    return 0;
  }
  for (const [index, blocker] of value.entries()) {
    const blockerPrefix = `${prefix}.blockers[${index}]`;
    if (!isRecord(blocker)) {
      failures.push(`${blockerPrefix} must be an object`);
      continue;
    }
    failures.push(...unknownFields(blocker, new Set(["issue", "reason"]), blockerPrefix));
    if (!githubIssueUrl(blocker.issue)) failures.push(`${blockerPrefix}.issue must be a GitHub issue URL`);
    if (!nonEmptyString(blocker.reason)) failures.push(`${blockerPrefix}.reason is required`);
  }
  return value.length;
}

function unknownFields(value: Record<string, unknown>, allowed: Set<string>, prefix: string): string[] {
  return Object.keys(value)
    .filter((key) => !allowed.has(key))
    .map((key) => `${prefix}.${key} is not allowed`);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function nonEmptyStringArray(value: unknown, allowEmpty = false): value is string[] {
  return Array.isArray(value)
    && (allowEmpty || value.length > 0)
    && value.every((entry) => nonEmptyString(entry));
}

function githubIssueUrl(value: unknown): value is string {
  return typeof value === "string"
    && /^https:\/\/github\.com\/ouroboros-smp\/[A-Za-z0-9_.-]+\/issues\/[1-9]\d*$/.test(value);
}

function safeRelativeYaml(value: unknown): value is string {
  return typeof value === "string"
    && /^[A-Za-z0-9_.\/-]+\.ya?ml$/.test(value)
    && !value.startsWith("/")
    && !value.split("/").includes("..");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
