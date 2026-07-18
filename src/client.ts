import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { once } from "node:events";
import { createInterface } from "node:readline";
import { join } from "node:path";
import { HarnessError } from "./errors.js";
import { repositoryRoot } from "./manifest.js";
import type { ClientSpec, JsonValue } from "./types.js";
import { fileExists, withTimeout } from "./utils.js";

export interface ClientEvent {
  at: string;
  type: string;
  data: JsonValue;
}

interface ClientMessage {
  kind: "started" | "version" | "event" | "response" | "fatal" | "protocol_error";
  id?: number;
  type?: string;
  ok?: boolean;
  data?: JsonValue;
  error?: string;
}

interface PendingRequest {
  resolve: (value: JsonValue) => void;
  reject: (error: Error) => void;
}

export function clientExecutable(): string {
  return process.env.OURO_HARNESS_CLIENT
    ?? join(repositoryRoot(), "client", "target", "debug", process.platform === "win32" ? "ouro-harness-client.exe" : "ouro-harness-client");
}

export class ProtocolClient {
  private child: ChildProcessWithoutNullStreams | undefined;
  private isConnected = false;
  private expectedExit = false;
  private requestSequence = 0;
  private readonly pending = new Map<number, PendingRequest>();
  public readonly events: ClientEvent[] = [];

  public constructor(
    public readonly spec: ClientSpec,
    private readonly host: string,
    private readonly port: number,
    private readonly version: string,
  ) {}

  public get connected(): boolean {
    return this.isConnected;
  }

  public async connect(timeoutMs = 30_000): Promise<void> {
    if (this.connected) return;
    const executable = clientExecutable();
    if (!(await fileExists(executable))) {
      throw new HarnessError("CLIENT_BINARY_MISSING", `Headless client not found at ${executable}; run npm run build:client`);
    }
    this.expectedExit = false;
    const child = spawn(executable, [
      "--host", this.host,
      "--port", String(this.port),
      "--username", this.spec.username,
    ], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    this.child = child;

    let resolveSpawn!: () => void;
    let rejectSpawn!: (error: Error) => void;
    const spawned = new Promise<void>((resolve, reject) => {
      resolveSpawn = resolve;
      rejectSpawn = reject;
    });
    const stdout = createInterface({ input: child.stdout });
    const stderr = createInterface({ input: child.stderr });
    stdout.on("line", (line) => {
      try {
        const message = JSON.parse(line) as ClientMessage;
        this.handleMessage(message, resolveSpawn, rejectSpawn);
      } catch (error) {
        rejectSpawn(new HarnessError("CLIENT_PROTOCOL_ERROR", `${this.spec.name} emitted invalid JSON`, { line, error: String(error) }));
      }
    });
    stderr.on("line", (line) => {
      if (line.trim()) this.record("diagnostic", { stream: "stderr", message: line });
    });
    child.once("error", (error) => rejectSpawn(error));
    child.once("exit", (code, signal) => {
      const wasConnected = this.isConnected;
      this.isConnected = false;
      this.child = undefined;
      const error = new HarnessError("CLIENT_EXITED", `${this.spec.name} client exited with code ${String(code)} signal ${String(signal)}`);
      if (!wasConnected && !this.expectedExit) rejectSpawn(error);
      for (const pending of this.pending.values()) pending.reject(error);
      this.pending.clear();
      if (!this.expectedExit) this.record("end", { code, signal });
    });

    try {
      await withTimeout(spawned, timeoutMs, `client ${this.spec.name} connection (${this.version})`);
    } catch (error) {
      this.expectedExit = true;
      child.kill();
      throw error;
    }
  }

  public async disconnect(reason = "Harness step"): Promise<void> {
    const child = this.child;
    if (!child) return;
    this.expectedExit = true;
    this.record("disconnect_requested", { reason });
    try {
      await this.request("disconnect", { reason }, 5_000);
    } catch {
      child.kill();
    }
    if (child.exitCode === null && child.signalCode === null) {
      try {
        await withTimeout(once(child, "exit"), 5_000, `client ${this.spec.name} shutdown`);
      } catch {
        child.kill();
      }
    }
    this.isConnected = false;
  }

  public async reconnect(timeoutMs = 30_000): Promise<void> {
    await this.disconnect("Harness reconnect");
    await this.connect(timeoutMs);
  }

  public async chat(message: string): Promise<void> {
    await this.request("chat", { message });
  }

  public async look(yaw: number, pitch: number): Promise<void> {
    await this.request("look", { yaw, pitch });
  }

  public async move(control: "forward" | "back" | "left" | "right" | "jump" | "sprint" | "sneak", durationMs: number): Promise<void> {
    await this.request("move", { control, enabled: true });
    try {
      await new Promise((resolve) => setTimeout(resolve, durationMs));
    } finally {
      await this.request("move", { control, enabled: false });
    }
  }

  public async useBlock(x: number, y: number, z: number): Promise<void> {
    await this.request("use_block", { x, y, z });
  }

  public async breakBlock(x: number, y: number, z: number): Promise<void> {
    await this.request("break_block", { x, y, z });
  }

  public async placeBlock(x: number, y: number, z: number, face: { x: number; y: number; z: number }): Promise<void> {
    await this.request("place_block", { x, y, z, face });
  }

  public async attack(targetName: string): Promise<void> {
    await this.request("attack", { target: targetName });
  }

  public async respawn(): Promise<void> {
    await this.request("respawn");
  }

  public async clickWindow(slot: number, button = 0, mode = 0): Promise<void> {
    await this.request("click_window", { slot, button, mode });
  }

  public async state(): Promise<JsonValue> {
    return await this.request("state");
  }

  public matchingEvents(type: string, since = 0): ClientEvent[] {
    return this.events.slice(since).filter((event) => event.type === type);
  }

  private async request(command: string, data: JsonValue = {}, timeoutMs = 10_000): Promise<JsonValue> {
    const child = this.child;
    if (!child || !child.stdin.writable) {
      throw new HarnessError("CLIENT_NOT_CONNECTED", `Client ${this.spec.name} is not connected`);
    }
    const id = ++this.requestSequence;
    const response = new Promise<JsonValue>((resolve, reject) => this.pending.set(id, { resolve, reject }));
    child.stdin.write(`${JSON.stringify({ id, command, data })}\n`, "utf8");
    try {
      return await withTimeout(response, timeoutMs, `client ${this.spec.name} command ${command}`);
    } finally {
      this.pending.delete(id);
    }
  }

  private handleMessage(message: ClientMessage, resolveSpawn: () => void, rejectSpawn: (error: Error) => void): void {
    if (message.kind === "response" && typeof message.id === "number") {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      if (message.ok) pending.resolve(message.data ?? null);
      else pending.reject(new HarnessError("CLIENT_COMMAND_FAILED", `${this.spec.name}: ${message.error ?? "unknown client command failure"}`));
      return;
    }
    if (message.kind === "event" && message.type) {
      this.record(message.type, message.data ?? {});
      if (message.type === "spawn") {
        this.isConnected = true;
        resolveSpawn();
      } else if (message.type === "error" && !this.isConnected) {
        rejectSpawn(new HarnessError("CLIENT_CONNECTION_FAILED", `${this.spec.name}: ${JSON.stringify(message.data)}`));
      }
      return;
    }
    if (message.kind === "fatal" || message.kind === "protocol_error") {
      const error = new HarnessError("CLIENT_PROTOCOL_ERROR", `${this.spec.name}: ${message.error ?? message.kind}`);
      rejectSpawn(error);
      for (const pending of this.pending.values()) pending.reject(error);
    }
  }

  private record(type: string, data: JsonValue): void {
    this.events.push({ at: new Date().toISOString(), type, data });
  }
}
