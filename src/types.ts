export const SUPPORTED_SCHEMA_VERSION = 1 as const;

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export interface FabricPins {
  minecraft: string;
  loader: string;
  fabricApi: string;
  installer: string;
  java: number;
  protocol: number;
}

export interface ArtifactSpec {
  required?: boolean;
  description?: string;
  path?: string;
  url?: string;
  sha256?: string;
  destination?: "mods" | "root" | "none";
}

export interface ClientSpec {
  name: string;
  username: string;
  gameMode?: "survival" | "creative" | "adventure" | "spectator";
  connectOnStart?: boolean;
}

export interface ServerSpec {
  memoryMb?: number;
  startupTimeoutSeconds?: number;
  shutdownTimeoutSeconds?: number;
  commandTimeoutSeconds?: number;
  reuseWorldOnRestart?: boolean;
  properties?: Record<string, string | number | boolean>;
  jvmArgs?: string[];
  allowedLogPatterns?: string[];
  controlBridge?: boolean;
}

export interface HarnessAction {
  type: string;
  [key: string]: JsonValue | undefined;
}

export interface HarnessAssertion {
  type: string;
  [key: string]: JsonValue | undefined;
}

export interface ScenarioStep {
  id: string;
  name: string;
  timeoutSeconds?: number;
  actions?: HarnessAction[];
  assertions?: HarnessAssertion[];
  always?: boolean;
}

export interface Scenario {
  schemaVersion: typeof SUPPORTED_SCHEMA_VERSION;
  id: string;
  title: string;
  description?: string;
  issues: number[];
  tags?: string[];
  pins?: Partial<FabricPins>;
  artifacts?: Record<string, ArtifactSpec>;
  clients?: ClientSpec[];
  server?: ServerSpec;
  variables?: Record<string, JsonPrimitive>;
  ports?: string[];
  steps: ScenarioStep[];
}

export interface StepResult {
  id: string;
  name: string;
  status: "passed" | "failed" | "skipped";
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  error?: string;
  evidence: Record<string, JsonValue>;
}

export interface LogFinding {
  rule: string;
  severity: "warning" | "error";
  line: string;
  lineNumber: number;
}

export interface PerformanceSummary {
  samples: number;
  tps?: number;
  mspt?: {
    p50: number;
    p95: number;
    p99: number;
    max: number;
  };
  errorLines: number;
  errorsPerMinute: number;
}

export interface ScenarioReport {
  schemaVersion: 1;
  runId: string;
  scenario: { id: string; title: string; issues: number[] };
  pins: FabricPins;
  status: "passed" | "failed";
  exitCode: 0 | 1;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  steps: StepResult[];
  findings: LogFinding[];
  performance?: PerformanceSummary;
  artifacts: Record<string, string>;
  failureSummary?: string;
}

export interface RunOptions {
  artifacts: Record<string, string>;
  output?: string;
  cache?: string;
  dryRun: boolean;
  keepRunDirectory: boolean;
  verbose: boolean;
}

export interface CommandResult {
  command: string;
  output: string[];
}

export interface PortfolioCommandSpec {
  name: string;
  command: string[];
  base?: "repository" | "harness";
  java?: number;
  environment?: Record<string, string | number | boolean>;
  timeoutMinutes?: number;
}

export interface PortfolioArtifactSpec {
  path: string;
  base?: "repository" | "harness";
}

export interface PortfolioTargetSpec {
  id: string;
  title: string;
  repository: string;
  testedVersion?: string;
  build: PortfolioCommandSpec[];
  artifacts?: Record<string, PortfolioArtifactSpec>;
  variables?: Record<string, JsonPrimitive>;
  scenarios: string[];
}

export interface PortfolioManifest {
  schemaVersion: 1;
  title: string;
  variables?: Record<string, JsonPrimitive>;
  targets: PortfolioTargetSpec[];
}

export interface PortfolioBuildResult {
  name: string;
  command: string[];
  status: "passed" | "failed";
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  log: string;
  error?: string;
}

export interface PortfolioScenarioResult {
  id: string;
  title: string;
  status: "passed" | "failed" | "skipped";
  durationMs: number;
  issues: number[];
  report?: string;
  html?: string;
  error?: string;
}

export interface PortfolioTargetResult {
  id: string;
  title: string;
  repository: string;
  status: "passed" | "failed";
  durationMs: number;
  builds: PortfolioBuildResult[];
  scenarios: PortfolioScenarioResult[];
}

export interface PortfolioReport {
  schemaVersion: 1;
  title: string;
  status: "passed" | "failed";
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  targets: PortfolioTargetResult[];
  artifacts: Record<string, string>;
}

export type ProductionModOwner = "first-party" | "third-party";

export type ProductionModBucket =
  | "first-party"
  | "critical-dependency"
  | "gameplay"
  | "performance"
  | "protocol-infrastructure"
  | "operational";

export interface ProductionModSpec {
  id: string;
  title: string;
  modId: string;
  owner: ProductionModOwner;
  bucket: ProductionModBucket;
  enabled: boolean;
  version?: string;
  file?: string;
  filePattern?: string;
  repository?: string;
  portfolioTarget?: string;
  obligations: string[];
  touchpoints?: string[];
}

export interface ProductionManifest {
  schemaVersion: 1;
  title: string;
  platform: "fabric";
  minecraft: string;
  loader: string;
  environmentDeltas?: string[];
  mods: ProductionModSpec[];
}

export interface ProductionManifestFinding {
  severity: "error" | "warning";
  code: string;
  mod?: string;
  message: string;
}

export interface ProductionManifestAudit {
  ok: boolean;
  manifest: string;
  platform: string;
  minecraft: string;
  loader: string;
  enabledMods: number;
  firstPartyMods: number;
  thirdPartyMods: number;
  findings: ProductionManifestFinding[];
}

export interface RaidSafetyBlocker {
  issue: string;
  reason: string;
}

export interface RaidSafetyScenarioReference {
  id: string;
  bindings: Record<string, string>;
}

export interface RaidSafetyMatrixEntry {
  id: string;
  title: string;
  status: "executable" | "blocked";
  artifacts: string[];
  scenarios: RaidSafetyScenarioReference[];
  proves: string[];
  limitations?: string[];
  blockers?: RaidSafetyBlocker[];
}

export interface RaidSafetyMatrix {
  schemaVersion: 1;
  title: string;
  issue: string;
  production: {
    manifest: string;
    portfolio: string;
    requiredArtifacts: string[];
  };
  foundations: RaidSafetyMatrixEntry[];
  acceptance: RaidSafetyMatrixEntry[];
}

export interface RaidSafetyMatrixFinding {
  severity: "error" | "blocker";
  code: string;
  message: string;
  entry?: string;
  artifact?: string;
}

export interface RaidSafetyMatrixAudit {
  valid: boolean;
  ready: boolean;
  title: string;
  executableFoundations: number;
  executableAcceptance: number;
  acceptanceCases: number;
  blockedCases: string[];
  findings: RaidSafetyMatrixFinding[];
}
