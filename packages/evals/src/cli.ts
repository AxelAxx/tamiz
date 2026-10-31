#!/usr/bin/env node
/**
 * `pnpm evals` (spec 007 FR-001, contracts/cli.md).
 *
 * Exit 0 when every selected eval passed, 1 when one is below a threshold, 2 on a setup,
 * dataset or service error. The console shows one line per eval and the diagnostics:
 * names, metrics, files and line numbers, never dataset content.
 */
import { realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { EVAL_IDS, type EvalId, type EvalReport } from "@tamiz/contracts";
import { createGatewayClient } from "./clients/gateway.js";
import { loadConfig } from "./config.js";
import { costEval } from "./evals/cost.js";
import { detectionEval } from "./evals/detection.js";
import { leakEval } from "./evals/leak.js";
import { type QualityBaseline, qualityEval } from "./evals/quality.js";
import { routingEval } from "./evals/routing.js";
import { formatThreshold, formatValue } from "./report/markdown.js";
import { writeReports } from "./report/write.js";
import { exitCode, type RegisteredEval, register, runEvals } from "./runner.js";

const PACKAGE_ROOT = fileURLToPath(new URL("..", import.meta.url));
const REPO_ROOT = resolve(PACKAGE_ROOT, "../..");

const JUDGE_PROMPT = "judge.v1";

/** Every eval, in report order. Quality reads its judge prompt and accepted baselines. */
export async function registry(packageRoot = PACKAGE_ROOT): Promise<ReadonlyArray<RegisteredEval>> {
  const template = await readFile(resolve(packageRoot, "prompts", `${JUDGE_PROMPT}.md`), "utf8");
  const baseline = JSON.parse(
    await readFile(resolve(packageRoot, "baselines", "quality.json"), "utf8"),
  ) as QualityBaseline;
  return [
    register(leakEval),
    register(detectionEval),
    register(routingEval),
    register(qualityEval({ prompt: { version: JUDGE_PROMPT, template }, baseline })),
    register(costEval),
  ];
}

export interface CliIo {
  readonly out: (line: string) => void;
  readonly fetch: typeof fetch;
  readonly now: () => Date;
}

const SYMBOL = { pass: "✓", fail: "✗", error: "!", skipped: "-" } as const;

function consoleLines(report: EvalReport): string[] {
  return report.evals.map((r) => {
    const gated = r.metrics
      .filter((m) => m.threshold !== undefined)
      .map((m) => `${m.name} ${formatValue(m)} (${formatThreshold(m)})`);
    const detail =
      r.skipReason ?? r.error?.type ?? (gated.length > 0 ? gated.join("; ") : "no gated metric");
    return `${SYMBOL[r.status]} ${r.id.padEnd(9)} ${detail}`;
  });
}

export async function main(
  argv: ReadonlyArray<string>,
  env: Readonly<Record<string, string | undefined>>,
  io: CliIo,
  evals?: ReadonlyArray<RegisteredEval>,
): Promise<number> {
  const registered = evals ?? (await registry());
  let values: { only?: string; "report-dir"?: string };
  try {
    ({ values } = parseArgs({
      args: [...argv],
      options: { only: { type: "string" }, "report-dir": { type: "string" } },
      strict: true,
    }));
  } catch (error) {
    io.out(`! ${(error as Error).message}`);
    return 2;
  }

  let only: EvalId[] | undefined;
  if (values.only !== undefined) {
    const names = values.only
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s !== "");
    const unknown = names.filter((n) => !(EVAL_IDS as ReadonlyArray<string>).includes(n));
    if (unknown.length > 0) {
      io.out(`! unknown evals: ${unknown.join(", ")} (known: ${EVAL_IDS.join(", ")})`);
      return 2;
    }
    const missing = names.filter((n) => !registered.some((e) => e.id === n));
    if (missing.length > 0) {
      io.out(`! not implemented yet: ${missing.join(", ")}`);
      return 2;
    }
    only = names as EvalId[];
  }

  const loaded = loadConfig(env);
  if (!loaded.ok) {
    for (const problem of loaded.problems) io.out(`! config ${problem}`);
    return 2;
  }
  const { config } = loaded;

  const gatewayVersion =
    config.TAMIZ_EVAL_GATEWAY_URL === undefined
      ? undefined
      : await createGatewayClient({
          baseUrl: config.TAMIZ_EVAL_GATEWAY_URL,
          apiKey: config.TAMIZ_EVAL_API_KEY ?? "",
          fetch: io.fetch,
          timeoutMs: 5_000,
        }).version();

  const { report, diagnostics } = await runEvals({
    evals: registered,
    ...(only === undefined ? {} : { only }),
    context: { config, fetch: io.fetch, repoRoot: REPO_ROOT },
    datasetsDir: resolve(PACKAGE_ROOT, "datasets"),
    repoRoot: REPO_ROOT,
    now: io.now,
    services: gatewayVersion === undefined ? {} : { gateway: gatewayVersion },
    models:
      config.TAMIZ_EVAL_JUDGE_MODEL === undefined ? {} : { judge: config.TAMIZ_EVAL_JUDGE_MODEL },
  });

  const reportDir = resolve(values["report-dir"] ?? resolve(PACKAGE_ROOT, "reports"));
  const written = await writeReports(reportDir, report);
  for (const line of consoleLines(report)) io.out(line);
  for (const line of diagnostics) io.out(`! ${line}`);
  io.out(`${report.status.toUpperCase()}: report in ${written.markdown}`);
  return exitCode(report);
}

const invoked = process.argv[1];
if (invoked !== undefined && import.meta.url === pathToFileURL(realpathSync(invoked)).href) {
  main(process.argv.slice(2), process.env, {
    out: (line) => process.stdout.write(`${line}\n`),
    fetch: globalThis.fetch,
    now: () => new Date(),
  }).then(
    (code) => {
      process.exitCode = code;
    },
    () => {
      process.stdout.write("! internal error\n");
      process.exitCode = 2;
    },
  );
}
