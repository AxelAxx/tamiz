# T-006-06 — Admin aggregates: `GET /v1/admin/cost` and `GET /v1/admin/providers`

| Field | Value |
|---|---|
| Task | `T-006-06` (see `docs/tasks/BACKLOG.md`) |
| Feature | `006-audit-and-telemetry` |
| Spec | `specs/006-audit-and-telemetry/spec.md` (FR-012, FR-013; US3-1 … US3-4, US4-1 … US4-3; SC-005); `tasks.md` Phase 5 (T029–T033); `research.md` R-08, R-12 |
| Branch / PR | `T-006-06-cost-and-providers` / PR opened after this commit |
| Date | 2026-10-30 |
| Session | Claude Code (Claude Opus 5.5), side session (merge authority delegated by Alex) |
| Status | done |

## What was done

Two admin endpoints that the dashboard (008) and the MCP tools (009) build on.

**Cost.** `GET /v1/admin/cost?from&to&groupBy` reports the served requests in `[from, to)`:
- rows by UTC day, route or model, each with requests, input and output tokens, actual
  cost and baseline cost;
- `baseline` names the target and prices used (the policy's most expensive target, `null`
  when nothing is priced);
- `notServed` counts blocked and failed requests apart, with no cost;
- `totals` sums the rows.

Baseline costs come from each audit entry, so a later price change never rewrites history.

**Provider health.** `GET /v1/admin/providers?windowMinutes` lists every declared target,
idle ones included:
- the circuit state now, from the circuit store (shared via Redis when configured), with
  the remaining cool-down when open;
- over the window (default 15 minutes): attempts, errors, error rate and the p50/p95
  latency of answered requests.

An attempt is the answering or failing target of an entry, plus one failed attempt per
abandoned target.

**Reading.** `AuditReaderPort` gains `cost` and `window`:
- in memory, pure functions in `application/audit/aggregates.ts`;
- in PostgreSQL, `GROUP BY` with `to_char(... at time zone 'UTC')`, `count(*) filter`, and
  `percentile_cont` over a `union all` with `jsonb_array_elements(abandoned)`.

The pure functions are the reference the SQL is tested against.

## Files touched

- `packages/contracts/src/admin.ts`, `index.ts`: `CostQuerySchema`, `CostRowSchema`, `CostReportSchema`, `ProvidersQuerySchema`, `ProviderHealthSchema`, `ProvidersReportSchema`.
- `apps/gateway/src/application/audit/aggregates.ts` (new); `ports/audit-reader.port.ts`; `use-cases/{cost-report,provider-health}.ts` (new).
- `apps/gateway/src/infrastructure/cache/in-memory-audit-log.ts`, `infrastructure/persistence/audit-log-repository.ts`.
- `apps/gateway/src/presentation/routes/admin/{cost,providers}.ts` (new), `openapi-schemas.ts`, `app.ts`; `main.ts`.
- Tests: `test/admin/cost-route.test.ts`, `test/admin/providers-route.test.ts`, `test/persistence/cost-report.test.ts` (Testcontainers); test app deps.
- `apps/gateway/README.md`, `specs/006-audit-and-telemetry/tasks.md` (T029–T033 ticked), `docs/tasks/BACKLOG.md`.

## Decisions

- **Cancelled streams count as served.** They reached a target and may have used tokens,
  so they appear in the cost rows. Only blocked and failed requests go to `notServed`.
- **Percentiles are continuous** (linear interpolation, as `percentile_cont`) and rounded
  to the microsecond. Without rounding, JS gives `879.9999…` where SQL gives `880`.
- **Days are UTC**, both in memory (`startedAt.slice(0, 10)`) and in SQL.
- **`from >= to` is a 400** in the route. Zod checks each date, not the pair.

## How it was verified

```bash
pnpm lint        # clean (pre-existing infos only)
pnpm typecheck   # 0 errors
pnpm arch        # ✔ no dependency violations found (113 modules, 413 dependencies cruised)
pnpm test        # Test Files 90 passed (90); Tests 918 passed | 27 skipped (945)
#  the PostgreSQL aggregate suite is skipped locally (no Docker) and runs in CI
pnpm build       # pass
```

## Pending / follow-ups

- `T-006-05`: OpenTelemetry.
- 006 polish (T034–T036).
- No new backlog rows.

## Pitfalls for the next session

- **The SQL and in-memory aggregates must stay equal.** `test/persistence/cost-report.test.ts`
  compares them on mixed traffic. Change both together.
- **`window` counts abandoned targets as errors**, so a target that only ever times out
  shows requests with no latency.

## Links

- Spec / plan / tasks: `specs/006-audit-and-telemetry/`
- ADRs: none added
- Related task records: `docs/tasks/done/T-006-04-audit-query-api.md`, `docs/tasks/done/T-003-06-redis-circuit-state.md`
