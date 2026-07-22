import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateScenario } from "./manifest.js";
import { loadPortfolioManifest } from "./portfolio.js";
import {
  auditProductionManifest,
  buildFullManifestCompatibilityScenario,
  loadProductionManifest,
  resolveProductionArtifacts,
  validateProductionManifest,
} from "./production-manifest.js";
import type { PortfolioManifest, ProductionManifest } from "./types.js";

test("production manifest classifies the complete named stack and exposes known first-party drift", async () => {
  const manifest = await loadProductionManifest();
  const portfolio = await loadPortfolioManifest();
  assert.equal(validateProductionManifest(manifest).length, 0);
  assert.equal(manifest.mods.length, 44);
  assert.equal(manifest.mods.filter((mod) => mod.enabled).length, 42);
  assert.equal(manifest.mods.filter((mod) => mod.enabled && mod.owner === "first-party").length, 10);
  assert.equal(manifest.mods.filter((mod) => mod.enabled && mod.owner === "third-party").length, 32);
  assert.ok(manifest.mods.some((mod) => mod.bucket === "critical-dependency" && mod.id === "luckperms"));
  assert.deepEqual(manifest.mods.filter((mod) => !mod.enabled).map((mod) => mod.id).sort(), ["c2me", "grimac"]);

  const audit = await auditProductionManifest(manifest, portfolio);
  assert.equal(audit.ok, false);
  assert.ok(audit.findings.some((finding) => finding.code === "VERSION_DRIFT" && finding.mod === "mehen"));
  for (const id of ["ouroboros-relay", "secret-spectator"]) {
    assert.ok(audit.findings.some((finding) => finding.code === "UNCATALOGUED_FIRST_PARTY" && finding.mod === id));
  }
  assert.ok(!audit.findings.some((finding) => finding.code === "UNCATALOGUED_FIRST_PARTY" && finding.mod === "ouroveil"));
  assert.ok(!audit.findings.some((finding) => finding.code === "UNBOUND_ARTIFACT_VERSION"));
  assert.ok(audit.findings.some((finding) => finding.code === "UNPINNED_VERSION" && finding.severity === "warning"));
  const releaseAudit = await auditProductionManifest(manifest, portfolio, { strictThirdPartyPins: true });
  assert.ok(releaseAudit.findings.some((finding) => finding.code === "UNPINNED_VERSION" && finding.severity === "error"));
});

test("production manifest validation rejects ambiguous identity and unsafe artifact locators", () => {
  const failures = validateProductionManifest({
    schemaVersion: 1,
    title: "Invalid",
    platform: "fabric",
    minecraft: "26.2",
    loader: "0.19.3",
    mods: [
      {
        id: "duplicate",
        title: "One",
        modId: "same",
        owner: "first-party",
        bucket: "performance",
        enabled: true,
        file: "../escape.jar",
        filePattern: "one-*.jar",
        obligations: [],
        unexpected: true,
      },
      {
        id: "duplicate",
        title: "Two",
        modId: "same",
        owner: "third-party",
        bucket: "first-party",
        enabled: true,
        filePattern: "two-?.jar",
        obligations: ["boot"],
      },
    ],
  });
  assert.ok(failures.some((failure) => failure.includes("duplicate mod id")));
  assert.ok(failures.some((failure) => failure.includes("duplicate Fabric mod id")));
  assert.ok(failures.some((failure) => failure.includes("bucket must be first-party")));
  assert.ok(failures.some((failure) => failure.includes("must not be first-party")));
  assert.ok(failures.some((failure) => failure.includes("jar basename")));
  assert.ok(failures.some((failure) => failure.includes("cannot set both")));
  assert.ok(failures.some((failure) => failure.includes("obligations")));
  assert.ok(failures.some((failure) => failure.includes("unexpected is not allowed")));
});

test("exact and patterned jars resolve into a schema-valid full-manifest compatibility scenario", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ouro-production-manifest-test-"));
  try {
    await writeFile(join(directory, "owned-1.0.0.jar"), "owned", "utf8");
    await writeFile(join(directory, "dependency-2.0.0-build7.jar"), "dependency", "utf8");
    await writeFile(join(directory, "fabric-api-0.154.2+26.2.jar"), "fabric-api", "utf8");
    const manifest: ProductionManifest = {
      schemaVersion: 1,
      title: "Test production stack",
      platform: "fabric",
      minecraft: "26.2",
      loader: "0.19.3",
      mods: [
        {
          id: "fabric-api",
          title: "Fabric API",
          modId: "fabric-api",
          owner: "third-party",
          bucket: "operational",
          enabled: true,
          version: "0.154.2+26.2",
          file: "fabric-api-0.154.2+26.2.jar",
          obligations: ["boot"],
        },
        {
          id: "owned",
          title: "Owned",
          modId: "owned",
          owner: "first-party",
          bucket: "first-party",
          enabled: true,
          version: "1.0.0",
          file: "owned-1.0.0.jar",
          repository: "https://github.com/ouroboros-smp/owned",
          portfolioTarget: "owned",
          obligations: ["boot"],
        },
        {
          id: "dependency",
          title: "Dependency",
          modId: "dependency",
          owner: "third-party",
          bucket: "performance",
          enabled: true,
          version: "2.0.0",
          filePattern: "dependency-2.0.0-*.jar",
          obligations: ["boot", "soak"],
        },
      ],
    };
    const portfolio: PortfolioManifest = {
      schemaVersion: 1,
      title: "Test portfolio",
      targets: [{
        id: "owned",
        title: "Owned",
        repository: ".",
        testedVersion: "1.0.0",
        build: [{ name: "build", command: ["true"] }],
        artifacts: { consumer: { path: "owned-1.0.0.jar" } },
        scenarios: ["owned/smoke"],
      }],
    };

    const audit = await auditProductionManifest(manifest, portfolio, { modsDirectory: directory, strictThirdPartyPins: true });
    assert.equal(audit.ok, true, JSON.stringify(audit.findings));

    const nearCollisionPortfolio = structuredClone(portfolio);
    nearCollisionPortfolio.targets[0]!.artifacts!.consumer!.path = "owned-11.0.0.jar";
    const nearCollisionAudit = await auditProductionManifest(manifest, nearCollisionPortfolio);
    assert.ok(nearCollisionAudit.findings.some((finding) => finding.code === "TESTED_ARTIFACT_VERSION_MISMATCH"));

    const unboundManifest = structuredClone(manifest);
    unboundManifest.mods.find((mod) => mod.id === "dependency")!.filePattern = "dependency-*.jar";
    const unboundAudit = await auditProductionManifest(unboundManifest, portfolio);
    assert.ok(unboundAudit.findings.some((finding) => finding.code === "UNBOUND_ARTIFACT_VERSION"));

    const artifacts = await resolveProductionArtifacts(manifest, directory);
    assert.equal(artifacts.owned, join(directory, "owned-1.0.0.jar"));
    assert.equal(artifacts.dependency, join(directory, "dependency-2.0.0-build7.jar"));

    const scenario = buildFullManifestCompatibilityScenario(manifest);
    assert.deepEqual(validateScenario(scenario), []);
    assert.equal(scenario.id, "portfolio/full-manifest-compatibility");
    assert.deepEqual(scenario.issues, [39]);
    assert.deepEqual(Object.keys(scenario.artifacts ?? {}).sort(), ["dependency", "fabric-api", "owned"]);
    assert.ok(scenario.steps[0]?.assertions?.some((entry) => entry.type === "value.json" && entry.jsonPath === "owned.version"));
    assert.ok(scenario.steps.some((step) => step.actions?.some((action) => action.type === "server.restart")));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("overlapping artifact patterns cannot install one jar as two mods", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ouro-production-collision-test-"));
  try {
    const manifest = await loadProductionManifest();
    for (const mod of manifest.mods) mod.enabled = false;
    const fabricApi = manifest.mods.find((mod) => mod.id === "fabric-api")!;
    const first = manifest.mods.find((mod) => mod.id === "clumps")!;
    const second = manifest.mods.find((mod) => mod.id === "collective")!;
    fabricApi.enabled = true;
    first.enabled = true;
    first.version = "1";
    first.filePattern = "shared-*.jar";
    second.enabled = true;
    second.version = "1";
    second.filePattern = "*-1.jar";
    await writeFile(join(directory, fabricApi.file!), "fabric-api", "utf8");
    await writeFile(join(directory, "shared-1.jar"), "shared", "utf8");

    const portfolio: PortfolioManifest = { schemaVersion: 1, title: "No first-party targets", targets: [] };
    const audit = await auditProductionManifest(manifest, portfolio, { modsDirectory: directory });
    assert.ok(audit.findings.some((finding) => finding.code === "ARTIFACT_MATCH_COLLISION"));
    await assert.rejects(
      resolveProductionArtifacts(manifest, directory),
      (error: unknown) => error instanceof Error && error.message.includes("satisfies both"),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("directory audit rejects disabled and undeclared jars", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ouro-production-inventory-test-"));
  try {
    const manifest = await loadProductionManifest();
    for (const mod of manifest.mods) mod.enabled = mod.id === "fabric-api";
    await writeFile(join(directory, "fabric-api-0.154.2+26.2.jar"), "fabric-api", "utf8");
    await writeFile(join(directory, "c2me-disabled.jar"), "disabled", "utf8");
    await writeFile(join(directory, "not-in-manifest.jar"), "undeclared", "utf8");

    const portfolio: PortfolioManifest = { schemaVersion: 1, title: "No first-party targets", targets: [] };
    const audit = await auditProductionManifest(manifest, portfolio, { modsDirectory: directory });
    assert.equal(audit.ok, false);
    assert.ok(audit.findings.some((finding) => finding.code === "DISABLED_MOD_PRESENT" && finding.severity === "error"));
    assert.ok(audit.findings.some((finding) => finding.code === "UNDECLARED_PRODUCTION_JAR" && finding.severity === "error"));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
