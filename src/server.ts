import { createWriteStream } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { HarnessError } from "./errors.js";
import { LogMonitor } from "./log-monitor.js";
import type { ServerSpec } from "./types.js";
import { withTimeout } from "./utils.js";

const READY_PATTERN = /Done \([^)]+\)! For help|Dedicated server started|OURO_HARNESS_BRIDGE_READY/;

export class MinecraftServer {
  private process?: ChildProcessWithoutNullStreams;
  private readonly logStream;
  private logClosed = false;
  public readonly monitor = new LogMonitor();
  public readonly logPath: string;

  public constructor(
    public readonly directory: string,
    private readonly javaExecutable: string,
    private readonly spec: ServerSpec,
    private readonly environment: NodeJS.ProcessEnv,
  ) {
    this.logPath = join(directory, "harness-server.log");
    this.logStream = createWriteStream(this.logPath, { flags: "a" });
  }

  public get running(): boolean {
    return Boolean(this.process && this.process.exitCode === null);
  }

  public async start(): Promise<void> {
    if (this.running) throw new HarnessError("SERVER_ALREADY_RUNNING", "Minecraft server is already running");
    const memory = this.spec.memoryMb ?? 1536;
    const args = [
      `-Xms${Math.min(memory, 512)}M`,
      `-Xmx${memory}M`,
      "-Dfile.encoding=UTF-8",
      "--add-modules=jdk.httpserver",
      ...(this.spec.jvmArgs ?? []),
      "-jar",
      "fabric-server-launch.jar",
      "nogui",
    ];
    const child = spawn(this.javaExecutable, args, {
      cwd: this.directory,
      env: this.environment,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    this.process = child;
    const onData = (chunk: Buffer) => {
      this.monitor.accept(chunk);
      this.logStream.write(chunk);
      process.stdout.write(this.environment.OURO_HARNESS_VERBOSE === "1" ? chunk : "");
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);

    const readiness = new Promise<void>((resolve, reject) => {
      let readinessBuffer = "";
      const inspect = (chunk: Buffer) => {
        readinessBuffer = `${readinessBuffer}${chunk.toString()}`.slice(-4096);
        if (READY_PATTERN.test(readinessBuffer)) {
          child.stdout.off("data", inspect);
          child.stderr.off("data", inspect);
          resolve();
        }
      };
      child.stdout.on("data", inspect);
      child.stderr.on("data", inspect);
      child.once("error", reject);
      child.once("exit", (code) => reject(new HarnessError("SERVER_EXITED", `Server exited before readiness with code ${code}`, this.monitor.tail(80))));
    });
    try {
      await withTimeout(readiness, (this.spec.startupTimeoutSeconds ?? 180) * 1000, "server startup");
    } catch (error) {
      await this.forceStop();
      throw error;
    }
  }

  public command(command: string): void {
    if (!this.running || !this.process) throw new HarnessError("SERVER_NOT_RUNNING", "Cannot execute a command while server is stopped");
    this.process.stdin.write(`${command}\n`);
  }

  public async stop(): Promise<void> {
    if (!this.process || this.process.exitCode !== null) return;
    const child = this.process;
    const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
    child.stdin.write("stop\n");
    try {
      await withTimeout(exited, (this.spec.shutdownTimeoutSeconds ?? 30) * 1000, "server shutdown");
    } catch (error) {
      await this.forceStop();
      throw error;
    } finally {
      this.monitor.flush();
    }
  }

  public async forceStop(): Promise<void> {
    if (!this.process || this.process.exitCode !== null) return;
    const child = this.process;
    const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
    child.kill("SIGKILL");
    await withTimeout(exited, 10_000, "forced server shutdown").catch(() => undefined);
    this.monitor.flush();
  }

  public async closeLog(): Promise<void> {
    if (this.logClosed) return;
    this.logClosed = true;
    await new Promise<void>((resolveClose) => this.logStream.end(resolveClose));
  }

  public async writeStandardFiles(port: number): Promise<void> {
    const properties: Record<string, string | number | boolean> = {
      "enable-status": true,
      "network-compression-threshold": -1,
      "spawn-protection": 0,
      "view-distance": 4,
      "simulation-distance": 4,
      "max-players": 32,
      "level-seed": "ouroboros-harness",
      "motd": "Ouroboros Fabric Test Harness",
      ...this.spec.properties,
      "server-port": port,
      "server-ip": "127.0.0.1",
      "online-mode": false,
      "enforce-secure-profile": false,
      "enable-rcon": false,
    };
    const text = Object.entries(properties).map(([key, value]) => `${key}=${String(value)}`).join("\n") + "\n";
    await writeFile(join(this.directory, "eula.txt"), "eula=true\n", "utf8");
    await writeFile(join(this.directory, "server.properties"), text, "utf8");
  }
}
