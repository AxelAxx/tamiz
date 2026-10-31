# T-007-05 — Quality (LLM-as-judge) and cost evals

| Field | Value |
|---|---|
| Task | `T-007-05` (see `docs/tasks/BACKLOG.md`) |
| Feature | `007-evals-gate` |
| Spec | `specs/007-evals-gate/spec.md` (FR-011 … FR-013; US5-1 … US5-5; SC-004); `tasks.md` Phase 4 (T023–T027); `research.md` R-07, R-08 |
| Branch / PR | `T-007-05-quality-cost-evals` / PR opened after this commit |
| Date | 2026-10-31 |
| Session | Claude Code (Claude Opus 5.5), side session (merge authority delegated by Alex) |
| Status | done; the first accepted quality baseline is recorded with `T-007-06` (see below) |

## What was done

**Quality eval.**
- **Dataset.** `quality-es.v1.jsonl` has 24 cases in Spanish and English (summarize,
  extract, translate, chat). Each has a reference answer and no personal data; a test
  checks the identifier and email patterns and the generator's name lists.
- **Answer.** Each case goes through the gateway on `tamiz-local`, the cheapest local
  route, with `max_tokens` 256 and temperature 0.
- **Judge.** An OpenAI-compatible endpoint (Ollama), called directly with temperature 0
  and seed 42. It uses the versioned prompt `prompts/judge.v1.md`, never sees the route or
  model, and answers JSON `{score 1–5, rationale}`. An unparseable reply is retried once.
- **Comparison.**
  - With `TAMIZ_EVAL_FRONTIER=on`, the same case is also answered on `tamiz-frontier`.
    That is a new `pinned-frontier` rule in the default policy, route
    `[anthropic-sonnet]`; the privacy section still applies first.
  - Otherwise the comparison is the accepted baseline in `baselines/quality.json`, keyed by
    answering model, judge model, dataset version and prompt version.
  - The gate is `relative_score = routed ÷ comparison ≥ 0.95`.
- **Errors.** More than 10 % unparseable judgements is `judge_unreliable`. A missing
  baseline is `baseline_missing`; both are exit 2. The measured score is still reported, so
  accepting it is an explicit, reviewed change.
- **CI policy.** `policies/quality-ci.yaml`: one local target on `qwen2.5:1.5b`, used by
  the second gateway that answers in CI.

**Cost eval.**
- **Estimate.** For the routing dataset through the simulation: input tokens use the
  gateway's estimate rule (characters ÷ 4), output tokens a fixed 300.
- **Prices.** Read from the default policy file. Each case is priced on the first target
  and on the baseline target (the most expensive, as in feature 006).
- **Report.** Routed cost, baseline cost and saving, with no threshold.

**Runner.** An eval summary may now carry an `error` (reported as an eval error) and the
models it used (merged into the report's provenance). The eval context gains `repoRoot`.

## Results

- **Cost (real run, 2026-10-31).** The real privacy service and gateway (`default.yaml`),
  over the routing dataset's 44 cases: routed **$0.0376** vs everything to
  `anthropic-sonnet` **$0.2913**, an estimated saving of **87.1 %**.
- **Quality.** Not run against real models here: Ollama is not installed on this machine,
  and downloading it was not done unasked. Verified with MSW fakes of the gateway and the
  judge:
  - CI mode (local arm only, blind judge, baseline comparison, pass);
  - frontier mode (both arms, retry on an unparseable reply);
  - a regression below 95 % fails.

  `baselines/quality.json` therefore starts empty. `T-007-06` adds the CI job with Ollama.
  Its first run measures the score of `qwen2.5:1.5b` judged by `qwen2.5:3b`, and that run
  is the source of the first accepted entry. Until then the quality eval reports
  `baseline_missing`.
- **Frontier gap.** Not measured: there is no Anthropic key here. The README will say so
  until it is run with keys.

## Files touched

- `packages/evals/src/clients/judge.ts`, `src/evals/{quality,cost}.ts` (new); `src/clients/gateway.ts` (`chat`); `src/eval.ts` (`Summary.error`, `Summary.models`, `EvalContext.repoRoot`); `src/runner.ts`; `src/cli.ts` (async registry with the prompt and baseline files).
- `packages/evals/datasets/quality-es.v1.jsonl`, `prompts/judge.v1.md`, `baselines/quality.json`, `policies/quality-ci.yaml` (new).
- `apps/gateway/policies/default.yaml` (`pinned-frontier`); `apps/gateway/test/policy/policy-files.test.ts` (new: every shipped policy loads).
- Tests: `packages/evals/test/quality-cost.test.ts` (new, 18 tests); `runner.test.ts`.
- `packages/evals/README.md`, `specs/007-evals-gate/tasks.md` (T023–T027 ticked), `docs/tasks/BACKLOG.md`.

## Decisions

- **The cost eval covers the routing dataset only, estimated.** The quality run's local
  answers cost $0 by policy, so adding them would only add a constant. Its token usage is
  reported in the quality eval as `tokens.routed_output`. FR-013 mentions both datasets;
  this is a simplification, recorded here.
- **The judge is called directly, not through the gateway.** It is not production traffic,
  and the references hold no personal data (R-07).
- **The baseline is not invented.** An empty baseline with a loud `baseline_missing` is
  safer than a guessed number. The accepted score must come from a real CI run.

## How it was verified

```bash
pnpm lint        # clean (pre-existing warning and infos only)
pnpm typecheck   # 0 errors
pnpm arch        # ✔ no dependency violations found
pnpm test        # all green (see the PR)
pnpm build       # pass
```

The evals package has 72 tests, plus the real cost run above.

## Pending / follow-ups

- `T-007-06`: the CI job with Ollama, and recording the first quality baseline from its
  report.
- The frontier comparison with keys needs a person with an Anthropic key. It can run in a
  scheduled workflow later; no backlog row until keys exist.

## Pitfalls for the next session

- **The quality eval needs two gateways in CI.** The default policy is used for
  leak/routing/cost (`TAMIZ_EVAL_GATEWAY_URL`), and `quality-ci.yaml` answers
  (`TAMIZ_EVAL_QUALITY_GATEWAY_URL`). The same client key must work on both.
- **The baseline key includes the model name the gateway reports** (`model` in the
  completion), not the policy target id.

## Links

- Spec / plan / tasks: `specs/007-evals-gate/`
- Related task records: `docs/tasks/done/T-007-04-routing-eval.md`, `docs/tasks/done/T-006-06-cost-and-providers.md`
