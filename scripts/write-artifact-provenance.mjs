import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const [
  outputPath,
  roomsCommit,
  roomsJarPath,
  harnessCommit,
  adapterJarPath,
] = process.argv.slice(2);
if (!outputPath || !roomsCommit || !roomsJarPath || !harnessCommit || !adapterJarPath) {
  throw new Error(
    "usage: write-artifact-provenance.mjs OUTPUT ROOMS_COMMIT ROOMS_JAR"
    + " HARNESS_COMMIT ADAPTER_JAR",
  );
}
const commitPattern = /^[0-9a-f]{40}$/;
if (!commitPattern.test(roomsCommit) || !commitPattern.test(harnessCommit)) {
  throw new Error("commit provenance must use full lowercase 40-character SHAs");
}

async function artifact(path) {
  const absolutePath = resolve(path);
  const [bytes, metadata] = await Promise.all([readFile(absolutePath), stat(absolutePath)]);
  return {
    path: path.replaceAll("\\", "/"),
    bytes: metadata.size,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

const provenance = {
  schemaVersion: 1,
  rooms: {
    repository: "ouroboros-smp/rooms-and-structures",
    commit: roomsCommit,
    artifact: await artifact(roomsJarPath),
  },
  harness: {
    repository: "ouroboros-smp/test-harness",
    commit: harnessCommit,
    adapter: await artifact(adapterJarPath),
  },
};
const absoluteOutput = resolve(outputPath);
await mkdir(dirname(absoluteOutput), { recursive: true });
await writeFile(absoluteOutput, `${JSON.stringify(provenance, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify(provenance)}\n`);
