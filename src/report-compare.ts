import type { ScenarioReport } from "./types.js";

// Two runs of one scenario agree semantically when they walk the same steps to
// the same outcomes. Run-specific noise (timestamps, durations, ports, run ids,
// artifact paths, evidence values) is deliberately excluded.
export interface SemanticStepView {
  id: string;
  name: string;
  status: string;
  failed: boolean;
  evidenceKeys: string[];
}

export interface SemanticReportView {
  scenarioId: string;
  scenarioTitle: string;
  issues: number[];
  status: string;
  exitCode: number;
  findings: number;
  steps: SemanticStepView[];
}

export function semanticReportView(report: ScenarioReport): SemanticReportView {
  return {
    scenarioId: report.scenario.id,
    scenarioTitle: report.scenario.title,
    issues: [...report.scenario.issues].sort((a, b) => a - b),
    status: report.status,
    exitCode: report.exitCode,
    findings: report.findings.length,
    steps: report.steps.map((step) => ({
      id: step.id,
      name: step.name,
      status: step.status,
      failed: step.error !== undefined,
      evidenceKeys: Object.keys(step.evidence).sort(),
    })),
  };
}

export function compareScenarioReports(left: ScenarioReport, right: ScenarioReport): string[] {
  const differences: string[] = [];
  const a = semanticReportView(left);
  const b = semanticReportView(right);
  const field = (name: string, x: unknown, y: unknown) => {
    if (JSON.stringify(x) !== JSON.stringify(y)) differences.push(`${name}: ${JSON.stringify(x)} != ${JSON.stringify(y)}`);
  };
  field("scenario.id", a.scenarioId, b.scenarioId);
  field("scenario.title", a.scenarioTitle, b.scenarioTitle);
  field("scenario.issues", a.issues, b.issues);
  field("status", a.status, b.status);
  field("exitCode", a.exitCode, b.exitCode);
  field("findings", a.findings, b.findings);
  field("steps.length", a.steps.length, b.steps.length);
  const shared = Math.min(a.steps.length, b.steps.length);
  for (let index = 0; index < shared; index++) {
    const left_ = a.steps[index]!;
    const right_ = b.steps[index]!;
    field(`steps[${index}].id`, left_.id, right_.id);
    field(`steps[${index}].name`, left_.name, right_.name);
    field(`steps[${index}].status`, left_.status, right_.status);
    field(`steps[${index}].failed`, left_.failed, right_.failed);
    field(`steps[${index}].evidenceKeys`, left_.evidenceKeys, right_.evidenceKeys);
  }
  return differences;
}
