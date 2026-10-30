/**
 * The eval report (spec 007 FR-004, FR-005, data-model section 4, research R-09).
 *
 * Written by `@tamiz/evals` as `reports/evals.json` and read by the dashboard (008) and the
 * README generator. Failing cases carry ids, kinds, offsets, routes and numbers: the
 * `expected` and `actual` maps hold scalars only, so no dataset text can be put there by
 * shape alone; the runner's tests also search the report for every dataset value.
 */
import { z } from "zod";

export const EVAL_IDS = ["leak", "detection", "routing", "quality", "cost"] as const;
export const EvalIdSchema = z.enum(EVAL_IDS);

/** At most this many failing cases are listed per eval; `failingCount` keeps the total. */
export const EVAL_FAILING_CAP = 50;

export const EvalComparisonSchema = z.enum(["eq", "lt", "lte", "gte"]);

export const EvalThresholdSchema = z.strictObject({
  comparison: EvalComparisonSchema,
  bound: z.number(),
});

export const EvalMetricSchema = z.strictObject({
  name: z.string().min(1),
  value: z.number(),
  unit: z.enum(["ratio", "usd", "score", "count"]).optional(),
  /** Present when the metric is gated; `pass` is then present too. */
  threshold: EvalThresholdSchema.optional(),
  pass: z.boolean().optional(),
});

const FieldsSchema = z.record(z.string(), z.union([z.string(), z.number(), z.boolean()]));

export const EvalFailingCaseSchema = z.strictObject({
  id: z.string().min(1),
  reason: z.string().min(1),
  expected: FieldsSchema.optional(),
  actual: FieldsSchema.optional(),
});

export const EvalStatusSchema = z.enum(["pass", "fail", "error", "skipped"]);

export const EvalResultSchema = z.strictObject({
  id: EvalIdSchema,
  status: EvalStatusSchema,
  durationMs: z.int().min(0),
  metrics: z.array(EvalMetricSchema),
  failing: z.array(EvalFailingCaseSchema).max(EVAL_FAILING_CAP),
  failingCount: z.int().min(0),
  /** On `error`: a type (`service_unavailable`, `contract`, `dataset`, …), never a message body. */
  error: z.strictObject({ type: z.string().min(1), service: z.string().optional() }).optional(),
  skipReason: z.string().optional(),
});

export const EvalReportSchema = z.strictObject({
  schemaVersion: z.literal(1),
  run: z.strictObject({
    startedAt: z.iso.datetime(),
    durationMs: z.int().min(0),
    gitSha: z.string().optional(),
    selection: z.array(EvalIdSchema),
    datasets: z.array(
      z.strictObject({ name: z.string(), version: z.int().min(1), cases: z.int().min(0) }),
    ),
    policy: z.strictObject({ id: z.string(), version: z.int().min(1) }).optional(),
    services: z.strictObject({ gateway: z.string().optional(), privacy: z.string().optional() }),
    models: z.strictObject({
      answer: z.string().optional(),
      judge: z.string().optional(),
      frontier: z.string().optional(),
    }),
  }),
  /** `error` wins over `fail`; skipped evals never make a run pass. */
  status: z.enum(["pass", "fail", "error"]),
  evals: z.array(EvalResultSchema),
});

export type EvalId = z.infer<typeof EvalIdSchema>;
export type EvalComparison = z.infer<typeof EvalComparisonSchema>;
export type EvalMetric = z.infer<typeof EvalMetricSchema>;
export type EvalFailingCase = z.infer<typeof EvalFailingCaseSchema>;
export type EvalStatus = z.infer<typeof EvalStatusSchema>;
export type EvalResult = z.infer<typeof EvalResultSchema>;
export type EvalReport = z.infer<typeof EvalReportSchema>;
