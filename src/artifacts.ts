import { copyFile, mkdir, stat } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { HarnessError } from "./errors.js";
import { repositoryRoot } from "./manifest.js";
import type { ArtifactSpec, FabricPins, Scenario } from "./types.js";
import { downloadFile, ensureDirectory, fileExists, sha256File } from "./utils.js";

const USER_AGENT = "ouroboros-test-harness/1.0 (https://github.com/ouroboros-smp/test-harness)";

export interface PreparedArtifacts {
  launcher: string;
  fabricApi: string;
  bridge?: string;
  supplied: Record<string, string>;
  checksums: Record<string, string>;
}

export async function prepareArtifacts(
  scenario: Scenario,
  pins: FabricPins,
  supplied: Record<string, string>,
  cacheDirectory: string,
): Promise<PreparedArtifacts> {
  const cache = await ensureDirectory(cacheDirectory);
  const launcherName = `fabric-server-${pins.minecraft}-loader-${pins.loader}-installer-${pins.installer}.jar`;
  const launcher = await downloadFile(
    `https://meta.fabricmc.net/v2/versions/loader/${encodeURIComponent(pins.minecraft)}/${encodeURIComponent(pins.loader)}/${encodeURIComponent(pins.installer)}/server/jar`,
    join(cache, launcherName),
    { userAgent: USER_AGENT },
  );
  const apiName = `fabric-api-${pins.fabricApi}.jar`;
  const fabricApi = await downloadFile(
    `https://maven.fabricmc.net/net/fabricmc/fabric-api/fabric-api/${pins.fabricApi}/${apiName}`,
    join(cache, apiName),
    { userAgent: USER_AGENT },
  );
  const bridge = scenario.server?.controlBridge === false
    ? undefined
    : resolve(repositoryRoot(), "bridge", "build", "libs", "ouro-harness-bridge-1.0.0.jar");
  if (bridge && !(await fileExists(bridge))) {
    throw new HarnessError("BRIDGE_NOT_BUILT", `Harness bridge is missing: ${bridge}. Run gradlew :bridge:build.`);
  }

  const resolved: Record<string, string> = {};
  for (const [name, spec] of Object.entries(scenario.artifacts ?? {})) {
    const provided = supplied[name] ?? spec.path;
    let artifactPath: string | undefined;
    if (provided) artifactPath = resolve(provided);
    else if (spec.url) {
      artifactPath = await downloadFile(spec.url, join(cache, basename(new URL(spec.url).pathname)), {
        userAgent: USER_AGENT,
        ...(spec.sha256 ? { sha256: spec.sha256 } : {}),
      });
    }
    if (!artifactPath) {
      if (spec.required !== false) throw new HarnessError("MISSING_ARTIFACT", `Scenario requires --artifact ${name}=PATH`);
      continue;
    }
    try {
      if (!(await stat(artifactPath)).isFile()) throw new Error("not a file");
    } catch {
      throw new HarnessError("INVALID_ARTIFACT", `Artifact ${name} is not a file: ${artifactPath}`);
    }
    if (spec.sha256) {
      const actual = await sha256File(artifactPath);
      if (actual !== spec.sha256) throw new HarnessError("CHECKSUM_MISMATCH", `Artifact ${name} checksum mismatch`);
    }
    resolved[name] = artifactPath;
  }
  for (const [name, provided] of Object.entries(supplied)) {
    if (name in resolved || name in (scenario.artifacts ?? {})) continue;
    const artifactPath = resolve(provided);
    try {
      if (!(await stat(artifactPath)).isFile()) throw new Error("not a file");
    } catch {
      throw new HarnessError("INVALID_ARTIFACT", `Artifact ${name} is not a file: ${artifactPath}`);
    }
    resolved[name] = artifactPath;
  }
  const standardArtifacts = { launcher, fabricApi, ...(bridge ? { bridge } : {}) };
  return {
    launcher,
    fabricApi,
    ...(bridge ? { bridge } : {}),
    supplied: resolved,
    checksums: Object.fromEntries(
      await Promise.all(
        Object.entries({ ...standardArtifacts, ...resolved }).map(async ([name, path]) => [name, await sha256File(path)]),
      ),
    ),
  };
}

export async function installArtifacts(
  runDirectory: string,
  scenario: Scenario,
  artifacts: PreparedArtifacts,
): Promise<Record<string, string>> {
  const modsDirectory = join(runDirectory, "mods");
  await mkdir(modsDirectory, { recursive: true });
  const installed: Record<string, string> = {};
  const standardArtifacts = {
    fabricApi: artifacts.fabricApi,
    ...(artifacts.bridge ? { bridge: artifacts.bridge } : {}),
  };
  for (const [name, source] of Object.entries({ ...standardArtifacts, ...artifacts.supplied })) {
    const destinationKind: ArtifactSpec["destination"] = name === "fabricApi" || name === "bridge"
      ? "mods"
      : scenario.artifacts?.[name]?.destination ?? "mods";
    if (destinationKind === "none") {
      installed[name] = source;
      continue;
    }
    const directory = destinationKind === "root" ? runDirectory : modsDirectory;
    const destination = join(directory, basename(source));
    await copyFile(source, destination);
    installed[name] = destination;
  }
  await copyFile(artifacts.launcher, join(runDirectory, "fabric-server-launch.jar"));
  installed.launcher = join(runDirectory, "fabric-server-launch.jar");
  return installed;
}
