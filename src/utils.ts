import { createHash, randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, stat } from "node:fs/promises";
import { createServer } from "node:net";
import { dirname, resolve } from "node:path";
import { finished } from "node:stream/promises";
import { Readable } from "node:stream";
import { HarnessError, TimeoutError } from "./errors.js";
import type { JsonValue } from "./types.js";

export async function ensureDirectory(path: string): Promise<string> {
  const absolute = resolve(path);
  await mkdir(absolute, { recursive: true });
  return absolute;
}

export async function fileExists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

export async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  const stream = createReadStream(path);
  stream.on("data", (chunk) => hash.update(chunk));
  await finished(stream);
  return hash.digest("hex");
}

export async function downloadFile(
  url: string,
  destination: string,
  options: { sha256?: string; userAgent?: string } = {},
): Promise<string> {
  await ensureDirectory(dirname(destination));
  if (await fileExists(destination)) {
    if (!options.sha256 || (await sha256File(destination)) === options.sha256) return destination;
  }

  const response = await fetch(url, {
    redirect: "follow",
    headers: { "user-agent": options.userAgent ?? "ouroboros-test-harness/1.0 (https://github.com/ouroboros-smp/test-harness)" },
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok || !response.body) {
    throw new HarnessError("DOWNLOAD_FAILED", `Download failed (${response.status}) for ${url}`);
  }
  const { createWriteStream } = await import("node:fs");
  await finished(Readable.fromWeb(response.body as never).pipe(createWriteStream(destination)));
  if (options.sha256) {
    const actual = await sha256File(destination);
    if (actual !== options.sha256) {
      throw new HarnessError("CHECKSUM_MISMATCH", `Checksum mismatch for ${destination}`, {
        expected: options.sha256,
        actual,
      });
    }
  }
  return destination;
}

export async function getFreePort(): Promise<number> {
  return await new Promise<number>((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new HarnessError("PORT_ALLOCATION_FAILED", "Could not allocate a loopback port"));
        return;
      }
      const port = address.port;
      server.close((error) => (error ? reject(error) : resolvePort(port)));
    });
  });
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("hex");
}

export async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, operation: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(operation, timeoutMs)), timeoutMs);
    timer.unref();
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function interpolate(value: JsonValue, variables: Record<string, JsonValue>): JsonValue {
  if (typeof value === "string") {
    const exact = /^\$\{([^}]+)}$/.exec(value);
    if (exact) return variables[exact[1] ?? ""] ?? value;
    return value.replace(/\$\{([^}]+)}/g, (_, key: string) => String(variables[key] ?? `\${${key}}`));
  }
  if (Array.isArray(value)) return value.map((item) => interpolate(item, variables));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, interpolate(item, variables)]));
  }
  return value;
}

export function getJsonPath(root: JsonValue, path: string): JsonValue | undefined {
  const parts = path.replace(/^\$\.?/, "").split(".").filter(Boolean);
  let value: JsonValue | undefined = root;
  for (const part of parts) {
    if (Array.isArray(value) && /^\d+$/.test(part)) value = value[Number(part)];
    else if (value && typeof value === "object" && !Array.isArray(value)) value = value[part];
    else return undefined;
  }
  return value;
}

export function percentile(values: number[], quantile: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil(quantile * sorted.length) - 1);
  return sorted[Math.max(0, index)] ?? 0;
}

export async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}
