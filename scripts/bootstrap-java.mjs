import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { access, mkdir, readdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { finished } from "node:stream/promises";
import { Readable } from "node:stream";

const root = resolve(new URL("../.ouro-harness/toolchains", import.meta.url).pathname.replace(/^\/(?:[A-Za-z]:)/, (value) => value.slice(1)));
const os = { win32: "windows", linux: "linux", darwin: "mac" }[process.platform];
const architecture = { x64: "x64", arm64: "aarch64" }[process.arch];
if (!os || !architecture) throw new Error(`Unsupported Java bootstrap platform: ${process.platform}/${process.arch}`);

await mkdir(root, { recursive: true });
const existing = await findJavaHome(root);
if (existing) {
  console.log(existing);
  process.exit(0);
}

const response = await fetch(`https://api.adoptium.net/v3/assets/latest/25/hotspot?architecture=${architecture}&image_type=jdk&os=${os}&vendor=eclipse`, {
  headers: { "user-agent": "ouroboros-test-harness/1.0 (https://github.com/ouroboros-smp/test-harness)" },
  signal: AbortSignal.timeout(30_000),
});
if (!response.ok) throw new Error(`Adoptium API returned ${response.status}`);
const assets = await response.json();
const pkg = assets?.[0]?.binary?.package;
if (!pkg?.link || !pkg?.checksum || !pkg?.name) throw new Error("Adoptium API did not return a Java 25 JDK package");
const archive = join(root, pkg.name);
const download = await fetch(pkg.link, { redirect: "follow", signal: AbortSignal.timeout(180_000) });
if (!download.ok || !download.body) throw new Error(`JDK download returned ${download.status}`);
await finished(Readable.fromWeb(download.body).pipe(createWriteStream(archive)));
const hash = createHash("sha256");
const stream = createReadStream(archive);
stream.on("data", (chunk) => hash.update(chunk));
await finished(stream);
const actual = hash.digest("hex");
if (actual !== pkg.checksum) throw new Error(`JDK checksum mismatch: expected ${pkg.checksum}, got ${actual}`);
await run("tar", ["-xf", archive, "-C", root]);
const javaHome = await findJavaHome(root);
if (!javaHome) throw new Error(`JDK archive extracted but no Java home was found beneath ${root}`);
console.log(javaHome);

async function findJavaHome(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const candidate = join(directory, entry.name);
    try {
      await access(join(candidate, "bin", process.platform === "win32" ? "java.exe" : "java"));
      await access(join(candidate, "bin", process.platform === "win32" ? "javac.exe" : "javac"));
      return candidate;
    } catch {
      // Not a complete JDK.
    }
    const nested = await findJavaHome(candidate);
    if (nested) return nested;
  }
  return undefined;
}

async function run(command, args) {
  await new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { stdio: "inherit", windowsHide: true });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolveRun() : reject(new Error(`${command} exited ${code}`)));
  });
}
