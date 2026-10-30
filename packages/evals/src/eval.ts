/**
 * What an eval is (spec 007 data-model section 3, research R-02).
 *
 * `observe` does the I/O for one case and returns a content-free observation; `score` and
 * `summarize` are pure, so they are tested with toy data. Clients throw `ServiceError`
 * (the edge), which the runner turns into an eval `error`.
 */
import type { EvalFailingCase, EvalId, EvalMetric } from "@tamiz/contracts";
import type { z } from "zod";
import type { EvalConfig } from "./config.js";

export class ServiceError extends Error {
  constructor(
    readonly service: "gateway" | "privacy" | "judge",
    /** `unavailable`, `http_<status>`, `contract`, `timeout`: never a response body. */
    readonly type: string,
  ) {
    super(`${service}: ${type}`);
    this.name = "ServiceError";
  }
}

export interface Summary {
  /** Metric names match `thresholds.ts`; thresholds are attached by the runner. */
  readonly metrics: ReadonlyArray<Omit<EvalMetric, "threshold" | "pass">>;
  /** Every failing case; the runner caps the list in the report. */
  readonly failing: ReadonlyArray<EvalFailingCase>;
}

export interface EvalContext {
  readonly config: EvalConfig;
  readonly fetch: typeof fetch;
}

export interface Eval<C extends { id: string }, O, R> {
  readonly id: EvalId;
  /** Dataset file under `datasets/` and the name its header must carry. */
  readonly dataset: { readonly file: string; readonly name: string; readonly schema: z.ZodType<C> };
  /** Config keys this eval needs; when one is missing the eval is skipped. */
  readonly requires: ReadonlyArray<keyof EvalConfig>;
  /** Prepares the per-run clients; called once, after the dataset loaded. */
  prepare(context: EvalContext): EvalSession<C, O>;
  score(c: C, observation: O): R;
  summarize(results: ReadonlyArray<{ readonly c: C; readonly result: R }>): Summary;
}

export interface EvalSession<C, O> {
  observe(c: C): Promise<O>;
}
