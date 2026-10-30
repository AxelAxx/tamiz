/**
 * The human report (spec 007 FR-004): a summary table, then one section per eval with its
 * metrics and failing cases. Rendered from the validated JSON report, so it can only show
 * what the report holds: ids, kinds, offsets, routes and numbers.
 */
import type { EvalMetric, EvalReport, EvalResult } from "@tamiz/contracts";

const SYMBOL = { pass: "✓", fail: "✗", error: "!", skipped: "-" } as const;
const OPERATOR = { eq: "=", lt: "<", lte: "≤", gte: "≥" } as const;

export function formatValue(metric: Pick<EvalMetric, "value" | "unit">): string {
  if (metric.unit === "ratio") return `${(metric.value * 100).toFixed(2)} %`;
  if (metric.unit === "usd") return `$${metric.value.toFixed(5)}`;
  return Number.isInteger(metric.value) ? String(metric.value) : metric.value.toFixed(4);
}

export function formatThreshold(metric: EvalMetric): string {
  if (metric.threshold === undefined) return "reported";
  const bound =
    metric.unit === "ratio"
      ? `${(metric.threshold.bound * 100).toFixed(2)} %`
      : String(metric.threshold.bound);
  return `${OPERATOR[metric.threshold.comparison]} ${bound}`;
}

function fields(map: Readonly<Record<string, string | number | boolean>> | undefined): string {
  if (map === undefined) return "";
  return Object.entries(map)
    .map(([k, v]) => `${k}=${String(v)}`)
    .join(", ");
}

function section(result: EvalResult): string[] {
  const lines = [`## ${SYMBOL[result.status]} ${result.id} — ${result.status}`, ""];
  if (result.skipReason !== undefined) lines.push(`Skipped: ${result.skipReason}.`, "");
  if (result.error !== undefined) {
    const where = result.error.service === undefined ? "" : ` (${result.error.service})`;
    lines.push(`Error: \`${result.error.type}\`${where}.`, "");
  }
  if (result.metrics.length > 0) {
    lines.push("| Metric | Value | Threshold | |", "|---|---|---|---|");
    for (const m of result.metrics) {
      const mark = m.pass === undefined ? "" : m.pass ? "✓" : "✗";
      lines.push(`| \`${m.name}\` | ${formatValue(m)} | ${formatThreshold(m)} | ${mark} |`);
    }
    lines.push("");
  }
  if (result.failingCount > 0) {
    const shown =
      result.failing.length < result.failingCount
        ? ` (first ${result.failing.length} of ${result.failingCount})`
        : "";
    lines.push(`Failing cases${shown}:`, "", "| Case | Reason | Expected | Actual |");
    lines.push("|---|---|---|---|");
    for (const f of result.failing) {
      lines.push(`| \`${f.id}\` | ${f.reason} | ${fields(f.expected)} | ${fields(f.actual)} |`);
    }
    lines.push("");
  }
  return lines;
}

export function renderMarkdown(report: EvalReport): string {
  const { run } = report;
  const lines = [
    `# Tamiz evals — ${report.status}`,
    "",
    `Run ${run.startedAt}, ${(run.durationMs / 1000).toFixed(1)} s` +
      (run.gitSha === undefined ? "" : `, commit \`${run.gitSha.slice(0, 7)}\``) +
      (run.policy === undefined ? "" : `, policy \`${run.policy.id}\` v${run.policy.version}`) +
      ".",
    "",
    "| Eval | Status | Gated metrics |",
    "|---|---|---|",
    ...report.evals.map((r) => {
      const gated = r.metrics.filter((m) => m.threshold !== undefined);
      const passed = gated.filter((m) => m.pass === true).length;
      const summary = gated.length === 0 ? "—" : `${passed}/${gated.length} pass`;
      return `| ${r.id} | ${SYMBOL[r.status]} ${r.status} | ${summary} |`;
    }),
    "",
    `Datasets: ${run.datasets.map((d) => `${d.name} v${d.version} (${d.cases})`).join(", ") || "none"}.`,
    "",
  ];
  for (const result of report.evals) lines.push(...section(result));
  return `${lines.join("\n").trimEnd()}\n`;
}
