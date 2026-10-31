# T-008-01 — Spec, plan and tasks for `008-dashboard`

| Field | Value |
|---|---|
| Task | `T-008-01` (see `docs/tasks/BACKLOG.md`) |
| Feature | `008-dashboard` |
| Spec | `specs/008-dashboard/spec.md` |
| Branch / PR | `008-dashboard` (Spec Kit naming), cut from `main` at dc07462 / draft PR opened after this commit |
| Date | 2026-10-31 |
| Session | Claude Code (Claude Opus 5.5), side session |
| Status | done; spec reviewed and approved by Alex on 2026-10-31 without changes (`spec.md` flipped to `Approved` in the same PR) |

## What was done

The Spec Kit set for feature 008, plus the Claude Design hand-off:

- **`spec.md`**: 9 stories and 56 scenarios (sign-in and the key boundary, live traffic,
  simulator, audit log, policy editor, evals, cost, provider health, accessibility),
  FR-001 … FR-024, SC-001 … SC-007, edge cases and assumptions.
- **`checklists/requirements.md`**: all items pass.
- **`plan.md`**: no constitution violations; the requirement → backlog mapping.
- **`research.md`**: R-01 … R-16.
- **`data-model.md`**: contracts read and added, the gateway policy store and table,
  dashboard sessions and configuration, browser state, state transitions.
- **`contracts/`**:
  - `gateway-policy.md`: `GET`/`PUT /v1/admin/policy`, the order of checks, the errors;
  - `dashboard-bff.md`: the dashboard's allow-listed endpoints and their rules;
  - `replace-policy.example.json` (its `policy` parses with `RoutingPolicySchema`).
- **`quickstart.md`**.
- **`design-brief.md`**: the component inventory for Claude Design. It covers:
  - the product context and the stack;
  - the shell and the sign-in page;
  - 13 shared components;
  - 7 screens, each with the data per component, its loading, empty and error states, and
    its desktop, tablet and phone behaviour;
  - accessibility and content rules;
  - synthetic fixture data;
  - what to deliver back.
- **`tasks.md`**: 56 tasks in 10 phases, one per backlog task, plus gate **G1 (design
  received)** before any designed UI. It has a scenario coverage table, and all 56 scenario
  ids appear in it.

## Decisions (flagged for Alex's review)

- **Two new backlog rows.**
  - `T-008-10` is the design gate plus the design tokens and app shell.
  - `T-008-11` is the provider health screen, which was in the task brief but had no row.
  - `T-008-02` is narrowed to the non-visual skeleton (env, sign-in, BFF, `hc` client,
    E2E harness), so it can land while the design is being made.
  - The screen rows now depend on `T-008-10` instead of `T-008-02`.
- **Operator sign-in with one shared passphrase (R-03).**
  - The passphrase is stored as an scrypt hash in the env.
  - Sessions are server-side and in memory: 8 hours absolute, revoked on sign-out.
  - 5 failed attempts per minute per address.
  - Everyone signed in is an admin; there is no read-only role.
  - Auth.js or SSO is possible later, behind the same session check.
- **BFF allow-list (R-01).** The browser calls 11 fixed dashboard endpoints, never a
  generic proxy. The key lives in `server-only` modules, and an E2E test searches
  everything the browser received for it.
- **`hc` needs a gateway refactor (R-02).** `GatewayApp` is `OpenAPIHono<AppEnv>`, and the
  routes are registered by `void` functions, so `hc<GatewayApp>` knows no routes today.
  - `T-008-02` chains the registrations and exports a type-only `GatewayRoutes`.
  - Responses are still parsed with the contracts at run time.
- **Route badges show residency** (`local`/`eu`/`us`/`global`), not `local`/`eu`/`frontier`.
  "Frontier" is a model tier, and the target id next to the badge names the model.
- **Live traffic polls** `GET /v1/admin/audit` every 2 s with a 5-minute overlap and
  de-duplication by id (R-05).
  - Entries are written when a request ends but ordered by `startedAt`, so without the
    overlap, late finishers would be missed.
  - No SSE endpoint is added to the gateway.
- **Policy persistence (R-10).**
  - With `DATABASE_URL`, there is an append-only `policy_versions` table in PostgreSQL, and
    the gateway boots from the newest stored version unless the file's version is higher.
  - Without a database, the policy is held in memory, and the editor warns that saves are
    lost on restart.
  - Saves send `baseVersion`; the gateway sets `version = baseVersion + 1` and answers
    `409 conflict` when the base is stale.
  - A different policy `id` is refused.
- **Shared contract changes (R-11).** `ErrorEnvelopeSchema` gains an optional
  `issues: [{ path, message }]`, and `ErrorTypeSchema` gains `conflict` (409).
- **Eval reports come from a folder of files** (`TAMIZ_DASHBOARD_EVALS_DIR`, filled with
  `gh run download … -n evals-report`), plus a committed demo snapshot. The gateway serves no
  eval data (R-09).
- **Two stack additions not in `CLAUDE.md` §4: CodeMirror 6 and `yaml`** for the policy
  editor, which needs a YAML parser with line mapping for issue paths (R-12).
- **Browser flows run against the real gateway app with in-memory fakes (R-13).** They use
  `apps/gateway/scripts/e2e-gateway.ts` with a control port to seed entries, open circuits
  and toggle a detector outage. MSW cannot reach the Next.js server process.
- **Scenario tests.** The spec asks for one named test per scenario. Policy scenarios that
  span both sides have one gateway test and one browser test.
- **Dashboard port 3100**; container non-root, standalone output.

## How it was verified

- Documentation only; no code changed.
- `replace-policy.example.json`: `policy` parsed with `RoutingPolicySchema` → `ok`.
- The DNI in the brief's fixture (`12345678Z`) has the right control letter, and its offsets
  (24–33) were counted.
- Scenario coverage: an `awk` over `spec.md` lists 56 scenario ids, and `comm` against the
  ids in `tasks.md` finds no difference.
- `pnpm lint` green (see the PR).

## Pending / follow-ups

- **Alex:**
  - review and approve the spec PR (flip `spec.md` to `Approved`);
  - take `design-brief.md` to Claude Design;
  - put the result in `specs/008-dashboard/design/` and tick G1.
- **New backlog rows:** `T-008-10`, `T-008-11`.
- **Not in scope, no row yet:** simulating against an unsaved draft policy (`/v1/simulate`
  only uses the active policy), and live policy reload across several gateway instances.

## Pitfalls for the next session

- **Next.js 16 renamed `middleware.ts` to `proxy.ts`.** The proxy cannot see the in-memory
  session map, so it only checks the cookie signature. Every route handler must check the
  session store itself.
- **`/v1/simulate` sits under the `/v1/*` key middleware, not `/v1/admin/*`.** The
  dashboard's admin key works there too, since admin keys authenticate on `/v1/*`.
- **Simulations are not audited**, so the simulator adds no rows to live traffic. Do not
  write a test that expects them.
- **`createApp` registration order matters** for the middlewares (`/v1/*` auth before
  `/v1/admin/*`). Keep it when chaining the routes in `T-008-02`.
- **The spec 009 session works in parallel** (`specs/009-*`). The policy contract added
  here (`policy-admin.ts`) may be useful to its MCP tools; coordinate rather than duplicate.

## Links

- Spec / plan / tasks / brief: `specs/008-dashboard/`
- ADRs: none added
- Related task records: `docs/tasks/done/T-005-06-simulate-endpoint.md`, `docs/tasks/done/T-006-04-audit-query-api.md`, `docs/tasks/done/T-006-06-cost-and-providers.md`, `docs/tasks/done/T-007-06-evals-ci-job.md`
