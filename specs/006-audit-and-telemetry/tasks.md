---

description: "Task list for feature 006-audit-and-telemetry"
---

# Tasks: Audit and Telemetry

**Input**: `specs/006-audit-and-telemetry/` (`plan.md`, `spec.md`, `research.md` R-01 …
R-12, `data-model.md`, `contracts/`, `quickstart.md`); features 002–005 merged; this spec
approved by Alex (`T-006-01`).

**Tests**: Mandatory. They are written before the code, and every scenario maps to a test
(table below).

**Organization**: Phases are the backlog tasks `T-006-02` … `T-006-06`, one PR each.
`gateway/` abbreviates `apps/gateway/`, and `contracts/` abbreviates `packages/contracts/`.

## Scenario coverage

| Scenario | Task | Scenario | Task |
|---|---|---|---|
| US1-1 answered → one full entry | T003, T004 | US2-6 no DB → in-memory, announced | T005, T014 |
| US1-2 stream → one entry at the end | T004 | US3-1 cost by day + totals | T029, T030 |
| US1-3 blocked → entry, reason, no target | T004 | US3-2 local zero cost, baseline priced | T029 |
| US1-4 failed → entry, error, abandoned | T004 | US3-3 by route/model, not-served line | T029, T030 |
| US1-5 no content, keyed hash | T003, T006 | US3-4 baseline named | T030 |
| US1-6 store down → served, drops visible | T013 | US4-1 open circuit shown | T031 |
| US2-1 migrations from empty, idempotent | T012 | US4-2 window counts and percentiles | T031 |
| US2-2 filters, newest first, page size | T019, T020 | US4-3 idle target listed | T031 |
| US2-3 cursor stable under inserts | T019 | US5-1 request + attempt spans, fallback event | T024 |
| US2-4 entity filter | T019, T020 | US5-2 `gen_ai.*` on attempts | T024 |
| US2-5 client key → 403 | T021 | US5-3 `tamiz.*` + decision event | T024 |
| | | US5-4 no content in spans | T025 |
| | | US5-5 no endpoint → no-op | T026 |

---

## Phase 1: `T-006-02` — Audit entry, port, in-memory log, wiring (US1)

### Tests first

- [x] T001 [P] `contracts/test/audit.test.ts`:
  - `contracts/audit-entry.example.json` parses;
  - no unknown field is accepted;
  - the hash is 64 hexadecimal characters.
- [x] T002 [P] `gateway/test/domain/baseline.test.ts`:
  - the most expensive target, with ties broken by order;
  - `undefined` when the policy has no prices;
  - the cost arithmetic.
- [x] T003 [P] [US1] `gateway/test/domain/audit-entry.test.ts`: `auditEntry` covers every
  outcome, with counts but never offsets, a baseline per entry, and latency from the clock
  (US1-1, US1-5).
- [x] T004 [P] [US1] `gateway/test/audit/with-audit.test.ts`, run through `createTestApp`
  with the in-memory log. Exactly one entry for each of:
  - answered (US1-1);
  - a streamed finish, mid-stream error or client cancel (US1-2);
  - a privacy block, a residency block or a detector `block` (US1-3);
  - an exhausted chain (US1-4);
  - nothing for 400/401 or `/v1/simulate`.
- [x] T005 [P] [US2] `gateway/test/cache/in-memory-audit-log.test.ts`:
  - ring-buffer bound;
  - query ordering and cursor;
  - filters, cost and window in process.
- [x] T006 [P] [US1] `gateway/test/privacy/no-leak.test.ts` (extended):
  - the serialized audit entries contain no test value;
  - `requestHash` equals the HMAC with the configured key.

### Implementation

- [x] T007 `contracts/src/audit.ts` (data-model §1.1), plus `forbidden` in `error.ts`.
- [x] T008 `gateway/src/domain/model/{audit-entry,baseline}.ts`.
- [x] T009 `gateway/src/application/ports/audit-log.port.ts`;
  `application/audit/with-audit.ts` (research R-01); the `audit.dropped` event;
  use-case results expose what the entry needs.
- [x] T010 `gateway/src/infrastructure/cache/in-memory-audit-log.ts`; `main.ts` wiring, with
  the HMAC key (ephemeral, logged, in memory-only mode).
- [x] T011 Gates; record `docs/tasks/done/T-006-02-audit-entry.md`; backlog row.

## Phase 2: `T-006-03` — PostgreSQL, migrations, async writer, API keys (US2, US1-6)

### Tests first

- [x] T012 [P] [US2] `gateway/test/persistence/migrations.test.ts` (Testcontainers
  `postgres:17`, skipped with a reason without Docker): a migration from empty creates the
  tables and indexes, and a second run is a no-op (US2-1).
- [x] T013 [P] [US1] `gateway/test/persistence/async-writer.test.ts` (fake clock, fake
  store):
  - batching;
  - one retry and then a drop;
  - overflow drops the oldest;
  - every drop emits `audit.dropped`;
  - flush on shutdown;
  - a request is never delayed (US1-6).
- [x] T014 [P] `gateway/test/persistence/api-key-repository.test.ts` (Testcontainers) and
  `test/config/env-006.test.ts`:
  - lookup by hash;
  - a revoked key is refused;
  - environment keys still work;
  - `DATABASE_URL` without `TAMIZ_AUDIT_HASH_KEY` stops boot;
  - with no database, the log says so (US2-6).

### Implementation

- [x] T015 Install Drizzle and postgres.js; add `gateway/drizzle.config.ts`,
  `infrastructure/persistence/{db,schema,migrate}.ts`, the generated migration, and the
  scripts `db:generate`, `db:migrate` and `api-key:add`.
- [x] T016 `persistence/{audit-log-repository,async-writer,api-key-repository}.ts`; roles in
  `auth/api-keys.ts`; `main.ts` chooses Postgres or in-memory.
- [x] T017 `docker-compose.yml` gains `postgres:17` (volume, healthcheck); document
  `.env.example`.
- [x] T018 Gates (CI runs Testcontainers); record; backlog row.

## Phase 3: `T-006-04` — Audit query API (US2)

### Tests first

- [ ] T019 [P] [US2] `gateway/test/persistence/audit-query.test.ts` (Testcontainers):
  - every filter;
  - the entity filter on `jsonb` (US2-4);
  - keyset pages with no repeats or skips while rows are being inserted (US2-3);
  - 100 000 rows, page p95 < 200 ms (SC-004).
- [ ] T020 [P] [US2] `gateway/test/admin/audit-route.test.ts` (in-memory log):
  - query validation errors;
  - default and maximum `limit`;
  - newest first (US2-2);
  - OpenAPI component.
- [ ] T021 [P] [US2] `gateway/test/admin/admin-only.test.ts`: a client key → 403, none → 401,
  admin → 200 on every `/v1/admin/*` (US2-5).

### Implementation

- [ ] T022 `contracts/src/admin.ts` (audit query and page);
  `application/use-cases/query-audit-log.ts`; `presentation/middlewares/admin-only.ts`;
  `routes/admin/audit.ts`.
- [ ] T023 Gates; record; backlog row.

## Phase 4: `T-006-05` — OpenTelemetry and Jaeger (US5)

### Tests first

- [ ] T024 [P] [US5] `gateway/test/telemetry/spans.test.ts` (in-memory span exporter), for a
  request with one fallback:
  - one `tamiz.request` span with two `chat …` children, the first with an error status;
  - the `gen_ai.*` and `tamiz.*` attributes;
  - the `routing.decision`, `routing.fallback` and `privacy.*` events
  - (US5-1 … US5-3).
- [ ] T025 [P] [US5] `gateway/test/privacy/no-leak.test.ts` (extended): span names,
  attributes and events contain no test value, and no `gen_ai.*message*`, `gen_ai.prompt`
  or `gen_ai.completion` attribute exists (US5-4, FR-010).
- [ ] T026 [P] [US5] `gateway/test/telemetry/otel-setup.test.ts`: without an endpoint the
  tracer is a no-op; with one, the exporter is configured from the OTel variables (US5-5).

### Implementation

- [ ] T027 Install the OpenTelemetry packages (versions and GenAI names checked with
  Context7). Add:
  - `application/ports/tracer.port.ts`;
  - `withTracing`, and `tracer.attempt` around attempts in `executeChain`;
  - `infrastructure/telemetry/{otel-setup,otel-tracer,otel-routing-events,fan-out}.ts`.

  In `main.ts`, set up the provider and shut it down on exit.
- [ ] T028 `docker-compose.yml` gains `jaeger`; document the variables; gates; record (with
  a manual Jaeger check, or why it is not possible); backlog row.

## Phase 5: `T-006-06` — Cost and provider health (US3, US4)

### Tests first

- [ ] T029 [P] [US3] `gateway/test/persistence/cost-report.test.ts` (Testcontainers) and the
  in-memory equivalent:
  - by day, route and model;
  - local zero cost;
  - the baseline sums;
  - the not-served line;
  - totals to the cent (US3-1 … US3-3, SC-005).
- [ ] T030 [P] [US3] `gateway/test/admin/cost-route.test.ts`:
  - `from` and `to` are required;
  - the baseline is named (US3-4);
  - `contracts/cost-report.example.json` parses.
- [ ] T031 [P] [US4] `gateway/test/admin/providers-route.test.ts`:
  - an open circuit with its cool-down (US4-1);
  - window counts, error rate and percentiles (US4-2);
  - an idle target listed with zeros and nulls (US4-3).

### Implementation

- [ ] T032 `contracts/src/admin.ts` (cost, providers);
  `application/use-cases/{cost-report,provider-health}.ts`;
  `routes/admin/{cost,providers}.ts`; the SQL aggregates (`date_trunc`, `percentile_cont`).
- [ ] T033 Gates; record; backlog row.

## Phase 6: Polish

- [ ] T034 [P] README status (006), the admin API section and the Jaeger screenshot
  placeholder.
- [ ] T035 [P] `docs/architecture.md` (audit and tracing in the request flow, tables);
  `CLAUDE.md` section 12 (`db:*`, `api-key:add`, `docker compose up postgres jaeger`).
- [ ] T036 Run the quickstart and record it in the last task record of the feature.

## Dependencies

```text
T-006-02 ─┬─▶ T-006-03 ─▶ T-006-04 ─▶ T-006-06 ─┐
          └─▶ T-006-05 ─────────────────────────┴─▶ polish
```

## Totals

| Phase | Backlog | Tasks |
|---|---|---|
| 1 | `T-006-02` | T001–T011 (11) |
| 2 | `T-006-03` | T012–T018 (7) |
| 3 | `T-006-04` | T019–T023 (5) |
| 4 | `T-006-05` | T024–T028 (5) |
| 5 | `T-006-06` | T029–T033 (5) |
| 6 | polish | T034–T036 (3) |
| **Total** | | **36** |
