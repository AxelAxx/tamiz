# Contract: the `evals` command

## Commands

```bash
pnpm evals                                   # every eval
pnpm evals -- --only routing,leak            # a selection; the others are "skipped"
pnpm evals -- --report-dir packages/evals/reports
pnpm evals:readme -- --report packages/evals/reports/evals.json   # rewrite the README table
pnpm --filter @tamiz/evals generate:datasets [-- --check]         # synthetic datasets
```

## Environment (validated at start; a missing required variable is exit 2)

| Variable | Required by | Meaning |
|---|---|---|
| `TAMIZ_EVAL_GATEWAY_URL` | leak, routing, cost | Gateway running the policy under test (default policy) |
| `TAMIZ_EVAL_API_KEY` | leak, routing, quality | A client key of that gateway (and of the quality gateway) |
| `TAMIZ_EVAL_PRIVACY_URL` | detection | Privacy service base URL |
| `TAMIZ_EVAL_QUALITY_GATEWAY_URL` | quality | Gateway whose `tamiz-local` route answers (CI: `quality-ci.yaml`); defaults to `TAMIZ_EVAL_GATEWAY_URL` |
| `TAMIZ_EVAL_JUDGE_URL`, `TAMIZ_EVAL_JUDGE_MODEL` | quality | OpenAI-compatible endpoint and model of the judge |
| `TAMIZ_EVAL_FRONTIER` | quality | `on`: also answer with `model: tamiz-frontier` and compare with it; default `off` |
| `TAMIZ_EVAL_CONCURRENCY` | all | Parallel observations, default 4 |

An eval whose required variables are absent is `skipped` with the reason. It is not an
error, unless it was named in `--only`.

## Exit codes

| Code | Meaning |
|---|---|
| 0 | Every selected, non-skipped eval passed |
| 1 | At least one eval is below a threshold, and no error |
| 2 | A dataset, configuration or service error (wins over 1) |

## Outputs

- `reports/evals.json`: validates against `EvalReportSchema` (`@tamiz/contracts`).
- `reports/evals.md`: a summary table, then one section per eval with its metrics and up
  to 50 failing cases.
- Console: one line per eval (`✓`/`✗`/`!`/`-`, metric summary) and the exit reason.
- Never a dataset value in any of them (ids, kinds and offsets only).

## README markers

The README table lies between `<!-- evals:start -->` and `<!-- evals:end -->`. The
command fails (exit 2) if the markers are missing or duplicated.
