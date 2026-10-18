# Implementation Plan: Contracts and Skeleton

**Branch**: `001-contracts-and-skeleton` | **Date**: 2026-10-18 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/001-contracts-and-skeleton/spec.md`

## Summary

Stand up the Tamiz monorepo so that every later feature inherits the same gates: a pnpm
+ Turborepo workspace with Biome, shared strict TypeScript configs, commitlint and
Renovate; a `@tamiz/contracts` package holding the Zod 4 schemas and branded types that
every API speaks; a Hono gateway skeleton laid out in Clean Architecture layers with
`Result<T, E>`, Zod-validated environment config, a redacting pino logger and
`GET /health`; a `@tamiz/test-utils` package with `FakeClock` and builders; and
dependency-cruiser rules plus a GitHub Actions pipeline (lint → typecheck → depcruise →
test → build) that protects `main`. The only runtime behaviour is the health endpoint;
everything else is enforcement that is proven by tests and by one deliberate violation.

## Technical Context

**Language/Version**: TypeScript 5.x (strict, `noUncheckedIndexedAccess`,
`exactOptionalPropertyTypes`), ESM (`"type": "module"`, `module: NodeNext`), Node.js 22
LTS (pinned with `.nvmrc`, `engines`, `packageManager`).

**Primary Dependencies**: pnpm 10 workspaces · Turborepo 2 · Biome 2 · Zod 4 · Hono 4 +
`@hono/node-server` + `@hono/zod-validator` · pino 10 · dependency-cruiser 17 ·
commitlint 20 + husky 9 · Renovate (hosted app, config only) · tsx (dev runner).

**Storage**: N/A (no persistence in this feature).

**Testing**: Vitest (root `vitest.config.ts` with `test.projects`, `@vitest/coverage-v8`);
Hono `app.request()` for in-process HTTP; one child-process test for the boot failure;
type-level tests with `expectTypeOf` / `// @ts-expect-error`.

**Target Platform**: Linux containers and GitHub Actions `ubuntu-latest`; developed on
Windows 11 (Git Bash + PowerShell). Everything must run on both.

**Project Type**: monorepo (one web service + libraries).

**Performance Goals**: `/health` < 50 ms in-process, < 200 ms over HTTP (SC-007);
fresh clone to all gates green < 5 min locally, < 10 min in CI (SC-001).

**Constraints**: domain layer has zero external imports; no `any`; prompt-like fields
never reach log output; invalid env stops the process before binding a port; CI is a
single required status check named `ci`.

**Scale/Scope**: 4 workspace packages (`apps/gateway`, `packages/contracts`,
`packages/test-utils`, `packages/tsconfig`), 4 contract schemas, 1 endpoint, 5
architecture rules, 1 workflow. Backlog tasks `T-001-02` … `T-001-06`.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| # | Principle | How this plan complies | Status |
|---|---|---|---|
| I | Strict Clean Architecture | Four layer folders + `main.ts`; five dependency-cruiser rules (FR-021) fail CI (`T-001-05`). `domain` ships `result.ts`, `errors.ts` with zero imports. | PASS |
| II | Contract-first | All four schemas live in `packages/contracts` as Zod 4; types via `z.infer`; `/health` response is validated against the schema in its test. OpenAPI generation (`@hono/zod-openapi`) is wired in feature 002 with the first real endpoint; `contracts/openapi.yaml` here is a review projection, not a shipped artefact. | PASS |
| III | Spec before code | This plan follows the approved `spec.md`; every acceptance scenario maps to a test or pipeline step in `tasks.md`. | PASS |
| IV | Evals are executable spec | No AI behaviour in this feature; no dataset needed. The pipeline leaves a named `evals` placeholder for feature 007. | N/A |
| V | Privacy by default | pino `redact` paths for `prompt`, `messages`, `authorization` (FR-016) with a test corpus; no DB, no traces yet. | PASS |
| VI | Fail fast, never silently | `loadConfig()` returns `Result`; `main.ts` exits non-zero with the Zod issue list (FR-015); unknown routes and errors return typed envelopes (FR-019). | PASS |
| VII | Strict TypeScript | `packages/tsconfig/base.json` enables the three flags; Biome `noExplicitAny: error`; branded types for ids and units (FR-011). | PASS |
| VIII | Testability | `ClockPort` in `application/ports`; `FakeClock` in `test-utils`; unit tests have no network; `app.request()` avoids sockets. | PASS |
| IX | Composition over inheritance | Hono middlewares are functions; `Result` helpers are functions; no classes for behaviour (a `FakeClock` factory, not a class hierarchy). | PASS |
| X | Simplicity | Only one port (`ClockPort`) because a test needs it; no repository, no use case yet; no OpenAPI generator yet; one env schema. | PASS |
| — | English-only (ADR-0002) | All artefacts in English. | PASS |
| — | Task protocol | One PR per backlog task `T-001-02` … `T-001-06`; this spec work is `T-001-01`. | PASS |

No violations; Complexity Tracking is empty.

**Post-design re-check (after Phase 1)**: unchanged. The only design question that
could have added a package (where `ClockPort` lives so that `test-utils` can implement
it) is resolved structurally (see `research.md` R-09) without a new package.

## Project Structure

### Documentation (this feature)

```text
specs/001-contracts-and-skeleton/
├── spec.md              # Approved specification (T-001-01)
├── plan.md              # This file
├── research.md          # Phase 0: decisions R-01 … R-12
├── data-model.md        # Phase 1: schemas, branded types, Result, config
├── quickstart.md        # Phase 1: how to verify the feature end to end
├── contracts/
│   ├── README.md        # How the OpenAPI projection relates to the Zod source
│   └── openapi.yaml     # Review projection of health, error and chat completion
├── checklists/requirements.md
└── tasks.md             # Phase 2 (/speckit-tasks)
```

### Source Code (repository root)

```text
tamiz/
├── package.json                 # private, Apache-2.0, engines node 22, packageManager pnpm
├── pnpm-workspace.yaml          # apps/*, packages/*
├── turbo.json                   # tasks: lint, typecheck, arch, test, build
├── biome.json                   # root config, recommended + noExplicitAny error
├── vitest.config.ts             # test.projects: packages/*, apps/*
├── commitlint.config.ts         # extends @commitlint/config-conventional
├── .husky/commit-msg            # pnpm commitlint --edit $1
├── renovate.json                # config:recommended, grouped minor/patch, semantic commits
├── .nvmrc                       # 22
├── .dependency-cruiser.cjs      # five layer rules over apps/gateway/src
├── .github/workflows/ci.yml     # job "ci": lint → typecheck → arch → test → build
├── packages/
│   ├── tsconfig/
│   │   ├── base.json            # strict + the three flags, NodeNext, ES2022
│   │   ├── library.json         # declaration, composite, outDir dist
│   │   └── node-app.json        # for apps/gateway
│   ├── contracts/
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── branded.ts       # RequestId, PolicyId, Usd, Milliseconds
│   │   │   ├── chat-completion.ts
│   │   │   ├── health.ts
│   │   │   └── error.ts
│   │   └── test/*.test.ts       # + branded.test-d.ts (type tests)
│   └── test-utils/
│       └── src/
│           ├── index.ts
│           ├── fake-clock.ts
│           └── builders.ts      # chatCompletionRequest(), healthResponse()
└── apps/gateway/
    ├── src/
    │   ├── domain/
    │   │   ├── README.md
    │   │   ├── result.ts
    │   │   └── errors.ts
    │   ├── application/
    │   │   ├── README.md
    │   │   └── ports/clock.port.ts
    │   ├── infrastructure/
    │   │   ├── README.md
    │   │   ├── config/env.ts            # Zod env schema → Result<GatewayConfig, ConfigurationError>
    │   │   ├── logging/logger.ts        # pino + redact
    │   │   └── clock/system-clock.ts    # ClockPort adapter
    │   ├── presentation/
    │   │   ├── README.md
    │   │   ├── app.ts                   # createApp({ clock, version }) → Hono
    │   │   ├── routes/health.ts
    │   │   ├── middlewares/request-id.ts
    │   │   └── mappers/error-envelope.ts
    │   └── main.ts                      # composition root
    └── test/
        ├── health.test.ts               # app.request()
        ├── env.test.ts
        ├── logger.test.ts
        └── boot.integration.test.ts     # child process, invalid env
```

**Structure Decision**: the monorepo layout of `CLAUDE.md` section 6 and the gateway
layers of section 5, reduced to what this feature needs. `apps/dashboard`,
`apps/mcp-server`, `services/privacy` and `packages/evals` keep only their README until
their features start; they are not workspace packages yet (no `package.json`), so
`pnpm install` ignores them.

## Requirement → task mapping

| Backlog task | Requirements | Spec stories |
|---|---|---|
| `T-001-02` Monorepo tooling | FR-001, FR-002, FR-003, FR-004, FR-005 | US1 |
| `T-001-03` `packages/contracts` | FR-006 … FR-012 | US2 |
| `T-001-04` Gateway skeleton | FR-013 … FR-020 | US3, US4, US5 |
| `T-001-05` Architecture limits + CI | FR-021 … FR-024 | US6 |
| `T-001-06` `packages/test-utils` + Vitest | FR-025, FR-026 | US7 |

Order: `T-001-02` → `T-001-03` → `T-001-04` → `T-001-05` → `T-001-06`, as in the
backlog. `T-001-06` depends only on `T-001-04` and could run in parallel with `T-001-05`
if two sessions are available.

## Complexity Tracking

No constitution violations to justify.
