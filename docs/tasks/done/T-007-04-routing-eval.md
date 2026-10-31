# T-007-04 — Routing eval against the real inspection

| Field | Value |
|---|---|
| Task | `T-007-04` (see `docs/tasks/BACKLOG.md`) |
| Feature | `007-evals-gate` |
| Spec | `specs/007-evals-gate/spec.md` (FR-010; US4-1 … US4-3; SC-003); `tasks.md` Phase 3 (T020–T022); `research.md` R-06 |
| Branch / PR | `T-007-04-routing-eval` / PR opened after this commit |
| Date | 2026-10-31 |
| Session | Claude Code (Claude Opus 5.5), side session (merge authority delegated by Alex) |
| Status | done |

## What was done

The routing eval is now complete.

**Mismatch report.** A mismatch shows the expected and the actual route, rule, task type,
size and sensitivity, as FR-010 asks. Task-type agreement is reported next to the gated
route accuracy.

**Simulate contract.** `POST /v1/simulate` gains `taskType` and `size`, the classification
that the matched rule used. The task type was not in the simulation's answer, and FR-010
needs it in the report. Changes:
- the contract in `@tamiz/contracts`;
- the route mapping;
- the feature 005 example;
- a new gateway test.

**Blocked expectations.** An expected route of `block` passes only when the request is
blocked; a blocked request with any other expectation fails with the reason `blocked`.

## Results (real run, 2026-10-31)

The run used the real privacy service and the real gateway (`default.yaml`, simulation
only, port 3100).
- `pnpm evals` → exit 0;
- route accuracy 100 % (44/44), task-type accuracy 100 %;
- leak and detection unchanged from `T-007-03`.

**US4-3, no audit entries.** `GET /v1/admin/audit` returned 0 entries before and after the
run, which made 364 simulations. A gateway test already covers this:
`apps/gateway/test/audit/with-audit.test.ts`, "simulations are not audited". No model is
called, by construction of the simulation.

**No `routing.v2.jsonl`.** The real inspection changes no expected route, so the feature
002 unit gate and the eval keep reading `routing.v1.jsonl`.

## Files touched

- `packages/contracts/src/simulate.ts` (`taskType`, `size`); `specs/005-privacy-aware-routing/contracts/simulate.example.json`.
- `apps/gateway/src/presentation/routes/simulate.ts`; `apps/gateway/test/simulate.test.ts`.
- `packages/evals/src/evals/routing.ts` (`scoreRouting`, `BLOCK`, mismatch fields, `task_type_accuracy`); `packages/evals/test/scorers.test.ts`, `runner.test.ts` (fakes carry the new fields).
- `specs/007-evals-gate/tasks.md` (T020–T022 ticked), `docs/tasks/BACKLOG.md`.

## Decisions

- **The simulate contract is widened, not worked around.** The alternative was to show
  only the expected task type, which would not meet FR-010. The new fields are required:
  the gateway always knows them, and the only consumers (the eval, and later the
  dashboard simulator) are in this repository.

## How it was verified

```bash
pnpm lint        # clean (pre-existing warning and infos only)
pnpm typecheck   # 0 errors
pnpm arch        # ✔ no dependency violations found
pnpm test        # all green (see the PR)
pnpm build       # pass
```

The evals package has 55 tests, including the routing scorer: route match, blocked
expectations, mismatch fields. The audit count check above was run for real.

## Pending / follow-ups

- No new backlog rows.

## Pitfalls for the next session

- **Every fake simulate response must now carry `taskType` and `size`.** The evals parse
  responses with the contract, so a fake without them is a `contract` error (exit 2).

## Links

- Spec / plan / tasks: `specs/007-evals-gate/`
- Related task records: `docs/tasks/done/T-007-03-leak-detection-evals.md`, `docs/tasks/done/T-005-06-simulate-endpoint.md`
