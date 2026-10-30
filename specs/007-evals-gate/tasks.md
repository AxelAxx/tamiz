---

description: "Task list for feature 007-evals-gate"
---

# Tasks: Evals Gate

**Input**: `specs/007-evals-gate/` (`plan.md`, `spec.md`, `research.md` R-01 … R-12,
`data-model.md`, `contracts/`, `quickstart.md`); features 002–006 merged; this spec
approved by Alex (`T-007-01`).

**Tests**: Mandatory. They are written before the code, and every scenario maps to a test
(table below).

**Organization**: Phases are the backlog tasks `T-007-02` … `T-007-06`, one PR each.
`evals/` abbreviates `packages/evals/`, `contracts/` abbreviates `packages/contracts/`, and
`gateway/` abbreviates `apps/gateway/`.

## Scenario coverage

| Scenario | Task | Scenario | Task |
|---|---|---|---|
| US1-1 all pass → exit 0, report | T002, T003 | US3-3 names ≥ 0.80, places reported | T017 |
| US1-2 below threshold → exit 1, failing ids | T002, T003 | US4-1 routing ≥ 95 % via simulate | T010, T021 |
| US1-3 service down → exit 2, named | T003 | US4-2 mismatch details | T021 |
| US1-4 bad dataset → file and line | T001 | US4-3 no model call, no audit entry | T021 |
| US1-5 selection, skipped listed | T003 | US5-1 judge score + rationale, routed mean | T025 |
| US1-6 provenance in the report | T002, T004 | US5-2 frontier arm, ≤ 5 % below | T025 |
| US2-1 critical leak = any non-local target | T015 | US5-3 CI: ≤ 5 % below the accepted baseline | T025 |
| US2-2 names/emails/phones verbatim = leak | T015 | US5-4 versioned prompt, blind judge, recorded | T024, T025 |
| US2-3 blocked → no leak | T015 | US5-5 cost routed vs baseline | T026 |
| US2-4 0 % critical, < 2 % high | T015, T019 | US6-1 job starts services, uploads reports | T031 |
| US2-5 low kinds reported only | T015 | US6-2 below threshold → job fails, summary | T031, T034 |
| US3-1 precision/recall per kind | T017 | US6-3 required check blocks merge | T034 |
| US3-2 structured recall ≥ 0.95 | T017, T019 | US6-4 README table from report | T032 |
| | | US6-5 job < 15 minutes | T031, T034 |

---

## Phase 1: `T-007-02` — Runner, report contract, routing on the runner (US1, US4 first slice)

### Tests first

- [x] T001 [P] [US1] `evals/test/datasets.test.ts` covers:
  - the header and case schemas for the four datasets;
  - unique ids;
  - offsets within the message;
  - an invalid line, which is reported with file and line (US1-4).
- [x] T002 [P] [US1] `evals/test/thresholds-and-report.test.ts` covers:
  - each comparison (`eq`, `lt`, `lte`, `gte`) at, above and below its bound;
  - the run status (error > fail > pass);
  - the JSON report, which validates against `EvalReportSchema`;
  - the Markdown rendering and its 50-case cap;
  - the provenance fields (US1-1, US1-2, US1-6).
- [x] T003 [US1] `evals/test/runner.test.ts` runs the CLI against MSW fakes of the gateway
  and privacy service. It checks:
  - exit 0 when everything passes, 1 below threshold, 2 when a service is down (the
    service is named) or answers off-contract;
  - `--only`, with skipped evals listed;
  - that no dataset value appears in the console, JSON or Markdown output (FR-005)
    (US1-1 … US1-3, US1-5).

### Implementation

- [x] T004 `contracts/src/evals.ts`: `EvalReportSchema` and its types, exported; the
  example in `specs/007-evals-gate/contracts/report.example.json` parses.
- [x] T005 `evals/package.json`, the tsconfigs and `vitest.config.ts` make `@tamiz/evals`
  a private ESM package. Register it in the root Vitest projects and turbo tasks. Add the
  root scripts `evals` and `evals:readme`.
- [x] T006 `evals/src/config.ts` (Zod env), `datasets.ts` (JSONL loader and schemas) and
  `thresholds.ts` (the table in `data-model.md` §2).
- [x] T007 `evals/src/runner.ts`: validate, then observe with bounded concurrency, then
  score, metrics, compare and status. Exit code mapping per R-12.
- [x] T008 `evals/src/report/{json,markdown}.ts`; `evals/src/cli.ts` (`parseArgs`).
- [x] T009 `evals/src/clients/gateway.ts`: simulate and chat completions, with responses
  parsed by the contracts.
- [x] T010 [US4] `evals/src/evals/routing.ts` runs over `routing.v1.jsonl`, scoring
  `chain[0].id` against `expected.route`.
- [x] T011 `evals/README.md` (package usage); `.gitignore` for `evals/reports/`; gates;
  record; backlog row.

## Phase 2: `T-007-03` — PII datasets, leak and detection evals (US2, US3)

### Tests first

- [ ] T012 [P] [US2] `evals/test/synthetic.test.ts` covers:
  - the PRNG is deterministic;
  - identifier generators produce valid control characters (DNI/NIE letter, CIF, IBAN
    mod 97, NSS, Luhn);
  - names and templates are disjoint from the privacy corpus lists;
  - `--check` detects a changed file.
- [ ] T013 [P] [US2] `evals/test/leak-scorer.test.ts`, toy cases for scenarios US2-1 …
  US2-5:
  - a critical value reaching a non-local fallback;
  - a verbatim name after `anonymize` (a leak) and a placeholder (no leak);
  - a blocked decision;
  - the notice text is searched;
  - NFC normalization;
  - a detector failure, which is an error;
  - low kinds are reported only.
- [ ] T014 [P] [US3] `evals/test/detection-scorer.test.ts`: exact kind-and-offset matching,
  per-kind precision and recall, overlapping findings.

### Implementation

- [ ] T015 [US2] `evals/src/evals/leak.ts`; `evals/src/clients/privacy.ts`.
- [ ] T016 `evals/scripts/generate-pii-datasets.ts` and `evals/src/synthetic/*`. Generate
  `pii-leak-es.v1.jsonl` (≥ 150 cases) and `pii-detection-es.v1.jsonl` (≥ 150 values) with
  the harder formats of FR-009. Add the script `generate:datasets` with `--check`.
- [ ] T017 [US3] `evals/src/evals/detection.ts` over `/analyze`.
- [ ] T018 Run both evals locally against the real privacy service and gateway, and record
  the figures in the task record.
- [ ] T019 If a gate fails on the real services:
  - fix the cause in the privacy service or the policy, in this PR when small;
  - never fix it by editing a bound;
  - otherwise, record it and add a backlog task.

  Gates; record; backlog row.

## Phase 3: `T-007-04` — Routing against the real inspection (US4)

- [ ] T020 [P] [US4] `evals/test/routing-scorer.test.ts`: mismatch details (expected and
  actual route, rule, task type, sensitivity), plus blocked expectations.
- [ ] T021 [US4] Mismatch reporting in `evals/src/evals/routing.ts`.
  - Run against the real services.
  - If a case's route changes because the real inspection finds incidental data, write
    `routing.v2.jsonl` and update the feature 002 unit gate to read it, in the same PR.
  - Confirm, through the gateway's audit endpoint, that the run wrote no audit entries
    (US4-3).
- [ ] T022 Gates; record; backlog row.

## Phase 4: `T-007-05` — Quality and cost (US5)

### Tests first

- [ ] T023 [P] [US5] `evals/test/quality-scorer.test.ts` covers:
  - judge output parsing, with one retry and then an error;
  - more than 10 % errors makes the eval an error;
  - normalization and the relative gate against the frontier arm and against the
    baseline;
  - a missing baseline gives `baseline_missing`.
- [ ] T024 [P] [US5] `evals/test/judge-prompt.test.ts`: the prompt file is versioned and
  never contains the route or model of the answer (US5-4).

### Implementation

- [ ] T025 [US5] Implement the quality eval:
  - the dataset `quality-es.v1.jsonl` (≥ 24 cases, with references free of personal
    data, checked by a test);
  - the judge prompt `evals/prompts/judge.v1.md` and the judge client
    `evals/src/clients/judge.ts`;
  - `evals/src/evals/quality.ts`, with two arms: `tamiz-local`, and `tamiz-frontier` or
    the baseline;
  - `evals/policies/quality-ci.yaml`;
  - a `pinned-frontier` rule in `gateway/policies/default.yaml`, with its policy test.
- [ ] T026 [US5] `evals/src/evals/cost.ts`, per R-08: the estimate over routing plus the
  actual usage over quality.
- [ ] T027 Record the first accepted baseline in `evals/baselines/quality.json` from a run
  with the CI models.
  - Run the frontier comparison once with keys if they are available, and record the gap;
    otherwise say so.
  - Gates; record; backlog row.

## Phase 5: `T-007-06` — CI job and README (US6)

- [ ] T028 [P] [US6] `evals/test/readme.test.ts`: the table between the markers is
  replaced; a missing or duplicated marker gives exit 2 (US6-4).
- [ ] T029 `evals/src/report/readme.ts`; the README markers and a first table.
- [ ] T030 Add a `## Evals` section to `README.md` (what is measured, thresholds,
  limitations) with the generated table.
- [ ] T031 [US6] Add the `evals` job to `.github/workflows/ci.yml`:
  - privacy image;
  - Ollama container with the model cache;
  - two gateways;
  - health waits;
  - `pnpm evals`;
  - artifact and step summary;
  - a 20-minute timeout.

  Measure the duration; apply the fallback of R-11 if it exceeds 15 minutes.
- [ ] T032 [US6] Run `pnpm evals:readme` from the CI report artifact and commit the table.
- [ ] T033 Update `CLAUDE.md` section 12 (`pnpm evals`, `evals:readme`,
  `generate:datasets`) and section 10 (link to the report).
- [ ] T034 [US6] Demonstrate the gate:
  - in a scratch PR, drop one routing expectation below threshold;
  - check that the job fails with the case in the summary;
  - revert, and check it passes;
  - ask Alex to mark `evals` as a required check;
  - record the links.
- [ ] T035 Run the quickstart and record it. Polish: README status (007),
  `docs/architecture.md` (the evals in the CI pipeline). Gates; record; backlog row.

## Dependencies

```text
T-007-02 ─┬─▶ T-007-03 ─┐
          ├─▶ T-007-04 ─┼─▶ T-007-06
          └─▶ T-007-05 ─┘
```

Within a phase: tests first, then implementation; `[P]` tasks touch different files.

## Totals

| Phase | Backlog | Tasks |
|---|---|---|
| 1 | `T-007-02` | T001–T011 (11) |
| 2 | `T-007-03` | T012–T019 (8) |
| 3 | `T-007-04` | T020–T022 (3) |
| 4 | `T-007-05` | T023–T027 (5) |
| 5 | `T-007-06` | T028–T035 (8) |
| **Total** | | **35** |

## Implementation strategy

- **MVP.** `T-007-02` alone is a working gate: the routing eval on the runner, with
  reports and exit codes.
- **The privacy promise.** `T-007-03` adds it, and the cut order forbids cutting it.
- **Order.** `T-007-05` is the slowest and least deterministic, so it lands after the P1
  evals. `T-007-06` turns everything into a blocking check.
