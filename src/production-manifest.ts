import { readdir, readFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { parse } from "yaml";
import { HarnessError } from "./errors.js";
import { loadPins, repositoryRoot } from "./manifest.js";
import type {
  ArtifactSpec,
  HarnessAssertion,
  PortfolioManifest,
  ProductionManifest,
  ProductionManifestAudit,
  ProductionManifestFinding,
  ProductionModBucket,
  ProductionModOwner,
  ProductionModSpec,
  Scenario,
} from "./types.js";

const OWNERS = new Set<ProductionModOwner>(["first-party", "third-party"]);
const BUCKETS = new Set<ProductionModBucket>([
  "first-party",
  "critical-dependency",
  "gameplay",
  "performance",
  "protocol-infrastructure",
  "operational",
]);

export interface ProductionManifestAuditOptions {
  modsDirectory?: string;
  strictThirdPartyPins?: boolean;
}

/** Loads and validates the versioned production mod inventory. */
export async function loadProductionManifest(
  path = join(repositoryRoot(), "config", "production-manifest.yaml"),
): Promise<ProductionManifest> {
  const raw = parse(await readFile(resolve(path), "utf8")) as unknown;
  const failures = validateProductionManifest(raw);
  if (failures.length) {
    throw new HarnessError("INVALID_PRODUCTION_MANIFEST", failures.join("; "), { path, failures });
  }
  return raw as ProductionManifest;
}

/** Returns all structural failures in a production manifest document. */
export function validateProductionManifest(value: unknown): string[] {
  if (!isRecord(value)) return ["production manifest must be an object"];
  const failures: string[] = [];
  failures.push(...unknownFieldFailures(
    value,
    new Set(["schemaVersion", "title", "platform", "minecraft", "loader", "environmentDeltas", "mods"]),
    "$",
  ));
  if (value.schemaVersion !== 1) failures.push("schemaVersion must be 1");
  if (typeof value.title !== "string" || !value.title) failures.push("title must be a non-empty string");
  if (value.platform !== "fabric") failures.push("platform must be fabric");
  if (typeof value.minecraft !== "string" || !value.minecraft) failures.push("minecraft must be a non-empty string");
  if (typeof value.loader !== "string" || !value.loader) failures.push("loader must be a non-empty string");
  if (value.environmentDeltas !== undefined && !isNonEmptyStringArray(value.environmentDeltas)) {
    failures.push("environmentDeltas must contain non-empty strings");
  }
  if (!Array.isArray(value.mods) || value.mods.length === 0) return [...failures, "mods must be a non-empty array"];

  const ids = new Set<string>();
  const modIds = new Set<string>();
  const locators = new Set<string>();
  for (const [index, rawMod] of value.mods.entries()) {
    if (!isRecord(rawMod)) {
      failures.push(`mods[${index}] must be an object`);
      continue;
    }
    const prefix = `mods[${index}]`;
    failures.push(...unknownFieldFailures(
      rawMod,
      new Set([
        "id", "title", "modId", "owner", "bucket", "enabled", "version", "file", "filePattern",
        "repository", "portfolioTarget", "obligations", "touchpoints",
      ]),
      prefix,
    ));
    if (typeof rawMod.id !== "string" || !/^[a-z0-9][a-z0-9_-]*$/.test(rawMod.id)) {
      failures.push(`${prefix}.id is invalid`);
    } else if (ids.has(rawMod.id)) {
      failures.push(`duplicate mod id: ${rawMod.id}`);
    } else {
      ids.add(rawMod.id);
    }
    if (typeof rawMod.title !== "string" || !rawMod.title) failures.push(`${prefix}.title is required`);
    if (typeof rawMod.modId !== "string" || !/^[a-z][a-z0-9_-]*$/.test(rawMod.modId)) {
      failures.push(`${prefix}.modId is invalid`);
    } else if (modIds.has(rawMod.modId)) {
      failures.push(`duplicate Fabric mod id: ${rawMod.modId}`);
    } else {
      modIds.add(rawMod.modId);
    }
    if (!OWNERS.has(rawMod.owner as ProductionModOwner)) failures.push(`${prefix}.owner is invalid`);
    if (!BUCKETS.has(rawMod.bucket as ProductionModBucket)) failures.push(`${prefix}.bucket is invalid`);
    if (rawMod.owner === "first-party" && rawMod.bucket !== "first-party") {
      failures.push(`${prefix}.bucket must be first-party for a first-party mod`);
    }
    if (rawMod.owner === "third-party" && rawMod.bucket === "first-party") {
      failures.push(`${prefix}.bucket must not be first-party for a third-party mod`);
    }
    if (typeof rawMod.enabled !== "boolean") failures.push(`${prefix}.enabled must be boolean`);
    for (const field of ["version", "repository", "portfolioTarget"] as const) {
      const entry = rawMod[field];
      if (entry !== undefined && (typeof entry !== "string" || !entry)) failures.push(`${prefix}.${field} must be a non-empty string`);
    }
    if (typeof rawMod.repository === "string" && !isHttpUrl(rawMod.repository)) failures.push(`${prefix}.repository must be an HTTP(S) URL`);
    if (rawMod.file !== undefined && !isSafeJarLocator(rawMod.file, false)) failures.push(`${prefix}.file must be a jar basename`);
    if (rawMod.filePattern !== undefined && !isSafeJarLocator(rawMod.filePattern, true)) failures.push(`${prefix}.filePattern must be a jar basename pattern`);
    if (rawMod.file !== undefined && rawMod.filePattern !== undefined) failures.push(`${prefix} cannot set both file and filePattern`);
    const locator = typeof rawMod.file === "string" ? rawMod.file : typeof rawMod.filePattern === "string" ? rawMod.filePattern : undefined;
    if (locator) {
      if (locators.has(locator.toLowerCase())) failures.push(`duplicate artifact locator: ${locator}`);
      locators.add(locator.toLowerCase());
    }
    if (!isNonEmptyStringArray(rawMod.obligations)) failures.push(`${prefix}.obligations must contain non-empty strings`);
    if (rawMod.touchpoints !== undefined && !isNonEmptyStringArray(rawMod.touchpoints)) {
      failures.push(`${prefix}.touchpoints must contain non-empty strings`);
    }
  }
  return failures;
}

/** Audits deployment pins, portfolio coverage, and optionally a live mods directory. */
export async function auditProductionManifest(
  manifest: ProductionManifest,
  portfolio: PortfolioManifest,
  options: ProductionManifestAuditOptions = {},
): Promise<ProductionManifestAudit> {
  const findings: ProductionManifestFinding[] = [];
  const targets = new Map(portfolio.targets.map((target) => [target.id, target]));
  const enabled = manifest.mods.filter((mod) => mod.enabled);
  const pins = await loadPins();
  if (manifest.minecraft !== pins.minecraft) {
    findings.push({
      severity: "error",
      code: "MINECRAFT_VERSION_DRIFT",
      message: `Production targets Minecraft ${manifest.minecraft}, but the harness client/server pin is ${pins.minecraft}`,
    });
  }
  if (manifest.loader !== pins.loader) {
    findings.push({
      severity: "error",
      code: "FABRIC_LOADER_DRIFT",
      message: `Production targets Fabric Loader ${manifest.loader}, but the harness pin is ${pins.loader}`,
    });
  }
  const fabricApi = enabled.find((mod) => mod.modId === "fabric-api");
  if (!fabricApi) {
    findings.push({ severity: "error", code: "MISSING_FABRIC_API", message: "Production manifest has no enabled Fabric API entry" });
  } else if (fabricApi.version !== pins.fabricApi) {
    findings.push(finding(
      "error",
      "FABRIC_API_DRIFT",
      fabricApi,
      `Production targets Fabric API ${fabricApi.version ?? "unversioned"}, but the harness pin is ${pins.fabricApi}`,
    ));
  }

  for (const mod of enabled) {
    if (!mod.version) {
      const strict = mod.owner === "first-party" || options.strictThirdPartyPins === true;
      findings.push(finding(strict ? "error" : "warning", "UNPINNED_VERSION", mod, `${mod.title} has no production version pin`));
    }
    if (!mod.file && !mod.filePattern) {
      findings.push(finding("error", "MISSING_ARTIFACT_LOCATOR", mod, `${mod.title} has no production jar filename or pattern`));
    } else if (mod.version && !containsVersionToken(mod.file ?? mod.filePattern!, mod.version)) {
      findings.push(finding(
        "error",
        "UNBOUND_ARTIFACT_VERSION",
        mod,
        `${mod.title} version ${mod.version} is not an exact token in its artifact locator`,
      ));
    }
    if (mod.owner !== "first-party") continue;
    if (!mod.repository) findings.push(finding("error", "MISSING_REPOSITORY", mod, `${mod.title} has no source repository`));
    if (!mod.portfolioTarget) {
      findings.push(finding("error", "UNCATALOGUED_FIRST_PARTY", mod, `${mod.title} is deployed but has no portfolio target`));
      continue;
    }
    const target = targets.get(mod.portfolioTarget);
    if (!target) {
      findings.push(finding("error", "UNKNOWN_PORTFOLIO_TARGET", mod, `${mod.title} points to missing portfolio target ${mod.portfolioTarget}`));
      continue;
    }
    if (!target.testedVersion) {
      findings.push(finding("error", "UNPINNED_TEST_VERSION", mod, `${target.title} has no testedVersion in the portfolio catalog`));
    } else {
      const artifactPaths = Object.values(target.artifacts ?? {})
        .filter((artifact) => artifact.base !== "harness")
        .map((artifact) => artifact.path);
      if (!artifactPaths.some((path) => containsVersionToken(basename(path), target.testedVersion!))) {
        findings.push(finding(
          "error",
          "TESTED_ARTIFACT_VERSION_MISMATCH",
          mod,
          `${target.title} testedVersion ${target.testedVersion} is not an exact token in any repository artifact basename`,
        ));
      }
      if (mod.version && target.testedVersion !== mod.version) {
        findings.push(finding(
          "error",
          "VERSION_DRIFT",
          mod,
          `${mod.title} deploys ${mod.version}, but portfolio target ${target.id} tests ${target.testedVersion}`,
        ));
      }
    }
  }

  if (options.modsDirectory) {
    const directoryFindings = await auditModsDirectory(manifest, options.modsDirectory);
    findings.push(...directoryFindings);
  }

  return {
    ok: findings.every((entry) => entry.severity !== "error"),
    manifest: manifest.title,
    platform: manifest.platform,
    minecraft: manifest.minecraft,
    loader: manifest.loader,
    enabledMods: enabled.length,
    firstPartyMods: enabled.filter((mod) => mod.owner === "first-party").length,
    thirdPartyMods: enabled.filter((mod) => mod.owner === "third-party").length,
    findings,
  };
}

/** Resolves every enabled manifest entry to one exact jar in a mods directory. */
export async function resolveProductionArtifacts(
  manifest: ProductionManifest,
  modsDirectory: string,
): Promise<Record<string, string>> {
  const directory = resolve(modsDirectory);
  const files = await jarFiles(directory);
  const artifacts: Record<string, string> = {};
  const claimed = new Map<string, string>();
  for (const mod of manifest.mods.filter((entry) => entry.enabled)) {
    const matches = matchingFiles(mod, files);
    if (matches.length !== 1) {
      throw new HarnessError(
        "PRODUCTION_ARTIFACT_MISMATCH",
        `${mod.title} expected exactly one production jar, found ${matches.length}: ${matches.join(", ") || "none"}`,
        { mod: mod.id, matches },
      );
    }
    const match = matches[0]!;
    const previous = claimed.get(match.toLowerCase());
    if (previous) {
      throw new HarnessError(
        "PRODUCTION_ARTIFACT_COLLISION",
        `${match} satisfies both ${previous} and ${mod.id}; artifact locators must be disjoint`,
        { file: match, mods: [previous, mod.id] },
      );
    }
    claimed.set(match.toLowerCase(), mod.id);
    artifacts[mod.id] = join(directory, match);
  }
  return artifacts;
}

/** Builds the full-stack boot, load-inventory, client-join, and restart compatibility scenario. */
export function buildFullManifestCompatibilityScenario(manifest: ProductionManifest): Scenario {
  const enabled = manifest.mods.filter((mod) => mod.enabled);
  const artifacts: Record<string, ArtifactSpec> = Object.fromEntries(enabled.map((mod) => [
    mod.id,
    { required: true, description: `${mod.title} production jar` },
  ]));
  const assertions = modInventoryAssertions(enabled);
  return {
    schemaVersion: 1,
    id: "portfolio/full-manifest-compatibility",
    title: `${manifest.title} full-manifest compatibility`,
    description: "Boots the complete production mod set, verifies Fabric Loader IDs and versions, joins a real protocol client, and repeats the checks after restart. Behavioral interoperability remains tracked by issue #39.",
    issues: [39],
    tags: ["fabric", `minecraft-${manifest.minecraft}`, "production-manifest", "compatibility", "restart"],
    pins: { minecraft: manifest.minecraft, loader: manifest.loader },
    artifacts,
    clients: [{ name: "smoke", username: "InteropSmoke" }],
    server: { memoryMb: 4096, startupTimeoutSeconds: 600, reuseWorldOnRestart: true },
    steps: [
      {
        id: "boot",
        name: "Boot the complete production stack and verify every enabled mod",
        timeoutSeconds: 660,
        actions: [
          { type: "server.start" },
          { type: "bridge.request", method: "GET", path: "/v1/mods", as: "loaded-mods" },
        ],
        assertions: [
          ...assertions,
          { type: "client.state", client: "smoke", path: "name", expected: "InteropSmoke" },
        ],
      },
      {
        id: "restart",
        name: "Restart the complete stack and verify load inventory and client recovery",
        timeoutSeconds: 660,
        actions: [
          { type: "server.restart", reconnect: true },
          { type: "bridge.request", method: "GET", path: "/v1/mods", as: "restarted-mods" },
        ],
        assertions: [
          ...modInventoryAssertions(enabled, "restarted-mods"),
          { type: "client.state", client: "smoke", path: "name", expected: "InteropSmoke" },
          { type: "log.absent", pattern: "mixin.*(?:conflict|failed)|Mod resolution encountered|Incompatible mod set" },
        ],
      },
      {
        id: "stop",
        name: "Stop after success or failure",
        always: true,
        actions: [{ type: "server.stop" }],
      },
    ],
  };
}

/** Formats an audit for terminal and CI logs. */
export function formatProductionManifestAudit(audit: ProductionManifestAudit): string {
  const errors = audit.findings.filter((entry) => entry.severity === "error").length;
  const warnings = audit.findings.filter((entry) => entry.severity === "warning").length;
  const lines = [
    `${audit.ok ? "PASS" : "FAIL"} ${audit.manifest}: ${audit.enabledMods} enabled mods (${audit.firstPartyMods} first-party, ${audit.thirdPartyMods} third-party), ${errors} errors, ${warnings} warnings`,
  ];
  for (const entry of audit.findings) {
    lines.push(`- ${entry.severity.toUpperCase()} ${entry.code}${entry.mod ? ` [${entry.mod}]` : ""}: ${entry.message}`);
  }
  return lines.join("\n");
}

async function auditModsDirectory(manifest: ProductionManifest, modsDirectory: string): Promise<ProductionManifestFinding[]> {
  const files = await jarFiles(resolve(modsDirectory));
  const used = new Set<string>();
  const claims = new Map<string, string[]>();
  const findings: ProductionManifestFinding[] = [];
  for (const mod of manifest.mods) {
    const matches = matchingFiles(mod, files);
    for (const match of matches) {
      const normalized = match.toLowerCase();
      used.add(normalized);
      claims.set(normalized, [...(claims.get(normalized) ?? []), mod.id]);
    }
    if (mod.enabled && matches.length === 0) {
      findings.push(finding("error", "MISSING_PRODUCTION_JAR", mod, `${mod.title} is enabled but its jar is absent`));
    } else if (mod.enabled && matches.length > 1) {
      findings.push(finding("error", "AMBIGUOUS_PRODUCTION_JAR", mod, `${mod.title} matches multiple jars: ${matches.join(", ")}`));
    } else if (!mod.enabled && matches.length > 0) {
      findings.push(finding("error", "DISABLED_MOD_PRESENT", mod, `${mod.title} is disabled but present: ${matches.join(", ")}`));
    }
  }
  for (const [file, mods] of claims) {
    if (mods.length > 1) {
      findings.push({
        severity: "error",
        code: "ARTIFACT_MATCH_COLLISION",
        message: `${file} matches multiple manifest entries: ${mods.join(", ")}`,
      });
    }
  }
  for (const file of files.filter((entry) => !used.has(entry.toLowerCase()))) {
    findings.push({ severity: "error", code: "UNDECLARED_PRODUCTION_JAR", message: `${file} is present but absent from the production manifest` });
  }
  return findings;
}

function modInventoryAssertions(mods: ProductionModSpec[], value = "loaded-mods"): HarnessAssertion[] {
  return mods.flatMap((mod): HarnessAssertion[] => [
    { type: "value.json", value, jsonPath: `${mod.modId}.id`, expected: mod.modId },
    ...(mod.version
      ? [{ type: "value.json", value, jsonPath: `${mod.modId}.version`, expected: mod.version } satisfies HarnessAssertion]
      : []),
  ]);
}

function finding(
  severity: ProductionManifestFinding["severity"],
  code: string,
  mod: ProductionModSpec,
  message: string,
): ProductionManifestFinding {
  return { severity, code, mod: mod.id, message };
}

function matchingFiles(mod: ProductionModSpec, files: string[]): string[] {
  if (mod.file) return files.filter((file) => file.toLowerCase() === mod.file!.toLowerCase());
  if (!mod.filePattern) return [];
  const pattern = new RegExp(`^${escapeRegex(mod.filePattern).replaceAll("\\*", ".*")}$`, "i");
  return files.filter((file) => pattern.test(file));
}

function containsVersionToken(value: string, version: string): boolean {
  return new RegExp(`(?:^|[^A-Za-z0-9])${escapeRegex(version)}(?=$|[^A-Za-z0-9])`, "i").test(value);
}

async function jarFiles(directory: string): Promise<string[]> {
  try {
    return (await readdir(directory, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".jar"))
      .map((entry) => entry.name)
      .sort((left, right) => left.localeCompare(right));
  } catch (error) {
    throw new HarnessError("INVALID_MODS_DIRECTORY", `Cannot read production mods directory: ${directory}`, error);
  }
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.every((entry) => typeof entry === "string" && entry.length > 0);
}

function isHttpUrl(value: string): boolean {
  try {
    return ["http:", "https:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

function isSafeJarLocator(value: unknown, allowWildcard: boolean): value is string {
  if (typeof value !== "string" || !value.toLowerCase().endsWith(".jar") || basename(value) !== value) return false;
  if (/[?\[\]]/.test(value)) return false;
  if (!allowWildcard && value.includes("*")) return false;
  return true;
}

function unknownFieldFailures(value: Record<string, unknown>, allowed: Set<string>, prefix: string): string[] {
  return Object.keys(value)
    .filter((key) => !allowed.has(key))
    .map((key) => `${prefix}.${key} is not allowed`);
}
