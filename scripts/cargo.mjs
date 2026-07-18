import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { access, copyFile, mkdir, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { join, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const nightly = "nightly-2026-07-13";
const windowsHost = `${nightly}-x86_64-pc-windows-gnullvm`;
const llvmMingwVersion = "20260616";
const llvmMingwArchive = `llvm-mingw-${llvmMingwVersion}-ucrt-x86_64.zip`;
const llvmMingwSha256 = "b9b68a4d276e16fa25802aaba458e4638f64b3884c290aaccdc2d87083b6ca35";
const repository = resolve(fileURLToPath(new URL("..", import.meta.url)));

let cargo = "cargo";
let cargoArguments = process.argv.slice(2);
const environment = { ...process.env };
let windowsRuntime;
const rustHost = process.platform === "win32" ? windowsHost : nightly;

await run("rustup", [
  "toolchain", "install", rustHost,
  "--profile", "minimal",
  "--component", "rustfmt",
  "--component", "clippy",
  ...(process.platform === "win32" ? ["--component", "rust-mingw"] : []),
]);
cargoArguments = [`+${rustHost}`, ...cargoArguments];

if (process.platform === "win32") {
  const toolchain = await ensureLlvmMingw();
  const binaryDirectory = join(toolchain, "bin");
  windowsRuntime = join(binaryDirectory, "libunwind.dll");
  environment.CARGO_TARGET_X86_64_PC_WINDOWS_GNULLVM_LINKER = join(binaryDirectory, "x86_64-w64-mingw32-clang.exe");
  const pathKey = Object.keys(environment).find((key) => key.toLowerCase() === "path") ?? "Path";
  environment[pathKey] = `${binaryDirectory};${environment[pathKey] ?? ""}`;
  cargo = join(process.env.CARGO_HOME ?? join(process.env.USERPROFILE ?? "", ".cargo"), "bin", "cargo.exe");
}

await run(cargo, cargoArguments, environment);
if (windowsRuntime) {
  const output = join(repository, "client", "target", "debug");
  await mkdir(output, { recursive: true });
  await copyFile(windowsRuntime, join(output, "libunwind.dll"));
}

async function ensureLlvmMingw() {
  const toolchains = join(repository, ".ouro-harness", "toolchains");
  const destination = join(toolchains, `llvm-mingw-${llvmMingwVersion}-ucrt-x86_64`);
  const linker = join(destination, "bin", "x86_64-w64-mingw32-clang.exe");
  if (await exists(linker)) return destination;

  const downloads = join(repository, ".ouro-harness", "downloads");
  const archive = join(downloads, llvmMingwArchive);
  await mkdir(downloads, { recursive: true });
  if (!(await exists(archive)) || await sha256(archive) !== llvmMingwSha256) {
    await rm(archive, { force: true });
    const response = await fetch(`https://github.com/mstorsjo/llvm-mingw/releases/download/${llvmMingwVersion}/${llvmMingwArchive}`, {
      headers: { "user-agent": "ouroboros-test-harness/1.0" },
      redirect: "follow",
      signal: AbortSignal.timeout(600_000),
    });
    if (!response.ok || !response.body) throw new Error(`LLVM-MinGW download failed: HTTP ${response.status}`);
    await pipeline(Readable.fromWeb(response.body), createWriteStream(archive));
    const actual = await sha256(archive);
    if (actual !== llvmMingwSha256) throw new Error(`LLVM-MinGW checksum mismatch: expected ${llvmMingwSha256}, got ${actual}`);
  }

  await mkdir(toolchains, { recursive: true });
  await rm(destination, { recursive: true, force: true });
  await run("tar.exe", ["-xf", archive, "-C", toolchains]);
  if (!(await exists(linker))) throw new Error(`LLVM-MinGW archive did not contain ${linker}`);
  return destination;
}

async function sha256(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function run(command, arguments_, env = process.env) {
  await new Promise((resolveRun, reject) => {
    const child = spawn(command, arguments_, { cwd: repository, env, stdio: "inherit", windowsHide: true });
    child.once("error", reject);
    child.once("exit", (code, signal) => code === 0
      ? resolveRun()
      : reject(new Error(`${command} exited with code ${String(code)} signal ${String(signal)}`)));
  });
}
