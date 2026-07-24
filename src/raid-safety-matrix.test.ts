import assert from "node:assert/strict";
import test from "node:test";
import { loadAllScenarios } from "./manifest.js";
import { loadPortfolioManifest } from "./portfolio.js";
import { loadProductionManifest } from "./production-manifest.js";
import {
  auditRaidSafetyMatrix,
  loadRaidSafetyMatrix,
  validateRaidSafetyMatrix,
} from "./raid-safety-matrix.js";

test("raid-safety matrix preserves executable foundations without overstating final acceptance", async () => {
  const [matrix, scenarios, production, portfolio] = await Promise.all([
    loadRaidSafetyMatrix(),
    loadAllScenarios(),
    loadProductionManifest(),
    loadPortfolioManifest(),
  ]);
  assert.deepEqual(validateRaidSafetyMatrix(matrix), []);
  assert.deepEqual(matrix.production.requiredArtifacts, ["kinship", "patrol", "rooms", "parcels", "coffer"]);
  assert.deepEqual(
    matrix.acceptance.map((entry) => entry.id),
    [
      "combat-tag-participants",
      "manual-afk",
      "idle-afk",
      "tagged-logout",
      "defender-reconnect",
      "inferred-hallways",
      "tunnel-exclusion",
      "lock-pop",
      "storage-hp-handoff",
      "explosions",
      "restart-persistence",
      "disabled-default-rollout",
      "rollback",
    ],
  );

  const audit = auditRaidSafetyMatrix(matrix, scenarios.map(({ scenario }) => scenario), production, portfolio);
  assert.equal(audit.valid, true);
  assert.equal(audit.ready, false);
  assert.equal(audit.executableFoundations, matrix.foundations.length);
  assert.equal(audit.executableAcceptance, 0);
  assert.deepEqual(audit.blockedCases, matrix.acceptance.map((entry) => entry.id));
  assert.ok(!audit.findings.some((finding) =>
    finding.code === "MISSING_PRODUCTION_ARTIFACT" && finding.artifact === "parcels"));
  assert.ok(matrix.foundations.some((entry) =>
    entry.id === "parcels-offline-protection"
    && entry.scenarios.some((scenario) => scenario.id === "parcels/offline-protection")));
  assert.ok(audit.findings.some((finding) =>
    finding.code === "VERSION_DRIFT" && finding.artifact === "patrol"));
  assert.ok(audit.findings.some((finding) =>
    finding.code === "PORTFOLIO_ARTIFACT_LOCATOR_MISMATCH"
    && finding.entry === "patrol-conflict-contract"
    && finding.artifact === "patrol"));
  assert.ok(!audit.findings.some((finding) =>
    finding.code === "PORTFOLIO_ARTIFACT_MISSING"
    && finding.entry === "civilization-provider-contracts"));
});

test("raid-safety matrix rejects placeholder scenarios and unowned blockers", () => {
  const failures = validateRaidSafetyMatrix({
    schemaVersion: 1,
    title: "Invalid",
    issue: "not-an-issue",
    production: {
      manifest: "config/production-manifest.yaml",
      portfolio: "config/portfolio.yaml",
      requiredArtifacts: ["coffer", "coffer"],
    },
    foundations: [{
      id: "duplicate",
      title: "Blocked foundation",
      status: "blocked",
      artifacts: ["unknown"],
      scenarios: ["placeholder/not-runnable"],
      proves: [],
      blockers: [],
    }],
    acceptance: [{
      id: "duplicate",
      title: "Executable placeholder",
      status: "executable",
      artifacts: ["coffer"],
      scenarios: [],
      proves: ["nothing"],
      blockers: [{
        issue: "https://example.com/issues/1",
        reason: "not owned in GitHub",
      }],
    }],
  });
  assert.ok(failures.some((failure) => failure.includes("issue must be a GitHub issue URL")));
  assert.ok(failures.some((failure) => failure.includes("requiredArtifacts must be unique")));
  assert.ok(failures.some((failure) => failure.includes("foundations[0].status must be executable")));
  assert.ok(failures.some((failure) => failure.includes("duplicate matrix entry id")));
  assert.ok(failures.some((failure) => failure.includes("executable entries require scenarios")));
  assert.ok(failures.some((failure) => failure.includes("executable entries cannot have blockers")));
});

test("raid-safety audit rejects missing runnable scenario references", async () => {
  const [matrix, production, portfolio] = await Promise.all([
    loadRaidSafetyMatrix(),
    loadProductionManifest(),
    loadPortfolioManifest(),
  ]);
  const mutated = structuredClone(matrix);
  mutated.foundations[0]!.scenarios = [{
    id: "missing/scenario",
    bindings: { coffer: "consumer", rooms: "rooms", kinship: "kinship" },
  }];
  const audit = auditRaidSafetyMatrix(mutated, [], production, portfolio);
  assert.equal(audit.valid, false);
  assert.equal(audit.ready, false);
  assert.ok(audit.findings.some((finding) =>
    finding.code === "UNKNOWN_SCENARIO" && finding.entry === mutated.foundations[0]!.id));
});

test("raid-safety release gate can become ready only with aligned inventory and real scenarios", async () => {
  const [matrix, scenarios, production, portfolio] = await Promise.all([
    loadRaidSafetyMatrix(),
    loadAllScenarios(),
    loadProductionManifest(),
    loadPortfolioManifest(),
  ]);
  const futureMatrix = structuredClone(matrix);
  const futureProduction = structuredClone(production);
  const futurePortfolio = structuredClone(portfolio);
  const releaseScenario = structuredClone(scenarios[0]!.scenario);
  releaseScenario.id = "raid-safety/final-release";
  releaseScenario.artifacts = Object.fromEntries(
    futureMatrix.production.requiredArtifacts.map((artifact) => [artifact, { required: true }]),
  );

  const patrol = futureProduction.mods.find((mod) => mod.id === "patrol")!;
  patrol.version = "0.4.0-alpha";
  patrol.file = "patrol-fabric-0.4.0-alpha.jar";
  Object.assign(futurePortfolio.targets.find((target) => target.id === "coffer")!.artifacts!, {
    rooms: { path: "rooms-fabric-0.3.1.jar" },
    kinship: { path: "kinship-fabric-0.4.0.jar" },
  });
  const parcelsTarget = futurePortfolio.targets.find((target) => target.id === "parcels")!;
  parcelsTarget.artifacts = {
    ...parcelsTarget.artifacts,
    ...Object.fromEntries(
      futureMatrix.production.requiredArtifacts.map((artifact) => [
        artifact,
        { path: futureProduction.mods.find((mod) => mod.id === artifact)!.file! },
      ]),
    ),
  };
  parcelsTarget.scenarios.push(releaseScenario.id);
  for (const entry of futureMatrix.acceptance) {
    entry.status = "executable";
    entry.scenarios = [{
      id: releaseScenario.id,
      bindings: Object.fromEntries(entry.artifacts.map((artifact) => [artifact, artifact])),
    }];
    delete entry.blockers;
  }

  assert.deepEqual(validateRaidSafetyMatrix(futureMatrix), []);
  const audit = auditRaidSafetyMatrix(
    futureMatrix,
    [...scenarios.map(({ scenario }) => scenario), releaseScenario],
    futureProduction,
    futurePortfolio,
  );
  assert.equal(audit.valid, true);
  assert.equal(audit.ready, true);
  assert.deepEqual(audit.blockedCases, []);
  assert.deepEqual(audit.findings, []);
});
