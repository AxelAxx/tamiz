# Implementation Plan: Citara Integration

**Branch**: `T-010-02-citara-guide-and-client` (implementation; this plan is on
`010-citara-integration`) | **Date**: 2026-10-31 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/010-citara-integration/spec.md`

## Summary

Citara integrates by pointing an unmodified OpenAI client at Tamiz with a client key. The
feature ships, inside this repository, the integration guide `docs/integrations/citara.md`
and a tested example client `examples/citara-client/` (TypeScript, official `openai`
library, SDK retries off, own retry rule, Tamiz headers reported, optional audit check by
request id through the admin API). Tests run the example over real HTTP against the
gateway's existing E2E harness, which gains opt-in scripted providers and a `citara`
client key. Documentation tests keep the guide's header, error, configuration and model
tables equal to the gateway's OpenAPI document, the contracts, the example's configuration
and the default policy. No gateway production code, contract, policy or privacy rule
changes (FR-015). The recorded full-stack run moves to a new backlog row, `T-010-03`.

## Technical Context

**Language/Version**: TypeScript 5.x strict, ESM, Node.js 22 LTS.

**Primary Dependencies**: `openai` 7.47.0 (new, pinned exactly, example only; R-02); Zod 4
(config); `@tamiz/contracts` (error types and statuses, audit entry schema). The harness
change uses what the gateway already has.

**Storage**: N/A (the harness's audit log is in memory).

**Testing**: Vitest. Unit tests of `runExample` with a fake `fetch`; end-to-end tests over
HTTP against the E2E harness started in a Vitest `globalSetup` on free ports; documentation
tests over the guide's marked tables (R-09).

**Target Platform**: any machine with Node 22 and pnpm; no Docker, Ollama or provider keys
for the automated part. The full-stack run (`T-010-03`) needs `docker compose`.

**Project Type**: monorepo; one new private workspace package and one test-tooling change.

**Performance Goals**: the example's end-to-end suite runs in under 30 s locally (one
harness process for the whole suite, reset between tests).

**Constraints**: the example never prints keys or prompts; no gateway production change;
existing dashboard Playwright tests unchanged (harness defaults unchanged).

**Scale/Scope**: 21 tasks: T001 – T020 in one backlog task (`T-010-02`), T021 the recorded
run (`T-010-03`).

## Constitution Check

| # | Principle | How this plan complies |
|---|---|---|
| I | Clean Architecture | No gateway layer is touched; the harness script already sits outside `src/` and is outside dependency-cruiser's scope. The example is a small, flat client: config, run, report, audit check. |
| II | Contract-first | No new public contract. The example reads error types and the audit entry schema from `@tamiz/contracts`; the guide's tables are checked against `/openapi.json`, which derives from the contracts. |
| III | Spec before code | This spec, plan and tasks; every scenario maps to one test (tasks.md table) except US5, a recorded manual run in `T-010-03`. Implementation waits for Alex's approval. |
| IV | Evals | No AI behaviour added; existing gated evals cover routing, detection, leak and quality (R-10). A Citara-shaped slice waits for D1. |
| V | Privacy by default | The example prints no key or prompt (US1-5, US3-3 marker test); the guide states what is and is not stored; the harness holds only synthetic fixture markers. |
| VI | Fail fast | Invalid config exits 2 naming the variable; every error is reported with its type; an audit entry not found is a failure, never a silent success. |
| VII | Strict TS | Shared strict tsconfig; no `any`; Zod-parsed config and audit entries. |
| VIII | Testability | `runExample` takes `fetch`, `sleep`, `now` and the writer as dependencies; end-to-end tests use the harness, not the network or a database. |
| IX | Composition | Plain functions; no classes. |
| X | Simplicity | No gateway change, no new port, no new alias; the audit lookup scans a narrow window instead of adding a filter (R-07). |

Gate: pass. Post-design re-check: pass.

## Project Structure

### Documentation (this feature)

```text
specs/010-citara-integration/
├── spec.md
├── plan.md                     # this file
├── research.md                 # R-01 … R-12 (decisions D1-D7)
├── data-model.md
├── quickstart.md
├── contracts/
│   └── integration-contract.md
├── checklists/requirements.md
└── tasks.md
```

### Source Code (files added or touched by `T-010-02`)

```text
docs/integrations/
├── README.md                   # one paragraph: what this folder is
└── citara.md                   # the guide, with marked tables (R-09)
examples/
├── README.md                   # one paragraph: runnable examples, not shipped
└── citara-client/
    ├── package.json            # @tamiz/example-citara-client, private; start, test, typecheck, build
    ├── tsconfig.json, tsconfig.build.json, vitest.config.ts
    ├── README.md
    ├── src/
    │   ├── config.ts           # ExampleConfig (Zod), exit 2 on invalid
    │   ├── classify.ts         # error type → ErrorClass, retry-after parsing
    │   ├── report.ts           # RunReport lines, redaction
    │   ├── audit-check.ts      # admin audit lookup by request id
    │   ├── run-example.ts      # runExample(config, deps) → exit code
    │   └── main.ts             # wires process env, global fetch, stdout
    └── test/
        ├── global-setup.ts     # starts the harness with scripted providers on free ports
        ├── unit/*.test.ts      # config, classify, report, audit-check, run-example (fake fetch)
        ├── e2e/*.test.ts       # US1-US3 against the harness
        └── guide.test.ts       # US4 documentation tests
apps/gateway/scripts/e2e-gateway.ts   # TAMIZ_E2E_PROVIDERS=scripted, provider calls/script, citara key
apps/gateway/package.json             # none expected (script exists)
pnpm-workspace.yaml                   # + examples/*
vitest.config.ts                      # projects + examples/*
CLAUDE.md                             # §6 layout and §12 command for the example
```

**Structure Decision**: a top-level `examples/` folder for runnable client examples that
Tamiz does not ship (R-04); the guide under `docs/integrations/`.

## Requirement → task mapping

| Requirements | Tasks (tasks.md) |
|---|---|
| FR-001, FR-008 | T001, T003, T008, T009 |
| FR-009, FR-010, FR-012 | T004, T005, T008, T010, T012, T015 |
| FR-011 | T014, T015 |
| FR-013 | T002, T006 |
| FR-002 – FR-007, FR-014 | T016, T017 |
| FR-015 | T019 (diff check) |
| US5 | T021 = backlog `T-010-03` |

## Backlog changes made by `T-010-01`

- `T-010-01` → `done (draft)` pending Alex's approval of the spec.
- `T-010-02` deliverable and definition of done narrowed to the guide, the example and
  their tests against the harness; depends on `T-010-01` only (was also `T-OPS-01`).
- New row `T-010-03`: recorded run against `docker compose` (US5), depends on `T-010-02`
  and `T-OPS-01`.

## Complexity Tracking

| Addition | Why needed | Simpler alternative rejected because |
|---|---|---|
| New workspace package for one example | The example must be linted, typechecked and tested in CI to stay correct | A loose script in `docs/` rots silently |
| Scripted providers in the E2E harness | The example's tests must see an answer and what the provider received | A second harness duplicates the gateway wiring |
| A new pinned dependency (`openai`) | Drop-in compatibility is only shown with the provider's own SDK | `fetch` alone does not prove an unmodified client works |
