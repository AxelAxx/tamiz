# T-007-01 — Spec, plan and tasks for `007-evals-gate`

| Field | Value |
|---|---|
| Task | `T-007-01` (see `docs/tasks/BACKLOG.md`) |
| Feature | `007-evals-gate` |
| Spec | `specs/007-evals-gate/spec.md` |
| Branch / PR | `007-evals-gate` (Spec Kit naming), cut from `main` at 329e228 / PR opened after this commit |
| Date | 2026-10-30 |
| Session | Claude Code (Claude Opus 5.5), side session |
| Status | done; spec reviewed and approved by Alex on 2026-10-30 without changes (`spec.md` flipped to `Approved` in the same PR) |

## What was done

The Spec Kit set for feature 007:

- **`spec.md`**: 6 stories and 27 scenarios, FR-001 … FR-015, SC-001 … SC-007, edge cases
  and assumptions.
- **`checklists/requirements.md`**: all items pass.
- **`plan.md`**: no constitution violations; the requirement → backlog mapping.
- **`research.md`**: R-01 … R-12.
- **`data-model.md`**: datasets, thresholds, runner types, report, quality baseline, run
  states.
- **`contracts/`**:
  - `cli.md`: commands, environment, exit codes, README markers;
  - `datasets.md`: header and case shapes; the example offsets and the DNI control letter
    were checked;
  - `report.example.json`.
- **`quickstart.md`**.
- **`tasks.md`**: 35 tasks in 5 phases, one per backlog task, with the scenario coverage
  table.

## Decisions (flagged for Alex's review)

- **The runner talks to the running services over HTTP (R-01)**, through their public
  contracts (`/v1/simulate`, `/v1/chat/completions`, `/analyze`). `packages/evals`
  imports no app.
- **Leak definition (R-04).** An annotated value counts as leaked when it appears verbatim
  in what any non-local target of the decided chain would receive, fallbacks included.
  Thresholds are per kind:
  - critical kinds (DNI, NIE, NSS, IBAN, card): 0 %;
  - names, emails and phones: < 2 % each;
  - CIF and places: reported only, since the default policy lets them leave.

  `CLAUDE.md` §10 names "DNI, IBAN" as critical. The spec uses the privacy service's
  critical level, which also includes NIE, NSS and card.
- **Detection is measured on a held-out generated dataset (R-05)**, with templates, names
  and a seed different from the privacy service's development corpus, and harder formats.
  The corpus gate inside the privacy service stays as it is.
- **The quality gate in CI is relative to an accepted baseline (R-07).**
  - The roadmap's "no more than 5 % below the frontier route" cannot be measured in CI
    without paid keys.
  - A 1.5B local model judged against gold references would always fail an absolute
    comparison.
  - So in CI the gate catches regressions: no more than 5 % below the accepted score for
    the same small models, recorded in `baselines/quality.json`.
  - The frontier gap is measured when keys are configured and reported in the README.
  - This needs a new `pinned-frontier` rule in the default policy, added in `T-007-05`.
- **CI models:** `qwen2.5:1.5b` answers and `qwen2.5:3b` judges, with a second gateway
  instance using `quality-ci.yaml`.
  - The 15-minute budget is measured in `T-007-06`.
  - If it is exceeded, quality moves to a scheduled workflow, and the pull request job
    keeps leak, detection and routing.
- **Exit codes: 0 pass, 1 below threshold, 2 harness or service error (R-12).** A detector
  failure during the leak eval is an error, not a pass, because fail-closed routing would
  hide a detection gap.
- **The `evals` job becomes a required check.** That is a repository setting for Alex to
  change when `T-007-06` merges.

## How it was verified

- Documentation only.
- `report.example.json` is valid JSON. It is parsed against `EvalReportSchema` in
  `T-007-02`.
- The dataset examples' offsets and the DNI control letter were computed.
- Scenario coverage: every scenario of the spec maps to a task in the `tasks.md` table.
- `pnpm lint` green.

## Pending / follow-ups

- No new backlog rows.
- `T-007-05` adds a `pinned-frontier` rule to `apps/gateway/policies/default.yaml`; the
  routing dataset's expectations are unaffected, since no case requests that model.

## Pitfalls for the next session

- **The real inspection can change routing expectations.** The routing dataset was written
  against a clean inspection (feature 002). A case with incidental personal data may route
  differently through the real privacy service; `T-007-04` handles it with a reviewed
  `routing.v2.jsonl`.
- **The spaCy model flags short greetings as `low`.** It did in the feature 006
  quickstart run. With the default policy `low` is `allow`, so routes do not change, but
  the leak eval's LOCATION and PERSON counts will include such noise.
- **Docker is not running on this machine.** The CI job is the first full run with
  containers.

## Links

- Spec / plan / tasks: `specs/007-evals-gate/`
- ADRs: none added
- Related task records: `docs/tasks/done/T-002-08-routing-dataset.md`, `docs/tasks/done/T-004-07-corpus-and-metrics.md`, `docs/tasks/done/T-005-06-simulate-endpoint.md`
