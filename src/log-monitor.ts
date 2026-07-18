import type { LogFinding } from "./types.js";

interface LogRule {
  id: string;
  severity: "warning" | "error";
  pattern: RegExp;
  ignore?: RegExp;
}

const DEFAULT_RULES: LogRule[] = [
  { id: "error-line", severity: "error", pattern: /\b(?:ERROR|FATAL)\b/i, ignore: /0 errors?|error rate[:=]\s*0/i },
  {
    id: "stack-trace",
    severity: "error",
    pattern: /^\s*(?:at\s+[\w.$]+\(|Caused by:|Suppressed:)/,
  },
  { id: "uncaught-exception", severity: "error", pattern: /(?:uncaught|unhandled).*(?:exception|error)/i },
  { id: "watchdog", severity: "error", pattern: /watchdog|server has not responded|server thread.*(?:hung|stalled)/i },
  { id: "thread-violation", severity: "error", pattern: /wrong thread|thread[- ]check|not on (?:the )?server thread|concurrentmodificationexception/i },
  { id: "crash", severity: "error", pattern: /crash report|encountered an unexpected exception|failed to start/i },
];

export class LogMonitor {
  public readonly lines: string[] = [];
  public readonly findings: LogFinding[] = [];
  private partial = "";

  public accept(chunk: string | Buffer): void {
    const value = this.partial + chunk.toString();
    const lines = value.split(/\r?\n/);
    this.partial = lines.pop() ?? "";
    for (const line of lines) this.acceptLine(line);
  }

  public flush(): void {
    if (this.partial) this.acceptLine(this.partial);
    this.partial = "";
  }

  public count(pattern: RegExp): number {
    return this.lines.filter((line) => pattern.test(line)).length;
  }

  public tail(count = 100): string[] {
    return this.lines.slice(-count);
  }

  private acceptLine(line: string): void {
    this.lines.push(line);
    for (const rule of DEFAULT_RULES) {
      if (rule.id === "stack-trace" && this.isBenignClosedChannelFrame(line)) continue;
      if (rule.pattern.test(line) && !rule.ignore?.test(line)) {
        this.findings.push({ rule: rule.id, severity: rule.severity, line, lineNumber: this.lines.length });
      }
    }
  }

  private isBenignClosedChannelFrame(line: string): boolean {
    if (!/^\s*at io\.netty\.channel\.[\w$]+\.\w+\([^)]*\)\(Unknown Source\)$/.test(line)) return false;
    const previous = this.lines.at(-2) ?? "";
    return /^io\.netty\.channel\.StacklessClosedChannelException$/.test(previous);
  }
}
