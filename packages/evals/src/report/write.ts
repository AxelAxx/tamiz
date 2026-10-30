/**
 * Writes `evals.json` (validated against `EvalReportSchema` first) and `evals.md`
 * (spec 007 FR-004, contracts/cli.md).
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { type EvalReport, EvalReportSchema } from "@tamiz/contracts";
import { renderMarkdown } from "./markdown.js";

export async function writeReports(
  dir: string,
  report: EvalReport,
): Promise<{ json: string; markdown: string }> {
  const valid = EvalReportSchema.parse(report);
  await mkdir(dir, { recursive: true });
  const json = join(dir, "evals.json");
  const markdown = join(dir, "evals.md");
  await writeFile(json, `${JSON.stringify(valid, null, 2)}\n`, "utf8");
  await writeFile(markdown, renderMarkdown(valid), "utf8");
  return { json, markdown };
}
