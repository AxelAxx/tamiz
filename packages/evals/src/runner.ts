/**
 * Runs the selected evals and builds the report (spec 007 FR-001 … FR-004, data-model
 * section 6, research R-02, R-12).
 *
 * Per eval: skip when not selected or not configured → load and validate its dataset →
 * observe every case with bounded concurrency → score → summarize → attach thresholds.
 * A dataset, service or missing-metric problem makes the eval `error`; a broken bar makes
 * it `fail`. The run is `error` if any eval errored (or nothing ran at all), else `fail` if
 * any failed, else `pass`.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  EVAL_FAILING_CAP,
  type EvalId,
  type EvalMetric,
  type EvalReport,
  type EvalResult,
} from "@tamiz/contracts";
import { parse as parseYaml } from "yaml";
import type { EvalConfig } from "./config.js";
import { type Dataset, DatasetError, loadDataset } from "./datasets.js";
import { type Eval, type EvalContext, ServiceError, type Summary } from "./eval.js";
import { meets, THRESHOLDS, type Threshold, thresholdsFor } from "./thresholds.js";

interface Executed {
  readonly dataset: Dataset<{ id: string }>;
  readonly summary: Summary;
}

/** An eval with its case type erased, so evals of different datasets share one list. */
export interface RegisteredEval {
  readonly id: EvalId;
  readonly requires: ReadonlyArray<keyof EvalConfig>;
  execute(context: EvalContext, datasetsDir: string, concurrency: number): Promise<Executed>;
}

/** Runs `fn` over `items` with at most `limit` in flight, keeping the order. */
async function pool<T, U>(
  items: ReadonlyArray<T>,
  limit: number,
  fn: (item: T) => Promise<U>,
): Promise<U[]> {
  const out: U[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      out[index] = await fn(items[index] as T);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

export function register<C extends { id: string }, O, R>(e: Eval<C, O, R>): RegisteredEval {
  return {
    id: e.id,
    requires: e.requires,
    async execute(context, datasetsDir, concurrency) {
      const dataset = await loadDataset(
        join(datasetsDir, e.dataset.file),
        e.dataset.name,
        e.dataset.schema,
      );
      const session = e.prepare(context);
      const results = await pool(dataset.cases, concurrency, async (c) => ({
        c,
        result: e.score(c, await session.observe(c)),
      }));
      return { dataset, summary: e.summarize(results) };
    },
  };
}

export interface RunInput {
  readonly evals: ReadonlyArray<RegisteredEval>;
  /** Undefined runs every registered eval; a list runs exactly those. */
  readonly only?: ReadonlyArray<EvalId>;
  readonly context: EvalContext;
  readonly datasetsDir: string;
  /** For the policy files named by dataset headers. */
  readonly repoRoot: string;
  readonly now: () => Date;
  readonly services?: EvalReport["run"]["services"];
  readonly models?: EvalReport["run"]["models"];
  readonly thresholds?: ReadonlyArray<Threshold>;
}

export interface RunOutput {
  readonly report: EvalReport;
  /** Human lines for the console: dataset positions and failing services, never values. */
  readonly diagnostics: ReadonlyArray<string>;
}

function gate(
  id: EvalId,
  summary: Summary,
  thresholds: ReadonlyArray<Threshold>,
): { metrics: EvalMetric[]; missing: string[] } {
  const bars = thresholdsFor(id, thresholds);
  const metrics: EvalMetric[] = summary.metrics.map((metric) => {
    const bar = bars.find((t) => t.metric === metric.name);
    if (bar === undefined) return { ...metric };
    return {
      ...metric,
      threshold: { comparison: bar.comparison, bound: bar.bound },
      pass: meets(metric.value, bar.comparison, bar.bound),
    };
  });
  const missing = bars
    .filter((t) => !summary.metrics.some((m) => m.name === t.metric))
    .map((t) => t.metric);
  return { metrics, missing };
}

async function policyOf(repoRoot: string, file: string | undefined) {
  if (file === undefined) return undefined;
  try {
    const parsed: unknown = parseYaml(await readFile(join(repoRoot, file), "utf8"));
    const { id, version } = (parsed ?? {}) as { id?: unknown; version?: unknown };
    return typeof id === "string" && typeof version === "number" ? { id, version } : undefined;
  } catch {
    return undefined;
  }
}

export async function runEvals(input: RunInput): Promise<RunOutput> {
  const started = input.now();
  const thresholds = input.thresholds ?? THRESHOLDS;
  const results: EvalResult[] = [];
  const datasets: EvalReport["run"]["datasets"] = [];
  const diagnostics: string[] = [];
  let policyFile: string | undefined;

  for (const e of input.evals) {
    const t0 = input.now().getTime();
    const elapsed = () => Math.max(0, input.now().getTime() - t0);
    const base = { id: e.id, metrics: [], failing: [], failingCount: 0 };
    if (input.only !== undefined && !input.only.includes(e.id)) {
      results.push({ ...base, status: "skipped", durationMs: 0, skipReason: "not selected" });
      continue;
    }
    const missing = e.requires.filter((key) => input.context.config[key] === undefined);
    if (missing.length > 0) {
      const reason = `missing ${missing.join(", ")}`;
      if (input.only !== undefined) {
        diagnostics.push(`${e.id}: ${reason}`);
        results.push({
          ...base,
          status: "error",
          durationMs: 0,
          error: { type: "config_missing" },
        });
      } else {
        results.push({ ...base, status: "skipped", durationMs: 0, skipReason: reason });
      }
      continue;
    }
    try {
      const { dataset, summary } = await e.execute(
        input.context,
        input.datasetsDir,
        input.context.config.TAMIZ_EVAL_CONCURRENCY,
      );
      datasets.push({
        name: dataset.header.dataset,
        version: dataset.header.version,
        cases: dataset.cases.length,
      });
      policyFile ??= dataset.header.policy;
      const { metrics, missing: absent } = gate(e.id, summary, thresholds);
      const failing = summary.failing.slice(0, EVAL_FAILING_CAP);
      const common = { ...base, metrics, failing, failingCount: summary.failing.length };
      if (absent.length > 0) {
        diagnostics.push(`${e.id}: gated metrics not produced: ${absent.join(", ")}`);
        results.push({
          ...common,
          status: "error",
          durationMs: elapsed(),
          error: { type: "metric_missing" },
        });
        continue;
      }
      const failed = metrics.some((m) => m.pass === false);
      results.push({ ...common, status: failed ? "fail" : "pass", durationMs: elapsed() });
    } catch (error) {
      if (error instanceof DatasetError) {
        diagnostics.push(`${e.id}: ${error.message}`);
        results.push({
          ...base,
          status: "error",
          durationMs: elapsed(),
          error: { type: "dataset" },
        });
      } else if (error instanceof ServiceError) {
        diagnostics.push(`${e.id}: ${error.service} ${error.type}`);
        results.push({
          ...base,
          status: "error",
          durationMs: elapsed(),
          error: { type: error.type, service: error.service },
        });
      } else {
        diagnostics.push(`${e.id}: internal error`);
        results.push({
          ...base,
          status: "error",
          durationMs: elapsed(),
          error: { type: "internal" },
        });
      }
    }
  }

  const ran = results.filter((r) => r.status !== "skipped");
  if (ran.length === 0) diagnostics.push("no eval ran: nothing was selected or configured");
  const status =
    ran.length === 0 || ran.some((r) => r.status === "error")
      ? "error"
      : ran.some((r) => r.status === "fail")
        ? "fail"
        : "pass";
  const policy = await policyOf(input.repoRoot, policyFile);
  const gitSha = input.context.config.GITHUB_SHA;
  return {
    report: {
      schemaVersion: 1,
      run: {
        startedAt: started.toISOString(),
        durationMs: Math.max(0, input.now().getTime() - started.getTime()),
        ...(gitSha === undefined ? {} : { gitSha }),
        selection: input.only === undefined ? input.evals.map((e) => e.id) : [...input.only],
        datasets,
        ...(policy === undefined ? {} : { policy }),
        services: input.services ?? {},
        models: input.models ?? {},
      },
      status,
      evals: results,
    },
    diagnostics,
  };
}

/** Exit status of a run (spec 007 FR-001, research R-12): error wins over fail. */
export function exitCode(report: EvalReport): 0 | 1 | 2 {
  return report.status === "error" ? 2 : report.status === "fail" ? 1 : 0;
}
