# T-006-01 — Spec, plan and tasks for `006-audit-and-telemetry`

| Field | Value |
|---|---|
| Task | `T-006-01` (see `docs/tasks/BACKLOG.md`) |
| Feature | `006-audit-and-telemetry` |
| Spec | `specs/006-audit-and-telemetry/spec.md` |
| Branch / PR | `006-audit-and-telemetry` (Spec Kit naming), cut from `main` at f62b110 / PR #34 |
| Date | 2026-10-30 |
| Session | Claude Code (Claude Opus 5.5), side session |
| Status | done; spec reviewed and approved by Alex on 2026-10-30 without changes (`spec.md` flipped to `Approved` in the same PR) |

## What was done

The Spec Kit set for feature 006:

- **`spec.md`**: 5 stories and 24 scenarios, FR-001 … FR-015, SC-001 … SC-006, edge
  cases and assumptions.
- **`checklists/requirements.md`**.
- **`plan.md`**: no constitution violations; the requirement → backlog mapping.
- **`research.md`**: R-01 … R-12.
- **`data-model.md`**: contracts, domain, ports, adapters, routes and SQL tables.
- **`contracts/`**: `http.md` (admin API, roles, environment), an audit entry example and
  a cost report example whose arithmetic was checked.
- **`quickstart.md`**.
- **`tasks.md`**: 36 tasks in 6 phases, with the scenario coverage table.

## Decisions (flagged for Alex's review)

- **Asynchronous audit writes (R-02).** A request is never delayed or failed by the audit
  store. Losses are counted, logged and emitted as `audit.dropped`. A "no answer without
  audit" mode is left as a later option.
- **The messages' hash is HMAC-SHA-256 with `TAMIZ_AUDIT_HASH_KEY` (R-03).** A plain hash
  of short prompts could be recovered by guessing.
- **Without a database, the audit log is in memory** (bounded, announced at boot), so dev
  and CI keep working without Docker.
- **Admin access is a role on API keys (`TAMIZ_ADMIN_API_KEYS` + `api_keys.role`).** Client
  keys get `403 forbidden` (a new error type). There is no user login.
- **API keys move to an `api_keys` table** with revocation; environment keys still work
  (R-06).
- **Baseline = the policy's most expensive target**, stored per entry so price changes do
  not rewrite history (R-08).
- **Spans are created explicitly through a `TracerPort`**, not by auto-instrumentation or
  AI SDK telemetry, so no content can be captured by default (R-09). The GenAI convention
  is still "development" status (`gen_ai.provider.name` replaced `gen_ai.system`), so
  names are pinned at implementation.
- **Provider health = circuit state + a recent window of the audit log** (R-12). There is
  no separate metrics store.
- **Simulations are not audited.**

## How it was verified

- Documentation only.
- The example's hash was computed with HMAC and an example key.
- The cost example's numbers were recomputed from the prices
  (tokens × 0.1/0.3 and 3/15 USD per million tokens).
- `pnpm lint` green.

## Pending / follow-ups

- No new backlog rows. The backlog's `T-006-03` "api keys" is covered by FR-006.

## Pitfalls for the next session

- **Docker is not running on this machine.** The Testcontainers suites (PostgreSQL) only
  run in CI, as with Valkey in feature 003.
- **Check the current OTel GenAI attribute names with Context7** before `T-006-05`.

## Links

- Spec / plan / tasks: `specs/006-audit-and-telemetry/`
- Related task records: `docs/tasks/done/T-005-01-spec-plan-tasks-005.md`, `docs/tasks/done/T-005-06-simulate-endpoint.md`
