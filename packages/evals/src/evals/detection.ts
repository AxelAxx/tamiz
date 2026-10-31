/**
 * Detection eval (spec 007 US3, FR-008): the privacy service's `/analyze` over the held-out
 * dataset, scored per kind.
 *
 * Matching follows the privacy service's own metrics (spec 004 research R-14): structured
 * kinds need the exact kind and offsets; names and places need the kind and overlapping
 * spans, since NER boundaries legitimately differ on titles and particles. Each annotation
 * is matched at most once.
 */
import type { EvalFailingCase, PrivacyEntityKindDto } from "@tamiz/contracts";
import { createPrivacyClient } from "../clients/privacy.js";
import { type DetectionCase, DetectionCaseSchema } from "../datasets.js";
import type { Eval } from "../eval.js";

export interface Finding {
  readonly kind: PrivacyEntityKindDto;
  readonly start: number;
  readonly end: number;
}

export interface DetectionOutcome {
  readonly tp: ReadonlyArray<Finding>;
  readonly fp: ReadonlyArray<Finding>;
  readonly fn: ReadonlyArray<Finding>;
}

const LENIENT: ReadonlySet<PrivacyEntityKindDto> = new Set(["PERSON", "LOCATION"]);

function matches(label: Finding, found: Finding): boolean {
  if (label.kind !== found.kind) return false;
  if (LENIENT.has(label.kind)) return found.start < label.end && label.start < found.end;
  return found.start === label.start && found.end === label.end;
}

export function scoreDetection(
  labels: ReadonlyArray<Finding>,
  findings: ReadonlyArray<Finding>,
): DetectionOutcome {
  const unmatched = [...labels];
  const tp: Finding[] = [];
  const fp: Finding[] = [];
  for (const found of findings) {
    const index = unmatched.findIndex((label) => matches(label, found));
    if (index === -1) {
      fp.push(found);
    } else {
      tp.push(found);
      unmatched.splice(index, 1);
    }
  }
  return { tp, fp, fn: unmatched };
}

export const detectionEval: Eval<DetectionCase, ReadonlyArray<Finding>, DetectionOutcome> = {
  id: "detection",
  dataset: {
    file: "pii-detection-es.v1.jsonl",
    name: "pii-detection-es",
    schema: DetectionCaseSchema,
  },
  requires: ["TAMIZ_EVAL_PRIVACY_URL"],

  prepare({ config, fetch }) {
    const privacy = createPrivacyClient({ baseUrl: config.TAMIZ_EVAL_PRIVACY_URL ?? "", fetch });
    return {
      async observe(c) {
        const analyzed = await privacy.analyze(c.text);
        return analyzed.findings.map(({ kind, start, end }) => ({ kind, start, end }));
      },
    };
  },

  score: (c, findings) => scoreDetection(c.spans, findings),

  summarize(results) {
    const counts = new Map<PrivacyEntityKindDto, { tp: number; fp: number; fn: number }>();
    const add = (kind: PrivacyEntityKindDto, key: "tp" | "fp" | "fn") => {
      const current = counts.get(kind) ?? { tp: 0, fp: 0, fn: 0 };
      counts.set(kind, { ...current, [key]: current[key] + 1 });
    };
    const failing: EvalFailingCase[] = [];
    for (const { c, result } of results) {
      for (const f of result.tp) add(f.kind, "tp");
      for (const f of result.fp) add(f.kind, "fp");
      for (const f of result.fn) {
        add(f.kind, "fn");
        failing.push({
          id: c.id,
          reason: "missed",
          expected: { kind: f.kind, start: f.start, end: f.end },
        });
      }
    }
    const kinds = [...counts.keys()].sort();
    const metrics = kinds.flatMap((kind) => {
      const { tp, fp, fn } = counts.get(kind) ?? { tp: 0, fp: 0, fn: 0 };
      const out = [];
      // Recall only where the dataset has examples; precision only where something was found.
      if (tp + fn > 0)
        out.push({ name: `recall.${kind}`, value: tp / (tp + fn), unit: "ratio" as const });
      if (tp + fp > 0)
        out.push({ name: `precision.${kind}`, value: tp / (tp + fp), unit: "ratio" as const });
      if (tp + fn > 0)
        out.push({ name: `support.${kind}`, value: tp + fn, unit: "count" as const });
      return out;
    });
    return {
      metrics: [...metrics, { name: "cases", value: results.length, unit: "count" }],
      failing,
    };
  },
};
