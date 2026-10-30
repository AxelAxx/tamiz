# Implementation Plan: Evals Gate

**Branch**: `007-evals-gate` | **Date**: 2026-10-30 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/007-evals-gate/spec.md`

## Summary

`packages/evals` becomes the `@tamiz/evals` workspace package: a CLI runner, Zod-validated
JSONL datasets, pure scorers and metrics, one thresholds file, and a JSON + Markdown report
whose schema lives in `@tamiz/contracts`. The evals talk to the running services over
HTTP:

- **leak** (`POST /v1/simulate`, every chain target, verbatim search): 0 % critical,
  < 2 % names, emails and phones;
- **detection** (`POST /analyze` on a held-out dataset): recall ≥ 0.95 on structured
  identifiers, ≥ 0.80 on names;
- **routing** (`routing.v1.jsonl` via the simulation endpoint): ≥ 95 %;
- **quality** (two arms through the gateway, a blind local judge): ≤ 5 % below the frontier
  with keys, or below the accepted baseline in CI;
- **cost**: reported against the baseline target.

A new CI job `evals` starts the privacy service, two gateways and Ollama with small models,
runs everything, uploads the report, and blocks below threshold. `pnpm evals:readme`
publishes the table.

## Technical Context

**Language/Version**: TypeScript 5.x strict, ESM, Node.js 22 LTS.

**Primary Dependencies**:
- `zod` (catalog);
- `@tamiz/contracts`;
- `yaml`, to read the policy file for prices (R-08);
- Node built-ins: `fetch`, `node:util` `parseArgs`, `node:crypto` for the seeded PRNG.

No eval framework. Dev: `vitest`, `msw` (fake services in runner tests).

**Storage**: files only: `packages/evals/datasets/*.jsonl`, `baselines/quality.json`,
`prompts/judge.v1.md`, `reports/`.

**Testing**:
- Vitest unit tests for the scorers, metrics, thresholds, dataset validation, report
  rendering and README markers (toy datasets, no network);
- runner tests against MSW fakes of the three services (exit codes 0/1/2, the
  no-value-in-output check);
- the evals themselves, run in the CI `evals` job against real services.

**Target Platform**:
- GitHub Actions `ubuntu-latest`, with Docker for the privacy image and Ollama;
- locally on Windows without Docker: the evals run against the privacy service with `uv`,
  the gateway with `tsx`, and Ollama if installed (quality is skipped otherwise, and says
  so).

**Project Type**: monorepo; one package gains code, one contract module and one workflow
job are added.

**Performance Goals**: the `evals` job finishes in under 15 minutes (SC-006); leak,
detection and routing together take under 2 minutes after the services are up.

**Constraints**:
- no dataset value in any output (FR-005);
- `packages/evals` imports no app;
- evals never call paid providers in CI;
- deterministic everywhere except the quality arm, which is pinned by model tag, seed and
  temperature 0.

**Scale/Scope**:
- 5 backlog tasks;
- 4 new datasets (leak, detection, quality, plus routing v1 reused);
- 5 evals, 1 contract module, 1 CI job;
- 15 FRs, 6 stories, 27 scenarios.

## Constitution Check

| # | Principle | How this plan complies | Status |
|---|---|---|---|
| I | Strict Clean Architecture | `packages/evals` imports only `@tamiz/contracts`. The gateway gains one policy rule (`pinned-frontier`, `T-007-05`) and no code. | PASS |
| II | Contract-first | `EvalReportSchema` in `packages/contracts/src/evals.ts`; the dashboard (008) reads it. Datasets are Zod-validated. | PASS |
| III | Spec before code | This spec, plan and tasks; each scenario maps to a test (`tasks.md` table). | PASS |
| IV | Evals are executable spec | This feature *is* principle IV: every AI behaviour of 002–006 gets a dataset and a threshold, and CI fails below. | PASS |
| V | Privacy by default | Synthetic data only; no value in reports or logs (FR-005, tested); the judge sees no personal data. | PASS |
| VI | Fail fast, never silently | Exit `2` on harness or service errors; detector failures fail the run instead of passing; skipped evals are reported. | PASS |
| VII | Strict TypeScript | Same configs; branded ids where they cross the contract. | PASS |
| VIII | Testability | Scorers and metrics are pure; the runner is tested against MSW fakes. | PASS |
| IX | Composition over inheritance | An eval is a record of functions; the runner composes them. | PASS |
| X | Simplicity | No eval framework, no database; HTTP plus files. | PASS |

Re-check after Phase 1: unchanged, PASS.

## Project Structure

### Documentation (this feature)

```text
specs/007-evals-gate/
├── spec.md              # Approved spec
├── plan.md              # This file
├── research.md          # R-01 … R-12
├── data-model.md        # Dataset lines, observations, outcomes, report
├── quickstart.md        # How a reviewer runs and checks the gate
├── contracts/
│   ├── cli.md           # Command, flags, environment, exit codes, README markers
│   ├── datasets.md      # Header and case shapes per dataset
│   └── report.example.json
├── checklists/requirements.md
└── tasks.md             # /speckit-tasks output
```

### Source Code (repository root)

```text
packages/contracts/src/evals.ts                  # EvalReportSchema (+ index export)
packages/evals/
├── package.json  tsconfig*.json  vitest.config.ts  README.md
├── datasets/  routing.v1.jsonl  pii-leak-es.v1.jsonl  pii-detection-es.v1.jsonl  quality-es.v1.jsonl
├── baselines/quality.json
├── prompts/judge.v1.md
├── policies/quality-ci.yaml
├── scripts/generate-pii-datasets.ts             # seeded, --check
├── src/
│   ├── cli.ts                 # parseArgs → run → exit code
│   ├── config.ts              # env (Zod)
│   ├── datasets.ts            # JSONL loader + schemas
│   ├── thresholds.ts          # every bound, one file
│   ├── runner.ts              # validate → observe (bounded concurrency) → score → report
│   ├── report/{json,markdown,readme}.ts
│   ├── clients/{gateway,privacy,judge}.ts       # fetch + contract parsing
│   ├── evals/{leak,detection,routing,quality,cost}.ts
│   └── synthetic/{prng,identifiers,names}.ts    # generator helpers
└── test/…
apps/gateway/policies/default.yaml               # + pinned-frontier rule (T-007-05)
.github/workflows/ci.yml                         # + evals job (T-007-06)
README.md                                        # evals table between markers
turbo.json, package.json                         # evals and evals:readme tasks
```

**Structure Decision**: the runner and datasets sit together in `packages/evals`, as the
foundational document places them. The report schema is in `packages/contracts` because
an app (the dashboard) consumes it.

## Requirement → task mapping

| Backlog task | Requirements | Stories |
|---|---|---|
| `T-007-02` Runner: package, datasets loader, thresholds, report (JSON/Markdown), CLI, exit codes, `EvalReportSchema`, the routing eval moved onto the runner | FR-001 … FR-005, FR-010 | US1, US4 |
| `T-007-03` Generator, leak and detection datasets, leak and detection evals | FR-006 … FR-009 | US2, US3 |
| `T-007-04` Routing eval against the real inspection; a routing v2 if needed | FR-010 | US4 |
| `T-007-05` Quality dataset, judge prompt, `pinned-frontier` rule, quality and cost evals, baseline file, `quality-ci.yaml` | FR-011 … FR-013 | US5 |
| `T-007-06` CI `evals` job, artifacts, summary, `evals:readme`, README table, the required-check demonstration | FR-014, FR-015 | US6 |

Order: `T-007-02` → (`T-007-03`, `T-007-04`, `T-007-05` in any order) → `T-007-06`.

`T-007-02` ships the routing eval as the runner's first real eval: the smallest end-to-end
proof. `T-007-04` then adds the mismatch reporting and any v2 dataset.

## Complexity Tracking

No violations. For review:
- **R-04:** leak counts every chain target, verbatim, after NFC normalization.
- **R-05:** generated held-out datasets, not hand-written ones.
- **R-07:** in CI the quality gate catches regressions against an accepted baseline for
  small local models. The frontier-gap claim is measured with keys and reported.
- **R-11:** a separate CI job; making it required is Alex's setting.
