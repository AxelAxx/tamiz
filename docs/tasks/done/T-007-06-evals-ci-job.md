# T-007-06 — CI evals job, README table and the gate

| Field | Value |
|---|---|
| Task | `T-007-06` (see `docs/tasks/BACKLOG.md`) |
| Feature | `007-evals-gate` |
| Spec | `specs/007-evals-gate/spec.md` (FR-014, FR-015; US6-1 … US6-5; SC-005 … SC-007); `tasks.md` Phase 5 (T028–T035); `research.md` R-09, R-11 |
| Branch / PR | `T-007-06-evals-ci-job` / PR #46 |
| Date | 2026-10-31 |
| Session | Claude Code (Claude Opus 5.5), side session (merge authority delegated by Alex) |
| Status | done. **One action is Alex's: mark `evals` as a required check of `main`** (repository setting) |

## What was done

**CI job `evals`** (`.github/workflows/ci.yml`), in parallel with `ci`, with a 25-minute
timeout. It:
1. builds the workspace;
2. builds and starts the privacy image;
3. starts Ollama (`ollama/ollama:0.40.5`) with the models cached by `actions/cache`
   (v6.1.0, pinned by SHA), and pulls `qwen2.5:1.5b` (answers) and `qwen2.5:3b` (judge);
4. starts two gateways with a fresh masked client key: `default.yaml` on 3000 with
   unused fake cloud keys, and `quality-ci.yaml` on 3200;
5. waits for health and runs the evals;
6. writes `evals.md` to the job summary, uploads `packages/evals/reports/` as
   `evals-report`, and dumps the service logs on failure.

**README.**
- `pnpm evals:readme -- --report <evals.json>` (`src/readme-cli.ts`,
  `src/report/readme.ts`) rewrites the table between `<!-- evals:start -->` and
  `<!-- evals:end -->`. Missing, duplicated or reversed markers exit 2.
- The README gains an "Evals" section with the table generated from the CI report, and
  the status line moves to 007.

**Quality baseline.** The first CI run measured `qwen2.5:1.5b` judged by `qwen2.5:3b`:
mean **0.875**, with 0 judge errors (run 41186335451). That run failed on purpose with
`baseline_missing`. The score was accepted in `baselines/quality.json`, and the next run
measured 0.875 again (relative 1.00).

**Docs.**
- `CLAUDE.md`: section 10 (where results, thresholds and the baseline live) and
  section 12 (`evals:readme`, `generate:datasets`, two CI jobs).
- `docs/architecture.md`: an "Evals in CI" diagram and table.
- `packages/evals/README.md`: quality baselines.

**Runner.** A dataset shared by two evals (routing and cost) is listed once in the report.

## Results (CI, run 41187796710)

| Eval | Result |
|---|---|
| Leak | critical 0 %, PERSON 1 %, EMAIL/PHONE 0 % |
| Detection | structured recall 100 %, PERSON 89.1 % |
| Routing | 100 % (44/44) |
| Quality | mean 0.875, relative 1.00 against the baseline |
| Cost | $0.0376 vs $0.2913, saving 87.1 % |

**Duration (SC-006).** The job takes 5.5–6.6 min: evals about 200 s, privacy image build
about 70 s, Ollama start and pull about 50 s. It is under 15 min, so the R-11 fallback (a
scheduled quality run) is not needed.

## The gate (SC-005, T034)

- **Raised baseline.** Commit 76fabb9 raised the accepted quality score to 0.99, which
  simulates a 12 % regression. The `evals` job failed with
  `✗ quality relative_score 85.23 % (≥ 95.00 %)`, exit 1:
  https://github.com/AxelAxx/tamiz/actions/runs/41187241459. The `ci` job stayed green, so
  the block is the evals job's own.
- **Revert.** Commit 3f4a782 reverted it, and `evals` passed again:
  https://github.com/AxelAxx/tamiz/actions/runs/41187796710.
- **Still to do (Alex).** The block only prevents merging once `evals` is a required
  check. Add it under Settings → Branches → `main` → required status checks, next to
  `ci`. Changing branch protection is a repository setting, so this session did not
  change it.

## Files touched

- `.github/workflows/ci.yml` (`evals` job; the old commented placeholder removed).
- `packages/evals/src/report/readme.ts`, `src/readme-cli.ts` (new); `src/runner.ts` (dataset dedupe); `package.json` (`evals:readme`); `baselines/quality.json`; `policies/quality-ci.yaml` (CPU-friendly resilience: deadline 300 s, one attempt); `README.md`.
- Root `package.json` (`evals:readme`); `README.md` (Evals section, status); `CLAUDE.md`; `docs/architecture.md`.
- Tests: `packages/evals/test/readme.test.ts` (new).
- `specs/007-evals-gate/tasks.md` (T028–T035 ticked: feature complete), `docs/tasks/BACKLOG.md`.

## Decisions

- **The demonstration used the quality baseline, not a routing expectation.** The routing
  dataset is also read by the gateway's unit gate in the `ci` job, so editing it would
  have failed both jobs and not shown the evals gate alone.
- **The gateways listen on 127.0.0.1** and the containers publish to 127.0.0.1 only. The
  fake cloud keys are never used: those evals only simulate.
- **The quality CI policy has long deadlines and no retries.** CPU inference queues on one
  model, and a slow answer must be measured, not abandoned.

## Quickstart run (T035)

- §1 suites green.
- §2 `generate:datasets --check` is part of `pnpm test`.
- §3 and §4 ran in CI (run 41187796710) and locally for leak, detection, routing and cost
  (`T-007-03` … `T-007-05`).
- §5 is the demonstration above.
- §6 regenerated the README table from the CI report.

## Pending / follow-ups

- **Alex:** add `evals` to the required checks of `main`.
- **Frontier comparison** (`TAMIZ_EVAL_FRONTIER=on`): needs an Anthropic key; not run. No
  backlog row until keys exist.

## Pitfalls for the next session

- **A new answering or judge model, prompt version or dataset version** has no baseline:
  the job reports `baseline_missing` (exit 2) with the measured score. Accept it from the
  CI artifact in a reviewed commit.
- **`git revert` followed by `--amend` rewrote the previous commit.** The revert had not
  applied, so the amend changed the demonstration commit instead. Make a plain new commit
  for reverts on shared branches.

## Links

- Spec / plan / tasks: `specs/007-evals-gate/`
- Related task records: `docs/tasks/done/T-007-05-quality-cost-evals.md`
