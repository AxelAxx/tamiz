# packages/evals

`@tamiz/evals` holds the eval runner, scorers and versioned synthetic datasets. Together
they make AI behaviour an executable specification: PII leak, detection
precision/recall, routing accuracy, LLM-as-judge quality, and cost against an
all-frontier baseline.

- **Thresholds** live in one file (`src/thresholds.ts`) and follow
  `specs/007-evals-gate/`. The runner exits non-zero below threshold, and CI blocks the
  pull request.
- **Datasets** under `datasets/` are synthetic and never contain real data. Content is
  Spanish by design (ADR-0002), plus English where the behaviour under test is bilingual.

## Running

The evals call the running services through their public HTTP contracts. They import no
app code.

```bash
export TAMIZ_EVAL_GATEWAY_URL=http://localhost:3000   # gateway with the policy under test
export TAMIZ_EVAL_API_KEY=<client key>
export TAMIZ_EVAL_PRIVACY_URL=http://localhost:8001  # detection
pnpm evals                       # every implemented eval
pnpm evals -- --only routing     # a selection
pnpm evals -- --report-dir out   # default: packages/evals/reports/ (git-ignored)
```

Exit codes:
- `0`: every selected eval passed;
- `1`: one is below a threshold;
- `2`: a configuration, dataset or service error, or nothing ran.

An eval whose service is not configured is skipped and listed as skipped. Naming it in
`--only` turns the missing configuration into an error.

**Reports.** The runner writes `evals.json` (`EvalReportSchema` in `@tamiz/contracts`) and
`evals.md`. Failing cases are shown by id, kind, offset, route and rule, never by dataset
text.

Full contract: `specs/007-evals-gate/contracts/cli.md`.

## Evals

| Eval | Dataset | Gate | Since |
|---|---|---|---|
| routing | `routing.v1.jsonl` via `POST /v1/simulate` (real inspection) | ≥ 95 % expected first route | `T-007-02` |
| leak | `pii-leak-es.v1.jsonl` via `POST /v1/simulate` (160 requests, 380 values) | 0 % critical (DNI, NIE, NSS, IBAN, card); < 2 % names, emails, phones | `T-007-03` |
| detection | `pii-detection-es.v1.jsonl` via the privacy service's `POST /analyze` (160 sentences, 271 spans) | recall ≥ 0.95 structured, ≥ 0.80 names | `T-007-03` |
| quality, cost | `quality-es` | ≤ 5 % below the comparison; cost reported | `T-007-05` |

## Datasets

Every file is JSONL. The first line is a header (`dataset`, `version`, `synthetic: true`,
`language`, `note`, and optionally `policy`, `generator`, `seed`); each following line is
one case with a unique `id`. The runner validates every line before scoring and reports
errors as `file:line`. Shapes are in `specs/007-evals-gate/contracts/datasets.md`.

`routing.v1.jsonl` (spec 002, `T-002-08`) holds 44 bilingual cases bound to
`apps/gateway/policies/default.yaml`. Each case carries `messages`, an optional `model`,
and the expected `taskType`, `size` and `route`. Two checks read it:
- the gateway's fast unit gate (`apps/gateway/test/evals/routing-dataset.test.ts`, no
  network);
- the routing eval here, end to end through the real privacy inspection.

Changing the default policy or the cue table means editing the expectations, in the same
pull request.

`pii-leak-es.v1.jsonl` and `pii-detection-es.v1.jsonl` (`T-007-03`) are **generated** by
`src/synthetic/generate.ts` from a fixed seed. Never edit them by hand.
- Regenerate with `pnpm --filter @tamiz/evals generate:datasets` after a build.
- `generate:datasets -- --check` (also part of `pnpm test`) fails when a committed file
  differs.
- Identifiers carry valid control characters.
- Names and places are invented and disjoint from the privacy service's development
  corpus; a test checks this.
