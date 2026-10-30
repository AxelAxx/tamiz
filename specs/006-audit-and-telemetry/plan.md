# Implementation Plan: Audit and Telemetry

**Branch**: `006-audit-and-telemetry` | **Date**: 2026-10-30 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/006-audit-and-telemetry/spec.md`

## Summary

The inference use cases gain an audit step: once per request, at its end, they build an
`AuditEntry` (pure domain) from the decision, the inspection counts, the served or failed
chain, usage and cost. They hand it to an `AuditLogPort` without waiting.

Two adapters implement the port:
- **in-memory:** a bounded ring buffer, used when there is no database;
- **PostgreSQL:** Drizzle, versioned migrations, and an asynchronous batching writer with
  a bounded queue, whose drops are reported as events.

API keys move to a Drizzle table, hashed, with a role and revocation; the environment
keys keep working. Admin endpoints under `/v1/admin/*` require the `admin` role:
- `audit`: filters, keyset cursor;
- `cost`: actual vs baseline, grouped by day, route or model;
- `providers`: circuit state plus a recent window from the audit log.

Telemetry is a second consumer:
- an OpenTelemetry tracer wraps each request in a span and each provider attempt in a
  child span, with the GenAI semantic-convention attributes;
- a `RoutingEventsPort` sink turns routing and privacy events into span events;
- the OTLP exporter is configured by the standard OTel environment variables, and
  Jaeger joins `docker-compose.yml`.

## Technical Context

**Language/Version**: TypeScript 5.x strict, ESM, Node.js 22 LTS.

**Primary Dependencies**:
- the 001–005 set;
- `drizzle-orm` with the `postgres` (postgres.js) driver, plus `drizzle-kit` (dev) for
  generating migrations;
- `@opentelemetry/api`, `@opentelemetry/sdk-trace-node` (or `sdk-trace-base`),
  `@opentelemetry/exporter-trace-otlp-http`, `@opentelemetry/resources` and
  `@opentelemetry/semantic-conventions` (incubating entry for `gen_ai.*`);
- dev: `testcontainers` (`postgres:17`), already present for Valkey.

Exact versions are fixed when each task installs them (newest stable at the time, checked
with Context7).

**Storage**: PostgreSQL 17 with two tables, `audit_entries` and `api_keys`, plus Drizzle's
migrations table. The in-memory audit log is the fallback.

**Testing**:
- Vitest;
- in-memory audit log and span exporter for unit and HTTP tests;
- Testcontainers PostgreSQL for the repositories, the SQL filters, the aggregates and the
  100 000-row timing (skipped with a reason locally, run in CI);
- a no-content capture test extended to audit entries, database rows and spans (FR-015).

**Target Platform**: Linux containers, GitHub Actions (Docker available); developed on
Windows 11 (no Docker locally, as in feature 003).

**Project Type**: monorepo, unchanged.

**Performance Goals**:
- audit write overhead < 2 ms p95 (SC-003);
- an admin audit page < 200 ms p95 over 100 000 rows (SC-004).

**Constraints**:
- no content in entries, rows or spans (V);
- audit failure never fails a request but is always visible (VI);
- domain and application import no library;
- the database and tracing are optional at run time (dev without Docker keeps working).

**Scale/Scope**:
- 5 backlog tasks;
- about 4 domain modules, 3 ports, 6 adapters and 3 admin routes;
- new contracts for the audit entry, the query, the cost report, provider health and API
  keys;
- 15 FRs, 5 stories, 24 scenarios.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| # | Principle | How this plan complies | Status |
|---|---|---|---|
| I | Strict Clean Architecture | **Domain** gains `audit-entry.ts` (pure builder from decision and outcome) and `baseline.ts`. **Application** gains `ports/{audit-log,api-key-repository,tracer}.port.ts` and `use-cases/{query-audit-log,cost-report,provider-health}.ts`. **Infrastructure** gains `persistence/*` (Drizzle), `cache/in-memory-audit-log.ts` and `telemetry/otel-*`. `pnpm arch` stays green, and only `main.ts` wires adapters. | PASS |
| II | Contract-first | `AuditEntrySchema`, `AuditQuerySchema`, `AuditPageSchema`, `CostReportSchema` and `ProviderHealthSchema` are Zod in `packages/contracts`. The admin routes use them and they appear in `/openapi.json`. | PASS |
| III | Spec before code | The 24 scenarios map to tests (coverage table in `tasks.md`). | PASS |
| IV | Evals are executable spec | No new AI behaviour. The routing dataset must stay at 44/44, and feature 007 reads the audit log for cost reporting. | PASS |
| V | Privacy by default | There is no content field in `AuditEntry`; the hash is keyed (HMAC); spans never set GenAI content attributes; a capture test greps logs, events, entries, rows and spans. | PASS |
| VI | Fail fast, never silently | Audit drops are events plus log lines; misconfiguration (a database without a hash key, an invalid OTLP URL) stops boot; migrations run at start and fail loudly. | PASS |
| VII | Strict TypeScript | `AuditOutcome` is a discriminated union; closed lists for the filters; branded ids; no `any` (Drizzle row types are mapped at the edge). | PASS |
| VIII | Testability | The audit, API-key and tracer ports have in-memory fakes; time comes from `ClockPort`; there is no database in application tests. | PASS |
| IX | Composition over inheritance | The audit and tracing steps wrap the use cases (`withAudit(routeInference)`, `withTracing(...)`); the event sinks compose (`fanOut(logSink, otelSink)`). | PASS |
| X | Simplicity | Each port has two real adapters or is needed for tests. There is no message broker, and asynchronous writes are an in-process queue. Retention is documented, not built. | PASS |
| — | English-only (ADR-0002) | Yes. | PASS |
| — | Task protocol | One PR per backlog task `T-006-02` … `T-006-06`. | PASS |

## Project Structure

### Documentation (this feature)

```text
specs/006-audit-and-telemetry/
├── spec.md              # Specification (T-006-01), draft awaiting review
├── plan.md              # This file
├── research.md          # Phase 0: decisions R-01 … R-12
├── data-model.md        # Phase 1: entry, tables, contracts, ports, spans
├── quickstart.md        # Phase 1: how to verify end to end
├── contracts/
│   ├── README.md
│   ├── http.md                  # /v1/admin/audit, /cost, /providers; roles; errors
│   ├── audit-entry.example.json
│   └── cost-report.example.json
├── checklists/requirements.md
└── tasks.md
```

### Source Code (repository root; new or changed files only)

```text
packages/contracts/src/{audit,admin}.ts            # entry, query, page, cost, providers, api-key role
apps/gateway/
├── drizzle.config.ts, drizzle/                    # migrations (generated, committed)
├── src/
│   ├── domain/model/{audit-entry,baseline}.ts
│   ├── application/
│   │   ├── ports/{audit-log,api-key-repository,tracer}.port.ts
│   │   ├── audit/with-audit.ts                    # wraps route/stream inference
│   │   └── use-cases/{query-audit-log,cost-report,provider-health}.ts
│   ├── infrastructure/
│   │   ├── cache/in-memory-audit-log.ts
│   │   ├── persistence/{db,schema,audit-log-repository,api-key-repository,async-writer,migrate}.ts
│   │   ├── telemetry/{otel-setup,otel-tracer,otel-routing-events,fan-out}.ts
│   │   ├── auth/api-keys.ts                       # + roles, + DB lookup
│   │   └── config/env.ts                          # + DATABASE_URL, TAMIZ_AUDIT_HASH_KEY, TAMIZ_ADMIN_API_KEYS, OTEL_*
│   ├── presentation/
│   │   ├── middlewares/admin-only.ts
│   │   └── routes/admin/{audit,cost,providers}.ts
│   └── main.ts
└── test/{audit,persistence,telemetry,admin}/…
docker-compose.yml                                  # + postgres, + jaeger
.env.example                                        # new variables
```

## Requirement → task mapping

| Backlog task | Requirements | Stories |
|---|---|---|
| `T-006-02` Audit entry, port, in-memory log, wiring (`withAudit`), keyed hash, drop events | FR-001 … FR-004 | US1 |
| `T-006-03` Drizzle schema and migrations, Postgres audit repository, async writer, API keys table and roles, compose `postgres` | FR-005, FR-006 | US2 (1, 6), US1-6 |
| `T-006-04` `QueryAuditLog`, `GET /v1/admin/audit`, admin-only middleware | FR-007, FR-008, FR-014 | US2 (2–5) |
| `T-006-05` OTel tracer, attempt spans, GenAI attributes, span-event sink, OTLP env, compose `jaeger` | FR-009 … FR-011, FR-015 | US5 |
| `T-006-06` `GET /v1/admin/cost` and `GET /v1/admin/providers` | FR-012, FR-013 | US3, US4 |

Order:
- `T-006-02` → `T-006-03` → `T-006-04` → `T-006-06`;
- `T-006-05` needs only `T-006-02`, so it can run in parallel with `T-006-03`/`T-006-04`.

## Complexity Tracking

No violations. For review:
- **R-02:** asynchronous audit writes with visible drops, rather than synchronous
  "no answer without audit".
- **R-06:** API keys move to the database, but environment keys remain, so the
  change is backward compatible.
- **R-09:** spans are created in the application through a `TracerPort`, not by
  auto-instrumentation, so that attempt spans line up with `executeChain` and no content
  is captured by default.
