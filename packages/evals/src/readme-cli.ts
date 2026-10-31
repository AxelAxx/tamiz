#!/usr/bin/env node
/**
 * `pnpm evals:readme -- --report <evals.json> [--readme <README.md>]` (spec 007 FR-015).
 *
 * Rewrites the results table between the README markers from a report. Exit 2 when the
 * report is invalid or the markers are missing or duplicated.
 */
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { EvalReportSchema } from "@tamiz/contracts";
import { renderTable, replaceTable } from "./report/readme.js";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

export async function updateReadme(
  argv: ReadonlyArray<string>,
  out: (line: string) => void,
): Promise<number> {
  try {
    const { values } = parseArgs({
      args: [...argv],
      options: { report: { type: "string" }, readme: { type: "string" } },
      strict: true,
    });
    const reportPath = resolve(
      values.report ?? resolve(REPO_ROOT, "packages/evals/reports/evals.json"),
    );
    const readmePath = resolve(values.readme ?? resolve(REPO_ROOT, "README.md"));
    const report = EvalReportSchema.safeParse(JSON.parse(await readFile(reportPath, "utf8")));
    if (!report.success) {
      out(`! ${reportPath}: not a valid eval report`);
      return 2;
    }
    const readme = await readFile(readmePath, "utf8");
    await writeFile(readmePath, replaceTable(readme, renderTable(report.data)), "utf8");
    out(`README table updated from ${reportPath}`);
    return 0;
  } catch (error) {
    out(`! ${(error as Error).message}`);
    return 2;
  }
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  updateReadme(process.argv.slice(2), (line) => process.stdout.write(`${line}\n`)).then((code) => {
    process.exitCode = code;
  });
}
