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
  const scenariosById = new Map(scenarios.map((scenario) => [scenario.id, scenario]));
  const productionMods = new Map(production.mods.map((mod) => [mod.id, mod]));
  const targets = new Map(portfolio.targets.map((target) => [target.id, target]));
  const targetsByScenario = new Map(
    portfolio.targets.flatMap((target) => target.scenarios.map((scenario) => [scenario, target] as const)),
  );

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
    const boundArtifacts = new Set<string>();
    for (const reference of entry.scenarios) {
      const scenario = scenariosById.get(reference.id);
      if (!scenario) {
        findings.push({
          severity: "error",
          code: "UNKNOWN_SCENARIO",
          entry: entry.id,
          message: `${entry.id} references unknown runnable scenario ${reference.id}`,
        });
        continue;
      }
      const target = targetsByScenario.get(reference.id);
      if (!target) {
        findings.push({
          severity: "error",
          code: "UNCATALOGUED_SCENARIO",
          entry: entry.id,
          message: `${reference.id} is not assigned to a portfolio target`,
        });
      }
      for (const [artifact, slot] of Object.entries(reference.bindings)) {
        boundArtifacts.add(artifact);
        if (!Object.hasOwn(scenario.artifacts ?? {}, slot)) {
          findings.push({
            severity: "error",
            code: "UNKNOWN_SCENARIO_ARTIFACT",
            entry: entry.id,
            artifact,
            message: `${reference.id} does not declare artifact slot ${slot}`,
          });
        } else if (target && !Object.hasOwn(target.artifacts ?? {}, slot)) {
          findings.push({
            severity: "blocker",
            code: "PORTFOLIO_ARTIFACT_MISSING",
            entry: entry.id,
            artifact,
            message: `${target.id} does not supply ${reference.id} artifact slot ${slot}`,
          });
        }
      }
    }
    for (const artifact of entry.artifacts) {
      if (!boundArtifacts.has(artifact)) {
        findings.push({
          severity: "error",
          code: "UNBOUND_ENTRY_ARTIFACT",
          entry: entry.id,
          artifact,
          message: `${entry.id} has no scenario binding for required artifact ${artifact}`,
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
    for (const field of ["artifacts", "proves"] as const) {
      if (!nonEmptyStringArray(rawEntry[field])) {
        failures.push(`${prefix}.${field} must be a non-empty string array`);
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
    const scenarioCount = validateScenarioReferences(
      rawEntry.scenarios,
      rawEntry.artifacts,
      prefix,
      failures,
    );
    const blockers = validateBlockers(rawEntry.blockers, prefix, failures);
    if (rawEntry.status === "executable") {
      if (scenarioCount === 0) {
        failures.push(`${prefix} executable entries require scenarios`);
      }
      if (blockers > 0) failures.push(`${prefix} executable entries cannot have blockers`);
    } else if (rawEntry.status === "blocked") {
      if (scenarioCount > 0) {
        failures.push(`${prefix} blocked entries cannot name placeholder scenarios`);
      }
      if (blockers === 0) failures.push(`${prefix} blocked entries require at least one owned blocker`);
    }
  }
}

function validateScenarioReferences(
  value: unknown,
  rawArtifacts: unknown,
  prefix: string,
  failures: string[],
): number {
  if (!Array.isArray(value)) {
    failures.push(`${prefix}.scenarios must be an array`);
    return 0;
  }
  const entryArtifacts = new Set(Array.isArray(rawArtifacts)
    ? rawArtifacts.filter((artifact): artifact is string => typeof artifact === "string")
    : []);
  const scenarioIds = new Set<string>();
  for (const [index, rawReference] of value.entries()) {
    const referencePrefix = `${prefix}.scenarios[${index}]`;
    if (!isRecord(rawReference)) {
      failures.push(`${referencePrefix} must be an object`);
      continue;
    }
    failures.push(...unknownFields(rawReference, new Set(["id", "bindings"]), referencePrefix));
    if (!nonEmptyString(rawReference.id)) {
      failures.push(`${referencePrefix}.id is required`);
    } else if (scenarioIds.has(rawReference.id)) {
      failures.push(`${prefix}.scenarios must contain unique ids`);
    } else {
      scenarioIds.add(rawReference.id);
    }
    if (!isRecord(rawReference.bindings) || Object.keys(rawReference.bindings).length === 0) {
      failures.push(`${referencePrefix}.bindings must be a non-empty object`);
      continue;
    }
    for (const [artifact, slot] of Object.entries(rawReference.bindings)) {
      if (!entryArtifacts.has(artifact)) {
        failures.push(`${referencePrefix}.bindings contains undeclared entry artifact ${artifact}`);
      }
      if (!nonEmptyString(slot)) failures.push(`${referencePrefix}.bindings.${artifact} must be a non-empty string`);
    }
  }
  return value.length;
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
