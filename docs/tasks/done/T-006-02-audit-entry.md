# T-006-02 — Audit entry, port, in-memory log and wiring

| Field | Value |
|---|---|
| Task | `T-006-02` (see `docs/tasks/BACKLOG.md`) |
| Feature | `006-audit-and-telemetry` |
| Spec | `specs/006-audit-and-telemetry/spec.md` (FR-001 … FR-004; US1-1 … US1-5; SC-001, SC-002); `tasks.md` Phase 1 (T001–T011); `research.md` R-01, R-03, R-08 |
| Branch / PR | `T-006-02-audit-entry` / PR opened after this commit |
| Date | 2026-10-30 |
| Session | Claude Code (Claude Opus 5.5), side session (merge authority delegated by Alex) |
| Status | done |

## What was done

Every request that reaches the routing decision now leaves exactly one audit entry when
it ends, whatever the outcome:
- `answered`;
- `failed` (exhausted chain, all circuits open, deadline);
- `blocked` (privacy action, no target, detector failure with `block`, residency guard);
- `cancelled` (a stream the client stopped reading, or an aborted stream).

**The wrappers.** `withAudit` and `withAuditStream` wrap the use cases. A stream's entry
is written when its parts iterator ends, by finish, error or `return()`.

**The entry.** It is built by the pure domain function `auditEntry` and contains:
- policy and rule;
- sensitivity, the entity kinds and counts (now carried by the decision), and the
  privacy action;
- the target and the abandoned targets with their reasons;
- usage, cost and the baseline cost against the policy's most expensive target;
- latency;
- an HMAC of the messages, keyed with `TAMIZ_AUDIT_HASH_KEY`, or with an ephemeral key
  plus a warning.

It never contains text, values or positions.

**Where entries go.** The port is fire-and-forget; the adapter is a bounded in-memory log
(`TAMIZ_AUDIT_MEMORY_ENTRIES`, default 10 000). The contract `AuditEntrySchema` is in
`@tamiz/contracts`; the error type `forbidden` (403) was added for `T-006-04`.

## Files touched

- `packages/contracts/src/audit.ts` (new), `index.ts`; `error.ts` + `forbidden` (T007).
- `apps/gateway/src/domain/model/{audit-entry,baseline}.ts` (new) (T008).
- `apps/gateway/src/domain/model/sensitivity.ts` (`entityCounts`), `routing-decision.ts` (`entityCounts` on both decision kinds).
- `apps/gateway/src/application/ports/audit-log.port.ts`, `application/audit/with-audit.ts` (new) (T009).
- `apps/gateway/src/infrastructure/cache/in-memory-audit-log.ts` (new); `infrastructure/config/env.ts` (`TAMIZ_AUDIT_HASH_KEY`, `TAMIZ_AUDIT_MEMORY_ENTRIES`); `main.ts` (wrappers, HMAC, `randomUUID`) (T010).
- Tests:
  - `packages/contracts/test/audit.test.ts` (T001);
  - `apps/gateway/test/domain/audit-entry.test.ts` (baseline + entry, T002, T003);
  - `test/audit/with-audit.test.ts` (one entry per outcome, cancel, no entry for 400/401/simulate, HMAC, the ring-buffer bound; T004, T005);
  - `test/privacy/no-leak.test.ts` extended to the entries (T006);
  - `test/helpers/app.ts` (audit wrappers, `TEST_AUDIT_KEY`, `audit` returned);
  - updated decision fixtures (`entityCounts`).
- `.env.example`, `apps/gateway/README.md`, `specs/006-audit-and-telemetry/tasks.md` (T001–T011 ticked), `docs/tasks/BACKLOG.md`.

## Decisions

- **The decision carries `entityCounts`** (counts per kind, computed in `decide`). The
  audit wrapper sees the decision but not the inspection, and counts are what the audit
  and later the telemetry need. Positions stay in the inspection.
- **`AuditLogPort` has only `append` for now.** Query, cost and window arrive with the
  tasks that use them (`T-006-04`, `T-006-06`), so the port grows with real consumers
  (constitution X).
- **A residency-guard refusal is audited as `blocked` with `blockReason: "residency"`.**
  The privacy action stays what the decision chose. The action and the reason are
  separate facts.
- **The baseline is looked up from the active policy at write time**, and the baseline
  cost is stored per entry (R-08). Free targets never count as the baseline: a policy with
  only local targets has none.
- **The cancel scenario is tested at the use-case level** by calling `return()` on the
  parts iterator. Hono's `app.request` does not propagate a client disconnect. A first
  attempt with an endless synchronous generator hung the test process; the test now
  uses `return()` and a generator that yields.
- **An ephemeral hash key when `TAMIZ_AUDIT_HASH_KEY` is unset**, with a warning. Spec 006
  makes the key required only once a database exists (`T-006-03`).

## How it was verified

```bash
pnpm lint        # clean
pnpm typecheck   # 0 errors
pnpm arch        # ✔ no dependency violations found
pnpm test        # Test Files 82 passed (82); Tests 867 passed | 12 skipped (879)
pnpm build       # pass
```

## Pending / follow-ups

- `T-006-03`: PostgreSQL (Drizzle, migrations), the async writer with `audit.dropped`
  events, and API keys in the database with roles. `TAMIZ_AUDIT_HASH_KEY` becomes
  required with `DATABASE_URL`.
- `T-006-05` (OpenTelemetry) can start in parallel: it needs only this task.
- No new backlog rows.

## Pitfalls for the next session

- **The audit write is fire-and-forget and awaits the policy first.** Tests must let it
  settle with one `setTimeout(0)` before reading `audit.entries()`.
- **Never use a synchronous infinite generator in a stream test.** It starves the event
  loop and the Vitest process hangs without timing out.
- **Every hand-built `RoutingDecision` now needs `entityCounts: {}`.**

## Links

- Spec / plan / tasks: `specs/006-audit-and-telemetry/`
- ADRs: none added
- Related task records: `docs/tasks/done/T-006-01-spec-plan-tasks-006.md`, `docs/tasks/done/T-005-04-privacy-in-route-inference.md`
