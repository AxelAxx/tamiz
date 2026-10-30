# Quickstart: verifying the Evals Gate

**Feature**: `007-evals-gate` · **Date**: 2026-10-30

How a reviewer proves the feature works once `T-007-02` … `T-007-06` are merged.

## Prerequisites

- Features 002–006 and their quickstarts.
- The privacy service (`uv run python -m privacy.main`, or `docker compose up privacy`).
- Optional: Ollama with `qwen2.5:1.5b` and `qwen2.5:3b` for the quality eval.

## 1. Runner suites (US1, no services)

```bash
pnpm --filter @tamiz/evals test
```

Expected:
- scorers, metrics, thresholds, dataset validation and report rendering are green;
- the MSW-backed runner tests show exit 0 / 1 / 2 for pass, below threshold and service
  error;
- the output check finds no dataset value.

## 2. Datasets are reproducible

```bash
pnpm --filter @tamiz/evals generate:datasets -- --check
```

Expected: no difference from the committed `pii-leak-es.v1.jsonl` and
`pii-detection-es.v1.jsonl`.

## 3. The P1 evals against real services (US2, US3, US4)

```bash
# terminal 1: the privacy service (see feature 004)
# terminal 2: the gateway with the default policy (fake cloud keys: simulation calls no model)
export TAMIZ_EVAL_GATEWAY_URL=http://localhost:3000 TAMIZ_EVAL_API_KEY=<client key>
export TAMIZ_EVAL_PRIVACY_URL=http://localhost:8001
pnpm evals -- --only leak,detection,routing,cost
```

Expected:
- **Exit.** 0.
- **Report.** `packages/evals/reports/evals.md` shows:
  - leak 0 % for every critical kind and < 2 % for names, emails and phones;
  - detection recall ≥ 0.95 on the structured identifiers and ≥ 0.80 on names;
  - routing ≥ 95 %;
  - cost with a saving against `anthropic-sonnet`.
- **No values.** No dataset value appears in the reports or the console.

## 4. Quality (US5, optional locally)

```bash
export TAMIZ_EVAL_JUDGE_URL=http://localhost:11434/v1 TAMIZ_EVAL_JUDGE_MODEL=qwen2.5:3b
pnpm evals -- --only quality
```

Expected:
- The relative score is compared with the accepted baseline.
- With `TAMIZ_EVAL_FRONTIER=on` and an Anthropic key, it is compared with the frontier
  arm, and the gap is reported.

## 5. The gate blocks (US6, SC-005)

In a scratch pull request, change one expectation in `routing.v1.jsonl` so that accuracy
drops below 95 % (or lower a leak bound in a copy of the dataset). Expected:
- the `evals` job fails;
- its summary names the eval and the case ids;
- the pull request cannot be merged.

Revert, and it passes. Record both run links in the `T-007-06` task record.

## 6. README table (FR-015)

```bash
pnpm evals:readme -- --report packages/evals/reports/evals.json
```

Expected: the table between `<!-- evals:start -->` and `<!-- evals:end -->` matches the
report.
