# Research: Evals Gate

**Feature**: `007-evals-gate` · **Date**: 2026-10-30

Decisions taken for the plan. Each one names what was chosen, why, and what else was
considered. The ones flagged **(review)** are listed in the `T-007-01` task record for
Alex.

## R-01 The runner is a workspace package that talks to the services over HTTP

**Decision**:
- **Package.** `packages/evals` becomes `@tamiz/evals` (private, ESM, strict TS), with a
  CLI.
- **Commands.** `pnpm evals` runs it from the root through Turborepo, after the build.
  Flags (`node:util` `parseArgs`, no dependency): `--only routing,leak`, `--report-dir`,
  `--readme`.
- **Services.** The evals call the running services through their public contracts:
  - the gateway's `POST /v1/simulate` and `POST /v1/chat/completions`;
  - the privacy service's `POST /analyze`;
  - an OpenAI-compatible endpoint for the judge.

  They import no gateway or privacy code.
- **Configuration.** Environment variables, validated with Zod at start:
  - `TAMIZ_EVAL_GATEWAY_URL` and `TAMIZ_EVAL_API_KEY`;
  - `TAMIZ_EVAL_PRIVACY_URL`;
  - `TAMIZ_EVAL_QUALITY_GATEWAY_URL`;
  - `TAMIZ_EVAL_JUDGE_URL` and `TAMIZ_EVAL_JUDGE_MODEL`;
  - `TAMIZ_EVAL_FRONTIER` (`on` | `off`).

**Rationale**: evals are the system-level tests of the testing strategy (CLAUDE.md §9):
they must see what a client sees, through the real inspection, policy and anonymization.
HTTP keeps the dependency direction clean (`packages/*` never imports `apps/*`).

**Alternatives**:
- importing the gateway's use cases in process: faster, but it would skip the real HTTP
  contract and couple a package to an app;
- Vitest as the runner: its reporters and exit semantics are built for unit tests, not for
  metric reports with thresholds.

## R-02 Evals are data plus pure scorers; the I/O is at the edge

**Decision**:
- **Eval.** An eval is `{ id, dataset, observe, score, thresholds }`.
  - `observe(case, clients)` does the I/O and returns a content-free observation
    (decision, chain, detected spans, an answer).
  - `score(case, observation)` is pure and returns a case outcome.
  - Metrics are pure aggregations of outcomes.
- **Thresholds.** Declared in one file, `packages/evals/src/thresholds.ts`, as
  `{ metric, comparison, bound }`.
- **Runs.** The runner validates datasets, runs observations with bounded concurrency
  (default 4), then scores, compares and reports.

**Rationale**: the scorers and metrics are unit-tested with toy data and no network
(constitution VIII). One thresholds file makes "lowering a bar" a one-line diff that
review sees (FR-003).

**Alternatives**: thresholds inside each dataset header. That spreads them out, and a
dataset regeneration could change them silently.

## R-03 Dataset format: JSONL with a strict header, validated by Zod

**Decision**:
- **Lines.** Line 1 is a header: `dataset`, `version`, `synthetic: true`, `language`,
  `note`, plus the dataset-specific `policy` or `generator` and `seed`. Each following line
  is a case with a unique `id` and kind-specific fields (see `data-model.md`).
- **Validation.** Strict Zod schemas in `@tamiz/evals`. An error names the file and line
  (FR-002).
- **Naming.** Files are `datasets/<name>.v<N>.jsonl`. A content change that alters
  expectations bumps `N`, and the old file is removed in the same pull request.

**Rationale**: it is the same shape as `routing.v1.jsonl` (feature 002) and the privacy
corpus (feature 004), so there is one convention across the repository.

## R-04 Leak = a verbatim annotated value in what any non-local chain target would receive **(review)**

**Decision**: for each case, call `POST /v1/simulate` with the case's messages.
- **What is sent.** `providerMessages` when present (anonymize: placeholders plus the
  notice), otherwise the original messages.
- **Leak.** An annotated value is leaked when it appears verbatim (after NFC
  normalization), in the message where it is annotated, and the chain contains at least
  one target whose residency is not `local`.
- **No leak.** Blocked decisions leak nothing.
- **Rate.** Per kind: leaked values ÷ annotated values of that kind.
- **Gate.**
  - critical kinds (DNI, NIE, NSS, IBAN, CREDIT_CARD) must be `= 0`;
  - PERSON, EMAIL and PHONE must each be `< 0.02`;
  - CIF and LOCATION are reported only.
- **Detector failures.** Counted. More than zero makes the run an error (exit 2), because
  a fail-closed route would hide a detection gap.

**Rationale**:
- Every chain target counts, because a fallback can reach it.
- Verbatim search catches both missed detection and broken anonymization.
- The simulation runs the real inspection, policy and anonymization code (feature 005),
  so no provider is needed and the eval is deterministic given the services.

**Alternatives**:
- only the first target: understates risk;
- an MSW-captured real request: same result at more cost;
- partial-match search (surname only): noisy, and a rule for later (edge cases list).

## R-05 Synthetic datasets are generated, checked in, and guarded by `--check` **(review)**

**Decision**:
- **Generator.** `packages/evals/scripts/generate-pii-datasets.ts`, with a seeded PRNG.
  It writes:
  - `pii-leak-es.v1.jsonl`: ≥ 150 request-shaped cases. They cover chat, summarize,
    extract and translate wording, single and multi-message requests, the health, legal,
    fintech and HR contexts, and 0–4 values per case.
  - `pii-detection-es.v1.jsonl`: held-out sentences with ≥ 150 annotated values, using
    harder formats: lowercase control letters, missing or extra separators, values at
    sentence start and end, adjacent values, and names with particles ("de la", "del").
- **Values.** Identifiers carry valid control characters: DNI/NIE letter, CIF control,
  IBAN mod 97, NSS mod 97, Luhn for cards. Names come from invented first-name and
  surname lists.
- **Different from the development corpus.** Templates and name lists differ from
  `services/privacy/scripts/generate_corpus.py`, and the seed is different.
- **Guard.** `--check` regenerates in memory and fails if the files differ; CI runs it.

**Rationale**: generation makes the datasets reproducible and reviewable; the held-out
templates keep the detection figure honest (spec US3).

**Alternatives**:
- hand-writing 300 cases: slow, with error-prone offsets;
- reusing the privacy corpus: it measures what the recognizers were tuned on.

## R-06 Routing eval reuses `routing.v1.jsonl` through the simulation endpoint

**Decision**:
- **Scoring.** Each case is sent to `POST /v1/simulate` with its `model`. The score is the
  match of `chain[0].id` against `expected.route` (and `blockReason` for blocked
  expectations, if any are added later). Task-type agreement is reported.
- **Gate.** ≥ 0.95.
- **When the real inspection disagrees.** A case whose route changes because the real
  inspection finds incidental data is fixed in a `routing.v2.jsonl`, reviewed. The
  feature 002 unit gate keeps reading v1 until then.

**Rationale**: it adds the real inspection to the routing check without duplicating the
dataset.

## R-07 Quality: two arms through the gateway, a blind judge, a relative gate **(review)**

**Decision**:
- **Dataset.** `quality-es.v1.jsonl`: ≥ 24 cases in Spanish and English (summaries,
  extraction, short chat, translation). Each has a reference answer written for it, with
  no personal data.
- **Routed arm.** `POST /v1/chat/completions` with `model: tamiz-local` (the existing
  `pinned-local` rule): the cheapest route, the one whose quality is in question.
- **Comparison arm.**
  - With `TAMIZ_EVAL_FRONTIER=on`: the same request with `model: tamiz-frontier`, a new
    `pinned-frontier` rule (route `[anthropic-sonnet]`) added to the default policy in
    `T-007-05`.
  - Otherwise: the accepted baseline score in `packages/evals/baselines/quality.json`.
    It is keyed by answering model, judge model, dataset version and judge prompt
    version.
- **Judge.**
  - Called directly on an OpenAI-compatible endpoint (Ollama locally and in CI). It is not
    production traffic, and the references hold no personal data.
  - Prompt: `packages/evals/prompts/judge.v1.md`. It asks for a JSON
    `{ "score": 1-5, "rationale": "<= 30 words" }`, with temperature 0 and a fixed seed.
  - The answer's origin is never in the prompt.
  - An unparseable reply is retried once, then becomes an error. More than 10 % errors
    makes the eval an error.
- **Metric.** Mean score normalized to [0, 1]. The gate is `routed ≥ 0.95 × comparison`.
- **CI models.**
  - Gateway under test for quality: a second instance with
    `packages/evals/policies/quality-ci.yaml`. Its only target is the local one, on
    `qwen2.5:1.5b`.
  - Judge: `qwen2.5:3b`.
  - Both are pinned by tag in the workflow and recorded in the report.

**Rationale**:
- A 1.5B model judged against gold references would always be far more than 5 % below
  them, so an absolute-vs-reference gate could never pass in CI.
- The CI gate therefore catches regressions (a prompt, notice or routing change that
  degrades local answers).
- The frontier-gap claim is measured with keys and published separately.

**Alternatives**:
- run the frontier in CI: needs secrets on every pull request and costs money;
- `llama3.1:8b` in CI: about 30 minutes on a CPU runner;
- an absolute judge score threshold: depends on the judge model.

## R-08 Cost eval is an estimate over routing, plus actual usage over quality

**Decision**:
- **Routing dataset.** Per case, input tokens use the gateway's estimate rule (characters
  ÷ 4, the same as `estimateTokens`) and output tokens a fixed 300. Two costs are priced
  from the policy's prices, which the simulation response does not carry, so the evals
  read them from the policy file named in the dataset header:
  - the first target of the decided chain;
  - the baseline target (the most expensive, as in feature 006).
- **Quality run.** The usage returned by the routed arm is priced the same way.
- **Report.** Totals, baseline, saving %, labelled "estimate" where estimated. No
  threshold.

**Rationale**: it is cheap and deterministic, and matches the feature 006 baseline.

## R-09 Report: a contract in `@tamiz/contracts`, rendered to Markdown

**Decision**:
- **Schema.** `EvalReportSchema` lives in `packages/contracts/src/evals.ts`, because the
  dashboard (008) reads the report (constitution II). It holds:
  - run metadata: started, duration, git SHA, datasets with versions, policy id and
    version, service versions, models;
  - per eval: status `pass` | `fail` | `error` | `skipped`, metrics `{ name, value,
    threshold?, comparison?, pass? }` and failing cases `{ id, reason, expected, actual }`.
- **Files.** `reports/evals.json` and `reports/evals.md`; `reports/` is git-ignored except
  the last accepted report used for the README.
- **README.** `pnpm evals:readme [--report path]` rewrites the table between
  `<!-- evals:start -->` and `<!-- evals:end -->`.
- **CI.** The job appends `evals.md` to `$GITHUB_STEP_SUMMARY`.

## R-10 No dataset value in any output

**Decision**:
- **Failing cases.** Reported as `{ id, kind, messageIndex, start, end }` plus the
  decision fields.
- **Exclusions.** The quality judge's rationale is excluded from reports for cases
  without a reference.
- **Errors.** Error messages from services are truncated to their `type`.
- **Test.** It runs the evals against fake services and greps the JSON, Markdown and
  console output for every annotated value (FR-005).

**Rationale**: the values are synthetic, but the habit and the test are the product's.
A report that prints them would be copied into issues and logs.

## R-11 CI: a separate `evals` job with containers and cached models

**Decision**: `.github/workflows/ci.yml` gains a job `evals` (parallel to `ci`, timeout 20
minutes). It:
1. checks out, installs and builds;
2. builds and starts the privacy image (`docker build services/privacy`; the model is in
   the image);
3. starts Ollama (`ollama/ollama` container) and pulls `qwen2.5:1.5b` and `qwen2.5:3b`,
   with `~/.ollama` cached by `actions/cache`;
4. starts two gateways (`node apps/gateway/dist/main.js`):
   - one with `default.yaml` and fake cloud keys (never called: simulation only);
   - one with `quality-ci.yaml`;
5. waits for health;
6. runs `pnpm evals`, uploads `reports/` as an artifact, and writes the summary.

The job becomes a required check of `main` once it merges (Alex changes the setting).

**Rationale**: a separate job keeps the fast `ci` job unchanged, and the cache keeps the
model pull out of most runs. SC-006 (< 15 minutes) is measured in `T-007-06`. If it is
exceeded, the quality eval moves to a scheduled workflow and the pull request job keeps
leak, detection and routing. That fallback is recorded rather than silently accepted.

## R-12 Exit codes and error semantics

**Decision**: `0` means every selected eval passed; `1` means at least one failed a
threshold; `2` means a setup, dataset or service error. Error wins over fail. A skipped
eval never makes a run pass that would otherwise fail.

**Rationale**: CI and humans must distinguish "the product got worse" from "the harness
broke" (US1-3).
