# Data Model: Evals Gate

**Feature**: `007-evals-gate` · **Date**: 2026-10-30

## 1. Datasets (`packages/evals/datasets/`, JSONL)

Line 1 is a header; every following line is one case. The exact fields are in
[`contracts/datasets.md`](contracts/datasets.md).

| Dataset | Cases | Case fields | Used by |
|---|---|---|---|
| `routing.v1.jsonl` (feature 002) | 44 | `id`, `messages`, `model?`, `expected { taskType, size, route }` | routing, cost |
| `pii-leak-es.v1.jsonl` | ≥ 150 | `id`, `messages`, `model?`, `values[] { kind, messageIndex, start, end }`, `tags[]` | leak |
| `pii-detection-es.v1.jsonl` | ≥ 150 values | `id`, `text`, `spans[] { kind, start, end }`, `tags[]` | detection |
| `quality-es.v1.jsonl` | ≥ 24 | `id`, `messages`, `reference`, `taskType`, `language` | quality, cost |

Validation rules:
- Ids are unique and match `^<dataset>-\d{3,4}$`.
- Offsets are UTF-16, `end` exclusive, within the message.
- `kind` is one of the privacy service's entity kinds.
- Every header says `synthetic: true`.
- Quality references contain no personal data. The generator's `--check` and a test
  enforce this by running the detection eval's kinds over them.

## 2. Thresholds (`src/thresholds.ts`)

```ts
type Comparison = "eq" | "lt" | "lte" | "gte";
interface Threshold { eval: EvalId; metric: string; comparison: Comparison; bound: number }
```

| Eval | Metric | Comparison | Bound |
|---|---|---|---|
| leak | `leak_rate.{DNI,NIE,NSS,IBAN,CREDIT_CARD}` | eq | 0 |
| leak | `leak_rate.{PERSON,EMAIL,PHONE}` | lt | 0.02 |
| detection | `recall.{DNI,NIE,CIF,IBAN,NSS,CREDIT_CARD,PHONE,EMAIL}` | gte | 0.95 |
| detection | `recall.PERSON` | gte | 0.80 |
| routing | `route_accuracy` | gte | 0.95 |
| quality | `relative_score` (routed ÷ comparison) | gte | 0.95 |
| cost | none (reported) | | |

## 3. Runner types (`@tamiz/evals`)

```ts
type EvalId = "leak" | "detection" | "routing" | "quality" | "cost";

interface Eval<Case, Observation, Outcome> {
  id: EvalId;
  dataset: DatasetRef;                                   // file + schema
  observe(c: Case, clients: Clients): Promise<Result<Observation, ServiceError>>;
  score(c: Case, o: Observation): Outcome;               // pure
  metrics(outcomes: ReadonlyArray<Outcome>): ReadonlyArray<Metric>;   // pure
}

interface Metric { name: string; value: number; unit?: "ratio" | "usd" | "score" }
interface FailingCase { id: string; reason: string; expected?: Fields; actual?: Fields }
// Fields: only ids, kinds, offsets, routes, rules, levels, numbers; never text.
```

Observations, by eval:

| Eval | Observation |
|---|---|
| leak | the simulate response's `decision`, `chain[].{id,residency}`, `privacyAction`, `detector` and, for each annotated value, whether it occurs verbatim in what is sent (computed in `observe`, so text never leaves it) |
| detection | the findings `{ kind, start, end, score }` of `/analyze` |
| routing | `chain[0].id`, `ruleId`, `sensitivity`, `decision` and the classified task type, if exposed |
| quality | the answer per arm (in memory only), usage, the judge's `{ score, rationale }` |
| cost | the first target's and the baseline's prices with the estimated tokens |

## 4. Report (`packages/contracts/src/evals.ts`)

```ts
EvalReportSchema = {
  schemaVersion: 1,
  run: { startedAt, durationMs, gitSha?, selection: EvalId[],
         datasets: [{ name, version, cases }], policy: { id, version },
         services: { gateway?: version, privacy?: version }, models: { answer?, judge?, frontier? } },
  status: "pass" | "fail" | "error",
  evals: [{ id, status: "pass" | "fail" | "error" | "skipped", durationMs,
            metrics: [{ name, value, unit?, threshold?: { comparison, bound }, pass? }],
            failing: [{ id, reason, expected?, actual? }],      // capped at 50, count kept
            failingCount, error?: { type, service? }, skipReason? }],
}
```

See [`contracts/report.example.json`](contracts/report.example.json).

## 5. Quality baseline (`baselines/quality.json`)

```json
{ "entries": [ { "dataset": "quality-es", "datasetVersion": 1, "judgePrompt": "judge.v1",
                 "answerModel": "qwen2.5:1.5b", "judgeModel": "qwen2.5:3b",
                 "score": 0.0, "acceptedAt": "…", "report": "…sha" } ] }
```

There is no entry for the run's key on the first run. The quality eval then reports
`error` (`baseline_missing`) with the measured score, so accepting a baseline is always an
explicit, reviewed change.

## 6. State transitions of a run

`validate datasets` → (error → exit 2) → for each selected eval: `observe all cases`
(service error → eval `error`) → `score` → `metrics` → `compare thresholds` →
`pass | fail` → `write reports` → exit `2` if any error, else `1` if any fail, else `0`.
