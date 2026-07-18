import { writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";
import { assertReportSchema } from "./schema.js";
import type { ScenarioReport, StepResult } from "./types.js";

const STATUS_ICON = { passed: "✅", failed: "❌", skipped: "⏭️" } as const;

function escapeHtml(value: unknown): string {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function xml(value: string): string {
  return escapeHtml(value);
}

function markdown(value: unknown): string {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\\", "\\\\")
    .replaceAll("|", "\\|")
    .replaceAll("`", "\\`")
    .replaceAll("\n", "<br>");
}

function formatDuration(milliseconds: number): string {
  if (milliseconds < 1_000) return `${Math.round(milliseconds)}ms`;
  if (milliseconds < 60_000) return `${(milliseconds / 1_000).toFixed(milliseconds < 10_000 ? 2 : 1)}s`;
  const minutes = Math.floor(milliseconds / 60_000);
  const seconds = Math.round((milliseconds % 60_000) / 1_000);
  return `${minutes}m ${seconds}s`;
}

function formatTimestamp(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(value)) + " UTC";
}

function formatMetric(value: number | undefined, suffix = ""): string {
  return value === undefined ? "—" : `${Number(value.toFixed(3))}${suffix}`;
}

function artifactHref(directory: string, target: string): string | undefined {
  const value = relative(directory, target);
  if (!value) return "./";
  if (value === ".." || value.startsWith(`..${sep}`) || isAbsolute(value)) return undefined;
  return value.split(sep).map((part) => encodeURIComponent(part)).join("/");
}

function artifactLabel(name: string): string {
  const knownLabels: Record<string, string> = {
    html: "HTML report",
    junit: "JUnit XML",
    report: "JSON report",
    summary: "Markdown summary",
    directory: "Evidence directory",
  };
  if (knownLabels[name]) return knownLabels[name];
  return name.replaceAll(/[-_]+/g, " ").replace(/^./, (character) => character.toUpperCase());
}

function evidenceJson(step: StepResult): string {
  return JSON.stringify(step.evidence, null, 2);
}

export function renderMarkdownReport(report: ScenarioReport, directory: string): string {
  const passed = report.steps.filter((step) => step.status === "passed").length;
  const failed = report.steps.filter((step) => step.status === "failed").length;
  const skipped = report.steps.filter((step) => step.status === "skipped").length;
  const performance = report.performance;
  const lines = [
    `# ${STATUS_ICON[report.status]} ${markdown(report.scenario.title)}`,
    "",
    `> **${report.status.toUpperCase()}** · ${formatDuration(report.durationMs)} · ${passed}/${report.steps.length} steps passed`,
    "",
    "| Run | Result |",
    "|---|---|",
    `| Scenario | \`${markdown(report.scenario.id)}\` |`,
    `| Issues | ${report.scenario.issues.map((issue) => `#${issue}`).join(", ")} |`,
    `| Steps | ${passed} passed · ${failed} failed · ${skipped} skipped |`,
    `| Log findings | ${report.findings.length} |`,
    `| Started | ${formatTimestamp(report.startedAt)} |`,
    `| Finished | ${formatTimestamp(report.finishedAt)} |`,
    `| Run ID | \`${markdown(report.runId)}\` |`,
    "",
  ];

  if (report.failureSummary) {
    lines.push("## Failure", "", "```text", report.failureSummary, "```", "");
  }

  if (performance) {
    lines.push(
      "## Performance",
      "",
      "| Samples | TPS | MSPT p50 | MSPT p95 | MSPT p99 | MSPT max | Errors/min |",
      "|---:|---:|---:|---:|---:|---:|---:|",
      `| ${performance.samples} | ${formatMetric(performance.tps)} | ${formatMetric(performance.mspt?.p50, "ms")} | ${formatMetric(performance.mspt?.p95, "ms")} | ${formatMetric(performance.mspt?.p99, "ms")} | ${formatMetric(performance.mspt?.max, "ms")} | ${formatMetric(performance.errorsPerMinute)} |`,
      "",
    );
  }

  lines.push("## Steps", "");
  for (const [index, step] of report.steps.entries()) {
    lines.push(
      `### ${STATUS_ICON[step.status]} ${index + 1}. ${markdown(step.name)}`,
      "",
      `- ID: \`${markdown(step.id)}\``,
      `- Status: **${step.status.toUpperCase()}**`,
      `- Duration: ${formatDuration(step.durationMs)}`,
    );
    if (step.error) lines.push("", "```text", step.error, "```");
    const keys = Object.keys(step.evidence);
    if (keys.length) {
      lines.push(
        "",
        `<details><summary>Evidence (${keys.length} ${keys.length === 1 ? "entry" : "entries"})</summary>`,
        "",
        "```json",
        evidenceJson(step),
        "```",
        "</details>",
      );
    }
    lines.push("");
  }

  lines.push("## Log findings", "");
  if (report.findings.length) {
    lines.push("| Severity | Rule | Line | Message |", "|---|---|---:|---|");
    for (const finding of report.findings) {
      lines.push(`| ${finding.severity.toUpperCase()} | \`${markdown(finding.rule)}\` | ${finding.lineNumber} | ${markdown(finding.line)} |`);
    }
  } else {
    lines.push("No global log findings.");
  }

  lines.push("", "## Runtime pins", "", "| Minecraft | Loader | Fabric API | Installer | Java | Protocol |", "|---|---|---|---|---:|---:|", `| ${markdown(report.pins.minecraft)} | ${markdown(report.pins.loader)} | ${markdown(report.pins.fabricApi)} | ${markdown(report.pins.installer)} | ${report.pins.java} | ${report.pins.protocol} |`, "", "## Artifacts", "");
  for (const [name, target] of Object.entries(report.artifacts).sort(([left], [right]) => left.localeCompare(right))) {
    const href = artifactHref(directory, target);
    lines.push(href ? `- [${artifactLabel(name)}](${href})` : `- ${artifactLabel(name)}: \`${markdown(target)}\``);
  }
  lines.push("");
  return lines.join("\n");
}

export function renderHtmlReport(report: ScenarioReport, directory: string): string {
  const passed = report.steps.filter((step) => step.status === "passed").length;
  const failed = report.steps.filter((step) => step.status === "failed").length;
  const skipped = report.steps.filter((step) => step.status === "skipped").length;
  const performance = report.performance;
  const stepCards = report.steps.map((step, index) => {
    const keys = Object.keys(step.evidence);
    return `<article class="step step-${step.status}" data-status="${step.status}">
      <div class="step-marker" aria-hidden="true">${step.status === "passed" ? "✓" : step.status === "failed" ? "×" : "–"}</div>
      <div class="step-content">
        <div class="step-heading">
          <div><span class="step-number">Step ${index + 1}</span><h3>${escapeHtml(step.name)}</h3><code>${escapeHtml(step.id)}</code></div>
          <div class="step-meta"><span class="badge badge-${step.status}">${step.status}</span><strong>${formatDuration(step.durationMs)}</strong></div>
        </div>
        ${step.error ? `<div class="error-box"><strong>Failure</strong><pre>${escapeHtml(step.error)}</pre></div>` : ""}
        ${keys.length ? `<details><summary>Evidence <span>${keys.length} ${keys.length === 1 ? "entry" : "entries"}</span></summary><pre>${escapeHtml(evidenceJson(step))}</pre></details>` : `<p class="muted evidence-empty">No step evidence recorded.</p>`}
      </div>
    </article>`;
  }).join("\n");

  const findingRows = report.findings.map((finding) => `<tr><td><span class="badge badge-${finding.severity === "error" ? "failed" : "skipped"}">${escapeHtml(finding.severity)}</span></td><td><code>${escapeHtml(finding.rule)}</code></td><td>${finding.lineNumber}</td><td><pre>${escapeHtml(finding.line)}</pre></td></tr>`).join("\n");
  const artifacts = Object.entries(report.artifacts).sort(([left], [right]) => left.localeCompare(right)).map(([name, target]) => {
    const href = artifactHref(directory, target);
    return `<li>${href ? `<a href="${escapeHtml(href)}">${escapeHtml(artifactLabel(name))}<span aria-hidden="true">↗</span></a>` : `<span>${escapeHtml(artifactLabel(name))}</span>`}<code>${escapeHtml(href ?? target)}</code></li>`;
  }).join("\n");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <title>${escapeHtml(report.scenario.title)} · Harness report</title>
  <style>
    :root { color-scheme: light dark; --bg:#f5f7fb; --surface:#fff; --surface-2:#f1f5f9; --text:#172033; --muted:#667085; --border:#d9e0ea; --pass:#18794e; --pass-bg:#e8f7ef; --fail:#c43232; --fail-bg:#fff0f0; --skip:#8a5b12; --skip-bg:#fff7df; --accent:#3157d5; --shadow:0 8px 30px rgba(23,32,51,.08); }
    @media (prefers-color-scheme: dark) { :root { --bg:#0c111b; --surface:#151c29; --surface-2:#1c2636; --text:#ecf1f8; --muted:#a6b1c2; --border:#2d3a4f; --pass:#6ee7a8; --pass-bg:#123c2a; --fail:#ff8e8e; --fail-bg:#481d22; --skip:#ffd37a; --skip-bg:#493718; --accent:#91a7ff; --shadow:0 10px 35px rgba(0,0,0,.28); } }
    * { box-sizing:border-box; } body { margin:0; background:var(--bg); color:var(--text); font:15px/1.55 Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; } a { color:var(--accent); } code,pre { font-family:"SFMono-Regular",Consolas,"Liberation Mono",monospace; } code { font-size:.88em; background:var(--surface-2); border:1px solid var(--border); border-radius:5px; padding:.13rem .35rem; } pre { margin:.7rem 0 0; white-space:pre-wrap; overflow-wrap:anywhere; }
    .page { max-width:1120px; margin:0 auto; padding:40px 24px 64px; } .hero { position:relative; overflow:hidden; background:var(--surface); border:1px solid var(--border); border-radius:20px; padding:32px; box-shadow:var(--shadow); } .hero::before { content:""; position:absolute; inset:0 auto 0 0; width:7px; background:${report.status === "passed" ? "var(--pass)" : "var(--fail)"}; } .eyebrow { color:var(--muted); font-weight:700; letter-spacing:.08em; text-transform:uppercase; font-size:.72rem; } h1 { margin:.35rem 0 .5rem; font-size:clamp(1.8rem,4vw,2.75rem); line-height:1.15; } .subtitle { color:var(--muted); display:flex; gap:.65rem; align-items:center; flex-wrap:wrap; } .status { display:inline-flex; align-items:center; gap:.45rem; border-radius:999px; padding:.35rem .75rem; font-weight:800; text-transform:uppercase; font-size:.78rem; background:${report.status === "passed" ? "var(--pass-bg)" : "var(--fail-bg)"}; color:${report.status === "passed" ? "var(--pass)" : "var(--fail)"}; }
    .stats { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:14px; margin:20px 0 0; } .stat { background:var(--surface-2); border:1px solid var(--border); border-radius:13px; padding:16px; } .stat span { display:block; color:var(--muted); font-size:.78rem; text-transform:uppercase; letter-spacing:.05em; font-weight:700; } .stat strong { display:block; margin-top:.2rem; font-size:1.35rem; }
    section { margin-top:30px; } .section-head { display:flex; align-items:end; justify-content:space-between; gap:16px; margin-bottom:12px; } h2 { margin:0; font-size:1.35rem; } .muted { color:var(--muted); } .panel { background:var(--surface); border:1px solid var(--border); border-radius:16px; box-shadow:var(--shadow); overflow:hidden; } .failure { padding:20px; border-left:6px solid var(--fail); background:var(--fail-bg); } .failure h2 { color:var(--fail); } .failure pre { max-height:420px; overflow:auto; }
    .performance { display:grid; grid-template-columns:repeat(6,minmax(0,1fr)); gap:1px; background:var(--border); } .performance div { background:var(--surface); padding:18px; } .performance span { color:var(--muted); display:block; font-size:.78rem; } .performance strong { display:block; margin-top:.2rem; font-size:1.15rem; }
    .filters { display:flex; gap:8px; flex-wrap:wrap; } button { appearance:none; border:1px solid var(--border); background:var(--surface); color:var(--text); border-radius:999px; padding:.38rem .75rem; cursor:pointer; font:inherit; } button[aria-pressed="true"] { color:#fff; background:var(--accent); border-color:var(--accent); } .steps { display:grid; gap:12px; } .step { display:grid; grid-template-columns:42px 1fr; gap:14px; background:var(--surface); border:1px solid var(--border); border-radius:15px; padding:18px; box-shadow:var(--shadow); } .step[hidden] { display:none; } .step-marker { width:34px; height:34px; display:grid; place-items:center; border-radius:50%; font-size:1.2rem; font-weight:900; } .step-passed .step-marker { background:var(--pass-bg); color:var(--pass); } .step-failed .step-marker { background:var(--fail-bg); color:var(--fail); } .step-skipped .step-marker { background:var(--skip-bg); color:var(--skip); } .step-heading { display:flex; justify-content:space-between; gap:20px; } .step-heading h3 { display:inline; margin:.15rem .5rem .15rem 0; font-size:1rem; } .step-number { display:block; color:var(--muted); font-size:.72rem; font-weight:700; text-transform:uppercase; } .step-meta { text-align:right; white-space:nowrap; } .step-meta strong { display:block; margin-top:.3rem; } .badge { display:inline-block; border-radius:999px; padding:.18rem .5rem; text-transform:uppercase; font-size:.68rem; font-weight:800; } .badge-passed { background:var(--pass-bg); color:var(--pass); } .badge-failed { background:var(--fail-bg); color:var(--fail); } .badge-skipped { background:var(--skip-bg); color:var(--skip); } details { margin-top:14px; border-top:1px solid var(--border); padding-top:12px; } summary { cursor:pointer; font-weight:700; } summary span { color:var(--muted); font-weight:400; } details pre { background:var(--surface-2); border-radius:10px; padding:14px; max-height:420px; overflow:auto; } .error-box { margin-top:14px; border-radius:10px; padding:14px; background:var(--fail-bg); color:var(--fail); } .evidence-empty { margin-bottom:0; }
    table { width:100%; border-collapse:collapse; } th,td { padding:12px 14px; border-bottom:1px solid var(--border); text-align:left; vertical-align:top; } th { color:var(--muted); font-size:.75rem; text-transform:uppercase; } tr:last-child td { border-bottom:0; } td pre { margin:0; } .pin-grid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); } .pin-grid div { padding:16px; border-right:1px solid var(--border); border-bottom:1px solid var(--border); } .pin-grid div:nth-child(3n) { border-right:0; } .pin-grid div:nth-last-child(-n+3) { border-bottom:0; } .pin-grid span { color:var(--muted); display:block; font-size:.75rem; } .pin-grid strong { display:block; margin-top:.15rem; }
    .artifact-list { list-style:none; margin:0; padding:0; } .artifact-list li { display:grid; grid-template-columns:minmax(160px,240px) 1fr; gap:18px; padding:12px 16px; border-bottom:1px solid var(--border); align-items:center; } .artifact-list li:last-child { border:0; } .artifact-list a { font-weight:700; text-decoration:none; display:flex; justify-content:space-between; } .artifact-list code { overflow-wrap:anywhere; } footer { margin-top:30px; color:var(--muted); font-size:.82rem; text-align:center; }
    @media (max-width:820px) { .stats { grid-template-columns:repeat(2,1fr); } .performance { grid-template-columns:repeat(3,1fr); } .pin-grid { grid-template-columns:repeat(2,1fr); } .pin-grid div:nth-child(3n) { border-right:1px solid var(--border); } .pin-grid div:nth-child(2n) { border-right:0; } .pin-grid div:nth-last-child(-n+3) { border-bottom:1px solid var(--border); } .pin-grid div:nth-last-child(-n+2) { border-bottom:0; } }
    @media (max-width:560px) { .page { padding:18px 12px 40px; } .hero { padding:24px 20px; } .stats,.performance,.pin-grid { grid-template-columns:1fr; } .pin-grid div { border-right:0!important; border-bottom:1px solid var(--border)!important; } .pin-grid div:last-child { border-bottom:0!important; } .step { grid-template-columns:1fr; } .step-heading { display:block; } .step-meta { text-align:left; margin-top:10px; } .artifact-list li { grid-template-columns:1fr; gap:6px; } }
    @media print { :root { color-scheme:light; } body { background:#fff; } .page { max-width:none; padding:0; } .hero,.panel,.step { box-shadow:none; break-inside:avoid; } .filters { display:none; } details:not([open]) > *:not(summary) { display:block; } }
  </style>
</head>
<body>
  <main class="page">
    <header class="hero">
      <div class="eyebrow">Ouroboros Fabric test harness</div>
      <h1>${escapeHtml(report.scenario.title)}</h1>
      <div class="subtitle"><span class="status">${report.status === "passed" ? "✓" : "×"} ${escapeHtml(report.status)}</span><code>${escapeHtml(report.scenario.id)}</code><span>Issues ${report.scenario.issues.map((issue) => `#${issue}`).join(", ")}</span></div>
      <div class="stats">
        <div class="stat"><span>Duration</span><strong>${formatDuration(report.durationMs)}</strong></div>
        <div class="stat"><span>Passed steps</span><strong>${passed} / ${report.steps.length}</strong></div>
        <div class="stat"><span>Failed / skipped</span><strong>${failed} / ${skipped}</strong></div>
        <div class="stat"><span>Log findings</span><strong>${report.findings.length}</strong></div>
      </div>
    </header>

    ${report.failureSummary ? `<section class="panel failure" role="alert"><h2>Failure summary</h2><pre>${escapeHtml(report.failureSummary)}</pre></section>` : ""}

    ${performance ? `<section><div class="section-head"><div><h2>Performance</h2><div class="muted">${performance.samples} samples · ${performance.errorLines} error lines</div></div></div><div class="panel performance">
      <div><span>TPS</span><strong>${formatMetric(performance.tps)}</strong></div><div><span>MSPT p50</span><strong>${formatMetric(performance.mspt?.p50, "ms")}</strong></div><div><span>MSPT p95</span><strong>${formatMetric(performance.mspt?.p95, "ms")}</strong></div><div><span>MSPT p99</span><strong>${formatMetric(performance.mspt?.p99, "ms")}</strong></div><div><span>MSPT max</span><strong>${formatMetric(performance.mspt?.max, "ms")}</strong></div><div><span>Errors / min</span><strong>${formatMetric(performance.errorsPerMinute)}</strong></div>
    </div></section>` : ""}

    <section>
      <div class="section-head"><div><h2>Steps</h2><div class="muted">Execution order, timing, failures, and evidence</div></div><div class="filters" aria-label="Filter steps"><button type="button" data-filter="all" aria-pressed="true">All ${report.steps.length}</button><button type="button" data-filter="failed" aria-pressed="false">Failed ${failed}</button><button type="button" data-filter="passed" aria-pressed="false">Passed ${passed}</button><button type="button" data-filter="skipped" aria-pressed="false">Skipped ${skipped}</button></div></div>
      <div class="steps">${stepCards}</div>
    </section>

    <section><div class="section-head"><div><h2>Log findings</h2><div class="muted">Global rules evaluated independently of scenario assertions</div></div></div><div class="panel">${report.findings.length ? `<table><thead><tr><th>Severity</th><th>Rule</th><th>Line</th><th>Message</th></tr></thead><tbody>${findingRows}</tbody></table>` : `<p class="muted" style="padding:18px;margin:0">No global log findings.</p>`}</div></section>

    <section><div class="section-head"><div><h2>Runtime pins</h2><div class="muted">Exact environment used for this run</div></div></div><div class="panel pin-grid">
      <div><span>Minecraft</span><strong>${escapeHtml(report.pins.minecraft)}</strong></div><div><span>Fabric Loader</span><strong>${escapeHtml(report.pins.loader)}</strong></div><div><span>Fabric API</span><strong>${escapeHtml(report.pins.fabricApi)}</strong></div><div><span>Installer</span><strong>${escapeHtml(report.pins.installer)}</strong></div><div><span>Java</span><strong>${report.pins.java}</strong></div><div><span>Protocol</span><strong>${report.pins.protocol}</strong></div>
    </div></section>

    <section><div class="section-head"><div><h2>Artifacts</h2><div class="muted">Portable links work inside the downloaded artifact bundle</div></div></div><div class="panel"><ul class="artifact-list">${artifacts}</ul></div></section>
    <footer>Run <code>${escapeHtml(report.runId)}</code><br>${escapeHtml(formatTimestamp(report.startedAt))} → ${escapeHtml(formatTimestamp(report.finishedAt))}</footer>
  </main>
  <script>
    for (const button of document.querySelectorAll("[data-filter]")) button.addEventListener("click", () => {
      const filter = button.dataset.filter;
      for (const candidate of document.querySelectorAll("[data-filter]")) candidate.setAttribute("aria-pressed", String(candidate === button));
      for (const step of document.querySelectorAll("[data-status]")) step.hidden = filter !== "all" && step.dataset.status !== filter;
    });
  </script>
</body>
</html>\n`;
}

export async function writeReport(report: ScenarioReport, directory: string): Promise<Record<string, string>> {
  const reportPath = join(directory, "report.json");
  const junitPath = join(directory, "junit.xml");
  const summaryPath = join(directory, "summary.md");
  const htmlPath = join(directory, "report.html");
  const paths = { report: reportPath, html: htmlPath, junit: junitPath, summary: summaryPath };
  Object.assign(report.artifacts, paths);
  assertReportSchema(report);
  await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n", "utf8");

  const failures = report.steps.filter((step) => step.status === "failed");
  const cases = report.steps.map((step) => {
    const failure = step.error ? `<failure message="${xml(step.error.split("\n")[0] ?? "step failed")}">${xml(step.error)}</failure>` : "";
    const skipped = step.status === "skipped" ? "<skipped/>" : "";
    return `  <testcase classname="${xml(report.scenario.id)}" name="${xml(step.name)}" time="${(step.durationMs / 1_000).toFixed(3)}">${failure}${skipped}</testcase>`;
  }).join("\n");
  const junit = `<?xml version="1.0" encoding="UTF-8"?>\n<testsuite name="${xml(report.scenario.id)}" tests="${report.steps.length}" failures="${failures.length}" skipped="${report.steps.filter((step) => step.status === "skipped").length}" time="${(report.durationMs / 1_000).toFixed(3)}">\n${cases}\n</testsuite>\n`;
  await writeFile(junitPath, junit, "utf8");
  await writeFile(summaryPath, renderMarkdownReport(report, directory), "utf8");
  await writeFile(htmlPath, renderHtmlReport(report, directory), "utf8");
  return paths;
}
