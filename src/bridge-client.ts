import { HarnessError } from "./errors.js";
import type { JsonValue } from "./types.js";

export class BridgeClient {
  public constructor(
    private readonly port: number,
    private readonly token: string,
  ) {}

  public async request(method: string, path: string, body?: JsonValue, timeoutMs = 15_000): Promise<JsonValue> {
    const response = await fetch(`http://127.0.0.1:${this.port}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.token}`,
        "content-type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await response.text();
    let decoded: JsonValue;
    try {
      decoded = text ? JSON.parse(text) as JsonValue : null;
    } catch {
      decoded = { raw: text };
    }
    if (!response.ok) {
      throw new HarnessError("BRIDGE_ERROR", `Bridge ${method} ${path} returned ${response.status}`, decoded);
    }
    return decoded;
  }

  public async waitUntilReady(timeoutMs = 30_000): Promise<void> {
    const started = Date.now();
    let lastError: unknown;
    while (Date.now() - started < timeoutMs) {
      try {
        await this.request("GET", "/v1/health", undefined, 2_000);
        return;
      } catch (error) {
        lastError = error;
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }
    throw new HarnessError("BRIDGE_NOT_READY", `Bridge did not become ready within ${timeoutMs}ms`, lastError);
  }
}
