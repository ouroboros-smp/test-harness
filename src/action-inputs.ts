import { realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { HarnessError } from "./errors.js";

export interface NamedArtifact {
  name: string;
  path: string;
}

export async function parseNamedArtifacts(input: string, workspace: string): Promise<NamedArtifact[]> {
  const root = await realpath(resolve(workspace));
  const seen = new Set<string>();
  const artifacts: NamedArtifact[] = [];
  for (const [index, rawLine] of input.split(/\r?\n/).entries()) {
    const line = rawLine.trim();
    if (!line) continue;
    const separator = line.indexOf("=");
    if (separator < 1 || separator === line.length - 1) {
      throw new HarnessError("INVALID_NAMED_ARTIFACT", `named-artifacts line ${index + 1} must be name=path`);
    }
    const name = line.slice(0, separator);
    const configuredPath = line.slice(separator + 1);
    if (!/^[a-z][a-z0-9_-]*$/.test(name)) {
      throw new HarnessError("INVALID_NAMED_ARTIFACT", `Invalid artifact name ${name}`);
    }
    if (seen.has(name)) throw new HarnessError("INVALID_NAMED_ARTIFACT", `Duplicate artifact name ${name}`);
    const configuredAbsolutePath = resolve(root, configuredPath);
    const metadata = await stat(configuredAbsolutePath).catch(() => undefined);
    if (!metadata?.isFile()) {
      throw new HarnessError("INVALID_NAMED_ARTIFACT", `Artifact ${name} must be an existing file: ${configuredPath}`);
    }
    const path = await realpath(configuredAbsolutePath);
    const fromRoot = relative(root, path);
    if (fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
      throw new HarnessError("INVALID_NAMED_ARTIFACT", `Artifact ${name} escapes the workspace: ${configuredPath}`);
    }
    seen.add(name);
    artifacts.push({ name, path });
  }
  return artifacts;
}
