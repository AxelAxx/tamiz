# T-006-04 — Audit query API: `GET /v1/admin/audit`

| Field | Value |
|---|---|
| Task | `T-006-04` (see `docs/tasks/BACKLOG.md`) |
| Feature | `006-audit-and-telemetry` |
| Spec | `specs/006-audit-and-telemetry/spec.md` (FR-007, FR-008, FR-014; US2-2 … US2-5; SC-004); `tasks.md` Phase 3 (T019–T023); `research.md` R-05, R-07 |
| Branch / PR | `T-006-04-audit-query-api` / PR opened after this commit |
| Date | 2026-10-30 |
| Session | Claude Code (Claude Opus 5.5), side session (merge authority delegated by Alex) |
| Status | done |

## What was done

Admins can now search the audit log.

**The endpoint.** `GET /v1/admin/audit` returns entries newest first, with filters (date
range, route, rule, sensitivity, privacy action, detected entity kind, outcome), a page
size (default 50, max 200) and an opaque keyset cursor that repeats and skips nothing
while new entries arrive.

**Access.** It sits behind the new `adminOnly` middleware on `/v1/admin/*`: client keys
get `403 forbidden`, missing or invalid keys `401`.

**Reading.**
- `QueryAuditLog` reads one extra entry to know whether there is a next page.
- A malformed cursor is a `400`, never a silent first page.
- The reader port has two adapters: the in-memory log (shared filter and ordering
  helpers) and PostgreSQL. The SQL adapter uses a keyset condition on
  `(created_at, id)`, and jsonb key existence (`?`, GIN-indexed) for the entity filter.

**Contract.** `AuditQuerySchema` and `AuditPageSchema` are in `@tamiz/contracts`, and
`AuditPage` and `AuditEntry` appear in `/openapi.json`.

## Files touched

- `packages/contracts/src/admin.ts` (new), `index.ts`.
- `apps/gateway/src/application/ports/audit-reader.port.ts` (new: port, `compareNewestFirst`, `matchesFilters`); `application/use-cases/query-audit-log.ts` (new: use case, cursor codec).
- `apps/gateway/src/infrastructure/cache/in-memory-audit-log.ts` (`page`); `infrastructure/persistence/audit-log-repository.ts` (`createPostgresAuditReader`).
- `apps/gateway/src/presentation/middlewares/admin-only.ts`, `routes/admin/audit.ts` (new); `presentation/openapi-schemas.ts`, `presentation/app.ts` (`queryAuditLog` dependency, admin middleware); `main.ts`.
- Tests:
  - `test/admin/audit-route.test.ts`: the use case, the cursor, the route, 400 cases, 403/401, OpenAPI (T020, T021);
  - `test/persistence/audit-query.test.ts`: Testcontainers, the SQL equal to memory for each filter, cursor stability under inserts, 100 000 rows p95 (T019);
  - `test/support/audit-entries.ts`;
  - test app deps.
- `apps/gateway/README.md`, `specs/006-audit-and-telemetry/tasks.md` (T019–T023 ticked), `docs/tasks/BACKLOG.md`.

## Decisions

- **A separate `AuditReaderPort`** rather than adding `query` to `AuditLogPort`. The
  writer side (the async writer) and the read side (the repository) are different
  objects with Postgres. The in-memory log implements both.
- **The cursor is base64url JSON `{t, id}`**, using `btoa`/`atob`, so `application`
  imports nothing from Node. Its contents are a timestamp and a UUID, both ASCII.
- **The route parses entries with `AuditEntrySchema` before answering.** That checks the
  no-content contract at the edge, and it turns the domain's readonly arrays into the
  response type.
- **A bug caught by the cursor test:** the first version of the "older than the cursor"
  comparison was inverted. The insert-while-paging test found it before merge.

## How it was verified

```bash
pnpm lint        # clean
pnpm typecheck   # 0 errors
pnpm arch        # ✔ no dependency violations found (108 modules, 382 dependencies cruised)
pnpm test        # Test Files 87 passed (87); Tests 897 passed | 23 skipped (920)
#  the PostgreSQL query suite is skipped locally (no Docker) and runs in CI
pnpm build       # pass
```

## Pending / follow-ups

- `T-006-06`: cost and provider aggregates, on the same reader (add `costReport` and
  `window`).
- `T-006-05`: OpenTelemetry.
- No new backlog rows.

## Pitfalls for the next session

- **Query parameters reach the use case through a filter that drops `undefined`**
  (`exactOptionalPropertyTypes`). Keep that when adding parameters.
- **The 100 000-row Testcontainers suite takes about a minute in CI** (bulk insert). Keep
  other database tests in separate files, so their containers start in parallel.

## Links

- Spec / plan / tasks: `specs/006-audit-and-telemetry/`
- ADRs: none added
- Related task records: `docs/tasks/done/T-006-03-postgres-persistence.md`
