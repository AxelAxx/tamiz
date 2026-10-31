/**
 * The README results table (spec 007 FR-015, US6-4, contracts/cli.md).
 *
 * Generated from a report, between `<!-- evals:start -->` and `<!-- evals:end -->`, so the
 * published numbers always come from a real run. Each gated metric is one row with its
 * bar; reported-only metrics that tell the story (cost saving, precision) follow.
 */
import type { EvalMetric, EvalReport } from "@tamiz/contracts";
import { formatThreshold, formatValue } from "./markdown.js";

export const START = "<!-- evals:start -->";
export const END = "<!-- evals:end -->";

const LABEL: Record<string, string> = {
  leak: "PII leak",
  detection: "Detection",
  routing: "Routing",
  quality: "Quality",
  cost: "Cost",
};

/** Reported metrics worth a row next to the gated ones. */
const REPORTED = new Set([
  "saving",
  "cost.routed_estimate",
  "cost.baseline_estimate",
  "mean_score.routed",
]);

function row(evalId: string, metric: EvalMetric): string {
  const result = metric.pass === undefined ? "reported" : metric.pass ? "✓ pass" : "✗ fail";
  return `| ${LABEL[evalId] ?? evalId} | \`${metric.name}\` | ${formatValue(metric)} | ${formatThreshold(metric)} | ${result} |`;
}

export function renderTable(report: EvalReport): string {
  const lines = [
    `Last run: ${report.run.startedAt.slice(0, 10)}` +
      (report.run.gitSha === undefined ? "" : `, commit \`${report.run.gitSha.slice(0, 7)}\``) +
      (report.run.policy === undefined
        ? ""
        : `, policy \`${report.run.policy.id}\` v${report.run.policy.version}`) +
      ` — overall **${report.status}**.`,
    "",
    "| Eval | Metric | Result | Threshold | |",
    "|---|---|---|---|---|",
  ];
  for (const result of report.evals) {
    if (result.status === "skipped") {
      lines.push(
        `| ${LABEL[result.id] ?? result.id} | — | not run | — | ${result.skipReason ?? "skipped"} |`,
      );
      continue;
    }
    if (result.status === "error") {
      lines.push(
        `| ${LABEL[result.id] ?? result.id} | — | error \`${result.error?.type ?? "unknown"}\` | — | ! |`,
      );
    }
    for (const metric of result.metrics) {
      if (metric.threshold !== undefined || REPORTED.has(metric.name))
        lines.push(row(result.id, metric));
    }
  }
  const models = Object.entries(report.run.models)
    .map(([role, model]) => `${role} \`${model}\``)
    .join(", ");
  lines.push(
    "",
    `Datasets: ${report.run.datasets.map((d) => `${d.name} v${d.version} (${d.cases})`).join(", ")}.` +
      (models === "" ? "" : ` Models: ${models}.`),
  );
  return lines.join("\n");
}

export class ReadmeMarkersError extends Error {}

export function replaceTable(readme: string, table: string): string {
  const starts = readme.split(START).length - 1;
  const ends = readme.split(END).length - 1;
  if (starts !== 1 || ends !== 1) {
    throw new ReadmeMarkersError(
      `expected one ${START} and one ${END}, found ${starts} and ${ends}`,
    );
  }
  const before = readme.slice(0, readme.indexOf(START) + START.length);
  const after = readme.slice(readme.indexOf(END));
  if (after.length > readme.length - before.length)
    throw new ReadmeMarkersError(`${END} comes before ${START}`);
  return `${before}\n${table}\n${after}`;
}
