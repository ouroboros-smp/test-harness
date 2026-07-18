import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { assertReportSchema } from "./schema.js";
import type { ScenarioReport } from "./types.js";

function xml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

export async function writeReport(report: ScenarioReport, directory: string): Promise<Record<string, string>> {
  const reportPath = join(directory, "report.json");
  const junitPath = join(directory, "junit.xml");
  const summaryPath = join(directory, "summary.md");
  const paths = { report: reportPath, junit: junitPath, summary: summaryPath };
  Object.assign(report.artifacts, paths);
  assertReportSchema(report);
  await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n", "utf8");

  const failures = report.steps.filter((step) => step.status === "failed");
  const cases = report.steps.map((step) => {
    const failure = step.error ? `<failure message="${xml(step.error.split("\n")[0] ?? "step failed")}">${xml(step.error)}</failure>` : "";
    const skipped = step.status === "skipped" ? "<skipped/>" : "";
    return `  <testcase classname="${xml(report.scenario.id)}" name="${xml(step.name)}" time="${(step.durationMs / 1000).toFixed(3)}">${failure}${skipped}</testcase>`;
  }).join("\n");
  const junit = `<?xml version="1.0" encoding="UTF-8"?>\n<testsuite name="${xml(report.scenario.id)}" tests="${report.steps.length}" failures="${failures.length}" skipped="${report.steps.filter((step) => step.status === "skipped").length}" time="${(report.durationMs / 1000).toFixed(3)}">\n${cases}\n</testsuite>\n`;
  await writeFile(junitPath, junit, "utf8");

  const lines = [
    `# ${report.scenario.title}`,
    "",
    `- Status: **${report.status.toUpperCase()}**`,
    `- Scenario: \`${report.scenario.id}\``,
    `- Issues: ${report.scenario.issues.map((issue) => `#${issue}`).join(", ")}`,
    `- Duration: ${(report.durationMs / 1000).toFixed(2)}s`,
    `- Steps: ${report.steps.filter((step) => step.status === "passed").length} passed, ${failures.length} failed`,
    `- Global log findings: ${report.findings.length}`,
    "",
    ...(report.failureSummary ? ["## Failure", "", "```text", report.failureSummary, "```", ""] : []),
    "## Steps",
    "",
    ...report.steps.map((step) => `- ${step.status === "passed" ? "✅" : step.status === "failed" ? "❌" : "⏭️"} ${step.name} (${step.durationMs}ms)`),
    "",
  ];
  await writeFile(summaryPath, lines.join("\n"), "utf8");
  return paths;
}
