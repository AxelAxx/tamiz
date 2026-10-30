/**
 * Every gated bound, in one file (spec 007 FR-003, data-model section 2, research R-02).
 *
 * Lowering a bar is a one-line diff here, and review sees it. A threshold whose metric an
 * eval did not produce is an error, not a pass: a dataset without DNI cases must not make
 * the DNI leak gate disappear.
 */
import type { EvalComparison, EvalId } from "@tamiz/contracts";

export interface Threshold {
  readonly eval: EvalId;
  readonly metric: string;
  readonly comparison: EvalComparison;
  readonly bound: number;
}

const CRITICAL = ["DNI", "NIE", "NSS", "IBAN", "CREDIT_CARD"] as const;
const HIGH = ["PERSON", "EMAIL", "PHONE"] as const;
const STRUCTURED = ["DNI", "NIE", "CIF", "IBAN", "NSS", "CREDIT_CARD", "PHONE", "EMAIL"] as const;

export const THRESHOLDS: ReadonlyArray<Threshold> = [
  ...CRITICAL.map((kind) => ({
    eval: "leak" as const,
    metric: `leak_rate.${kind}`,
    comparison: "eq" as const,
    bound: 0,
  })),
  ...HIGH.map((kind) => ({
    eval: "leak" as const,
    metric: `leak_rate.${kind}`,
    comparison: "lt" as const,
    bound: 0.02,
  })),
  ...STRUCTURED.map((kind) => ({
    eval: "detection" as const,
    metric: `recall.${kind}`,
    comparison: "gte" as const,
    bound: 0.95,
  })),
  { eval: "detection", metric: "recall.PERSON", comparison: "gte", bound: 0.8 },
  { eval: "routing", metric: "route_accuracy", comparison: "gte", bound: 0.95 },
  { eval: "quality", metric: "relative_score", comparison: "gte", bound: 0.95 },
];

export function meets(value: number, comparison: EvalComparison, bound: number): boolean {
  switch (comparison) {
    case "eq":
      return value === bound;
    case "lt":
      return value < bound;
    case "lte":
      return value <= bound;
    case "gte":
      return value >= bound;
  }
}

export function thresholdsFor(
  id: EvalId,
  all: ReadonlyArray<Threshold> = THRESHOLDS,
): ReadonlyArray<Threshold> {
  return all.filter((t) => t.eval === id);
}
