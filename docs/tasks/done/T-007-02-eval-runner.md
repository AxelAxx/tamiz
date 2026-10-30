# T-007-02 — Eval runner: datasets, thresholds, report, CLI

| Field | Value |
|---|---|
| Task | `T-007-02` (see `docs/tasks/BACKLOG.md`) |
| Feature | `007-evals-gate` |
| Spec | `specs/007-evals-gate/spec.md` (FR-001 … FR-005, FR-010; US1-1 … US1-6, US4-1, US4-2); `tasks.md` Phase 1 (T001–T011); `research.md` R-01 … R-03, R-06, R-09, R-12 |
| Branch / PR | `T-007-02-eval-runner` / PR opened after this commit |
| Date | 2026-10-30 |
| Session | Claude Code (Claude Opus 5.5), side session (merge authority delegated by Alex) |
| Status | done |

## What was done

`packages/evals` is now the `@tamiz/evals` workspace package. `pnpm evals` runs the evals
against the running services and gates them.

- **Report contract.** `EvalReportSchema` lives in `@tamiz/contracts` (`evals.ts`). Its
  failing-case maps hold scalars only. It caps the list at 50 and keeps the total.
- **Datasets.** A JSONL loader validates the header and every case before any scoring:
  case schemas for routing, leak, detection and quality, unique ids, offsets inside the
  message. Errors read `file:line: problem` and never quote content.
- **Thresholds.** Every bar from the spec is in one file. A gated metric that an eval does
  not produce makes the eval an `error`, so a bar cannot quietly disappear.
- **Runner.** It skips unselected or unconfigured evals, observes cases with bounded
  concurrency, then scores, summarizes and attaches the thresholds. Exit codes: 0 pass,
  1 below threshold, 2 error. An error wins over a failure, and a run where nothing ran is
  an error, so a misconfigured CI cannot pass.
- **Reports.** `evals.json` is validated before writing; `evals.md` holds a summary table,
  metrics with their bars, and failing cases by id. The console shows one line per eval
  plus diagnostics.
- **Gateway client.** It calls `/v1/simulate` and `/health`, parses responses with the
  contracts, and maps failures to typed service errors: `unavailable`, `timeout`,
  `http_<status>`, `contract`.
- **First real eval: routing.** It runs `routing.v1.jsonl` through the simulation
  endpoint, which uses the real privacy inspection. The gate is ≥ 95 % expected first
  routes, and mismatches are listed with route, rule and sensitivity.

## Files touched

- `packages/contracts/src/evals.ts` (new), `index.ts`.
- `packages/evals/`:
  - `package.json`, `tsconfig*.json`, `vitest.config.ts` (new);
  - `src/{datasets,thresholds,config,eval,runner,cli}.ts`, `src/report/{markdown,write}.ts`, `src/clients/gateway.ts`, `src/evals/routing.ts` (new);
  - tests `test/{datasets,thresholds-and-report,runner}.test.ts`;
  - `README.md`.
- Root `package.json`: the `evals` script. Also `pnpm-lock.yaml`, `CLAUDE.md` §12, `specs/007-evals-gate/tasks.md` (T001–T011 ticked) and `docs/tasks/BACKLOG.md`.

## Decisions

- **Evals are a typed record of functions** (`prepare` → `observe`, `score`, `summarize`).
  `register()` erases the case type into a closure, so the registry needs no `any`
  (constitution VII).
- **Client failures are exceptions (`ServiceError`), caught by the runner.** This is a CLI
  at the edge; the scorers and metrics stay pure.
- **`evals:readme` is not added yet.** The README generator arrives with `T-007-06`
  (T029), where the spec places it. The root `evals` script builds the package and its
  dependencies through Turborepo, then runs the CLI.
- **`--only` with an eval that is not implemented yet** (leak, detection, quality, cost)
  is exit 2 with "not implemented yet", never a silent skip.
- **The policy in the report** is read from the dataset header's policy file (id and
  version), using the `yaml` dependency planned in R-08.

## How it was verified

```bash
pnpm lint        # clean (pre-existing warning and infos only)
pnpm typecheck   # 0 errors
pnpm arch        # ✔ no dependency violations found (124 modules, 437 dependencies cruised)
pnpm test        # Test Files 95 passed (95); Tests 965 passed | 27 skipped (992)
pnpm build       # pass
```

- The evals suite has 35 tests: datasets, thresholds, the report example, Markdown, and the
  CLI against an MSW gateway. The CLI tests cover exit 0 / 1 / 2, `--only`, invalid flags
  and config, a missing gated metric, and no dataset text in console, JSON or Markdown.
- **Real run.** `pnpm evals` against the real privacy service and a real gateway with the
  default policy: `✓ routing route_accuracy 100.00 % (≥ 95.00 %)`, 44/44, exit 0.
  The real inspection changed no expected route, so no `routing.v2.jsonl` is needed so
  far; `T-007-04` re-checks this with the mismatch reporting.

## Pending / follow-ups

- `T-007-03`, `T-007-04`, `T-007-05`, `T-007-06` as planned. No new backlog rows.

## Pitfalls for the next session

- **Stopping a background `pnpm exec tsx …` on Windows does not stop its node children.**
  A gateway from an earlier run kept port 3000. The real run above still went against a
  default-policy gateway with the real privacy service; the new one failed with
  `EADDRINUSE`. Kill the children by command line
  (`Get-CimInstance Win32_Process … CommandLine -match "main.ts"`) after a local run.
- **The report example in `specs/007-evals-gate/contracts/` is parsed by a test.**
  Change it together with `EvalReportSchema`.

## Links

- Spec / plan / tasks: `specs/007-evals-gate/`
- ADRs: none added
- Related task records: `docs/tasks/done/T-007-01-spec-plan-tasks-007.md`, `docs/tasks/done/T-002-08-routing-dataset.md`
