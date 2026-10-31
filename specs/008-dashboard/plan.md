# Implementation Plan: Dashboard

**Branch**: `008-dashboard` | **Date**: 2026-10-31 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/008-dashboard/spec.md`

## Summary

`apps/dashboard` becomes `@tamiz/dashboard`, a Next.js 16 App Router app organised by
feature, with seven screens over endpoints the gateway already has, plus one new pair:

- **live traffic** (polls `GET /v1/admin/audit` with an overlap window, deduplicated);
- **simulator** (`POST /v1/simulate`, entities highlighted at their offsets, the decision
  flow);
- **audit log** (filters in the URL, keyset "load older");
- **cost** (`GET /v1/admin/cost`, actual vs baseline);
- **providers** (`GET /v1/admin/providers`);
- **evals** (report files validated by `EvalReportSchema`);
- **policy editor** (CodeMirror YAML, shape check in the browser, new
  `GET`/`PUT /v1/admin/policy` in the gateway with version bump and conflict detection,
  persisted in PostgreSQL when configured).

The browser only talks to the dashboard's own allow-listed route handlers, which hold the
admin key and parse every gateway answer with the contracts. Operators sign in with a
passphrase. The look comes from Claude Design: [`design-brief.md`](design-brief.md) goes
out, the design comes back into `design/`, and no screen is built before gate `G1`.

## Technical Context

**Language/Version**: TypeScript 5.x strict, ESM, Node.js 22 LTS (dashboard and gateway).

**Primary Dependencies**:
- dashboard: `next@16`, `react@19`, `tailwindcss@4`, shadcn/ui (Radix primitives, copied
  into `components/ui`), shadcn Charts (`recharts`), `@tanstack/react-query`,
  `@tanstack/react-table`, `react-hook-form` + `@hookform/resolvers`, `zod` (catalog),
  `motion`, `lucide-react`, `next-themes`, `hono` (`hc` client only), `@tamiz/contracts`;
- added by this plan (review): `@codemirror/*` and `yaml` for the policy editor (R-12);
- dev: `vitest`, `@testing-library/react`, `jsdom`, `@playwright/test`,
  `@axe-core/playwright`;
- gateway: no new runtime dependency (Drizzle is already there).

**Storage**: the dashboard stores sessions in memory and reads eval reports from a folder;
the gateway adds the `policy_versions` table (R-10).

**Testing**:
- gateway: contract and in-process HTTP tests for the policy endpoints; Testcontainers for
  the PostgreSQL policy repository (conflict under concurrency, boot from history);
- dashboard: Vitest for the pure logic (merge and dedupe, highlighting, issue-to-line,
  formatting, session, origin check, env);
- Playwright flows against the E2E gateway (R-13), one test per scenario, axe on every
  screen.

**Target Platform**: Node.js 22 container (non-root) behind the operator's reverse proxy;
locally `next dev` on port 3100. Browsers: the two latest Chromium, Firefox, Safari.

**Project Type**: monorepo; one new app, one gateway slice (policy admin), contract additions,
one CI job.

**Performance Goals**: new audit entries visible within 5 s (SC-001); simulation result in
under 2 s with the fake detector (SC-002); the E2E job under 10 minutes (SC-006); first
load of a screen under 2 s on a laptop against a local gateway.

**Constraints**:
- the admin key never reaches the browser (FR-002), enforced by `server-only` imports and an
  E2E search;
- no content from the gateway is shown, and simulator input is never persisted (FR-013,
  FR-014);
- WCAG 2.2 AA basics (FR-020);
- no screen before the design gate (FR-024).

**Scale/Scope**:
- 11 backlog tasks (`T-008-02` … `T-008-11`, two of them new);
- 7 screens plus sign-in, 11 BFF endpoints, 2 gateway endpoints, 1 table, 1 CI job;
- 24 FRs, 9 stories, 56 scenarios.

## Constitution Check

| # | Principle | How this plan complies | Status |
|---|---|---|---|
| I | Strict Clean Architecture | Gateway: `ReplacePolicy`/`GetActivePolicy` in `application`, `validatePolicy` stays in `domain`, the two repositories in `infrastructure`, the routes in `presentation`; dependency-cruiser unchanged. Dashboard: organised by feature (`features/*`), routes thin, server-only code in `lib/server`. | PASS |
| II | Contract-first | `ActivePolicySchema`, `ReplacePolicyRequestSchema`, the envelope's `issues` and `conflict` are added to `packages/contracts` before the route; the dashboard parses every gateway answer with the contracts. | PASS |
| III | Spec before code | This spec, plan and tasks; each scenario maps to one test (`tasks.md` table); the design gate adds a visual spec before UI code. | PASS |
| IV | Evals are executable spec | The dashboard adds no AI behaviour; it displays the eval report. Policy edits can lower routing quality: the eval job still gates the default policy in CI, and the evals screen shows each run's policy version. | PASS |
| V | Privacy by default | No content shown or logged (FR-013); simulator text never persisted (FR-014); BFF logs no bodies; the policy save log has a hash, not the document. | PASS |
| VI | Fail fast, never silently | Env validated at start (FR-005); contract mismatches are errors, never partial renders (FR-006); invalid policies refused with every issue; conflicts refused, never merged. | PASS |
| VII | Strict TypeScript | Same configs for the dashboard (`@tamiz/tsconfig`), `hc` typed from the gateway's route type. | PASS |
| VIII | Testability | Use cases tested with in-memory fakes; dashboard logic is pure functions; browser flows run offline against fakes. | PASS |
| IX | Composition over inheritance | BFF handlers are composed from `withSession`, `withOrigin`, `callGateway(schema)`. | PASS |
| X | Simplicity | Polling instead of a push channel; files instead of an evals endpoint; one passphrase instead of an identity provider; the policy port gains methods only because a second adapter (PostgreSQL) needs them. | PASS |

Re-check after Phase 1: unchanged, PASS. Two stack additions (CodeMirror 6, `yaml`) are not
in `CLAUDE.md` §4 and are flagged for review (R-12).

## Project Structure

### Documentation (this feature)

```text
specs/008-dashboard/
├── spec.md              # Draft spec
├── plan.md              # This file
├── research.md          # R-01 … R-16
├── data-model.md        # Contracts added, policy store, sessions, browser state
├── quickstart.md        # How a reviewer runs and checks the dashboard
├── design-brief.md      # Component inventory for Claude Design (the hand-off)
├── design/              # What comes back from Claude Design (gate G1; created by Alex)
├── contracts/
│   ├── gateway-policy.md         # GET/PUT /v1/admin/policy
│   ├── dashboard-bff.md          # the dashboard's own endpoints
│   └── replace-policy.example.json
├── checklists/requirements.md
└── tasks.md             # /speckit-tasks output
```

### Source Code (repository root)

```text
packages/contracts/src/
├── error.ts                    # + conflict, + issues
├── policy-admin.ts             # new: ActivePolicy, ReplacePolicyRequest
└── chat-completion.ts          # + MAX_BODY_BYTES
apps/gateway/
├── src/application/ports/policy-repository.port.ts      # + getActiveVersion, replace
├── src/application/use-cases/{get-active-policy,replace-policy}.ts
├── src/infrastructure/policy/{in-memory,postgres}-policy-repository.ts
├── src/infrastructure/persistence/schema.ts              # + policy_versions
├── src/presentation/routes/admin/policy.ts               # GET, PUT
├── src/presentation/app.ts                               # chained routes, GatewayRoutes type
├── drizzle/0001_policy_versions.sql
└── scripts/e2e-gateway.ts                                # real app + fakes + control port
apps/dashboard/
├── package.json  next.config.ts  tsconfig.json  vitest.config.ts  playwright.config.ts
├── Dockerfile  .env.example  README.md
├── data/evals/                       # committed demo snapshot of a CI report
├── scripts/hash-passphrase.ts
├── e2e/                              # Playwright: one file per screen, titles = scenario ids
└── src/
    ├── proxy.ts                      # session gate for pages (Next.js 16)
    ├── app/                          # routes only
    │   ├── (auth)/sign-in/page.tsx
    │   ├── (console)/layout.tsx      # shell from the design
    │   ├── (console)/{live,simulator,audit,cost,providers,evals,policy}/page.tsx
    │   └── api/{session,health,gateway-health,audit,cost,providers,simulate,policy,evals}/route.ts
    ├── features/
    │   ├── live-traffic/   audit-log/   cost-analytics/   provider-health/
    │   ├── eval-results/   policy-editor/{editor,simulator}/
    │   └── shared/                   # entry detail, badges, entity chips, formatters
    ├── components/ui/                # shadcn
    └── lib/
        ├── api-client.ts             # browser: fetch /api/* + contract parsing for TanStack Query
        ├── schemas.ts                # BFF-only shapes
        └── server/{env,gateway,session,origin,evals}.ts   # import "server-only"
.github/workflows/ci.yml              # + e2e job (T-008-09)
docker-compose.yml                    # + dashboard (T-008-09)
```

**Structure Decision**: the feature folders of the foundational document (§4.5), plus
`provider-health/` and `shared/`. The simulator lives under `policy-editor/` as the backlog
names it, but has its own route (`/simulator`) because it is the demo's entry point.

## Requirement → task mapping

| Backlog task | Requirements | Stories |
|---|---|---|
| `T-008-02` Non-visual skeleton: Next.js app, env, sign-in and sessions, origin check, BFF with `hc` and contract parsing, `GatewayRoutes` type, TanStack Query, Playwright and the E2E gateway, Turbo; unstyled placeholder pages | FR-001 … FR-006, FR-022 | US1 |
| `T-008-10` **Design gate** and shell: `design/` received (G1); tokens, app shell, navigation, theme toggle, sign-in page, shared components (badges, chips, entry detail, states) | FR-019 … FR-021, FR-024 | US9 (shell), US1-2 (sign-in UI) |
| `T-008-03` Live traffic | FR-007, FR-013 | US2, US9-4 |
| `T-008-04` Simulator | FR-008, FR-013, FR-014 | US3 |
| `T-008-05` Audit log | FR-009 | US4 |
| `T-008-06` Cost analytics (cuttable) | FR-010 | US7 |
| `T-008-07` Eval results | FR-012 | US6 |
| `T-008-11` Provider health | FR-011 | US8 |
| `T-008-08` Policy editor and the gateway policy endpoints | FR-015 … FR-018 | US5 |
| `T-008-09` Dockerfile, compose, CI `e2e` job, accessibility sweep, feature polish | FR-020, FR-022, FR-023 | US1-6, US9 |

Order: `T-008-02` → `T-008-10` (needs G1) → (`T-008-03`, `T-008-04`, `T-008-05`,
`T-008-07`, `T-008-11`, `T-008-06` in any order; `T-008-08` after `T-008-04`) → `T-008-09`.

`T-008-02` can start before the design arrives: it renders no designed UI. Every other task
except the gateway half of `T-008-08` waits for G1. The gateway half of `T-008-08` (contracts,
use cases, repositories, routes) does not depend on the design and may be done first inside
that task.

## Complexity Tracking

No violations. For review:
- **R-02:** chaining the gateway's route registration so `hc` is typed.
- **R-03:** operator passphrase and in-memory sessions.
- **R-09:** eval reports from a folder, not from the gateway.
- **R-10:** policy history in PostgreSQL, memory fallback with a visible warning.
- **R-11:** `issues` and `conflict` in the shared error envelope.
- **R-12:** CodeMirror 6 and `yaml`, outside the listed stack.
