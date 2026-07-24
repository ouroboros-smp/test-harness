export class HarnessError extends Error {
  public readonly code: string;
  public readonly details?: unknown;

  public constructor(code: string, message: string, details?: unknown) {
    super(message);
    this.name = "HarnessError";
    this.code = code;
    this.details = details;
  }
}

export class TimeoutError extends HarnessError {
  public constructor(operation: string, timeoutMs: number) {
    super("TIMEOUT", `${operation} timed out after ${timeoutMs}ms`, { operation, timeoutMs });
    this.name = "TimeoutError";
  }
}

export function errorMessage(error: unknown): string {
  if (error instanceof HarnessError && error.details !== undefined) {
    return `${error.stack ?? error.message}\nDetails: ${JSON.stringify(error.details)}`;
  }
  if (error instanceof Error) return error.stack ?? error.message;
  return String(error);
}
