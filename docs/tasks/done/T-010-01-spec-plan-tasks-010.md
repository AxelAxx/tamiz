# T-010-01 — Spec, plan and tasks for `010-citara-integration`

| Field | Value |
|---|---|
| Task | `T-010-01` (see `docs/tasks/BACKLOG.md`) |
| Feature | `010-citara-integration` (optional) |
| Spec | `specs/010-citara-integration/spec.md` |
| Branch / PR | `010-citara-integration` (Spec Kit naming), cut from `origin/main` at ae45d45 / draft PR opened after this commit |
| Date | 2026-10-31 |
| Session | Claude Code (Claude Opus 5.5), side session |
| Status | **draft, pending Alex's approval** of the spec and of decisions D1-D7; flip to done (and `spec.md` to `Approved`) when he approves |

## What was done

The Spec Kit set for feature 010, written with `/speckit-specify`, `/speckit-plan` and
`/speckit-tasks`:

- **`spec.md`**: 5 stories, 21 scenarios, FR-001 … FR-015, SC-001 … SC-006, edge cases,
  assumptions and the decisions flagged for Alex (D1-D7). Every scenario maps to one
  automated test except US5-1, the recorded full-stack run.
- **`checklists/requirements.md`**: all items pass.
- **`plan.md`**: no constitution violations; complexity tracking (one new example package,
  scripted providers in the E2E harness, a pinned `openai` dependency); requirement → task
  mapping; the backlog changes below.
- **`research.md`**: R-01 … R-12.
- **`data-model.md`**: example configuration, error classes, run report, exit codes, audit
  check, harness controls.
- **`contracts/integration-contract.md`**: the existing gateway surface a client relies on
  (endpoint, keys, headers, errors, aliases, what is stored, the admin audit lookup).
- **`quickstart.md`**: automated, by hand against the harness, and full stack.
- **`tasks.md`**: 21 tasks in 8 phases with the scenario coverage table.

## What the repository says about Citara

Only that it is an independent project of the same author and that, optionally, "Citara
sends its LLM calls through Tamiz" (`docs/tamiz-project.md` section 1, `CLAUDE.md` section 2,
the two backlog rows). There is no Citara checkout on the machine. The spec therefore
describes a generic OpenAI-compatible integration from Tamiz's side, with Citara as the named
first client, and invents no product details.

## Decisions (flagged for Alex's review)

- **D1 — What Citara is** (domain, users, personal data it sends): unknown; treated as a
  generic OpenAI-compatible client.
- **D2 — Example stack**: TypeScript with the official `openai` package `7.47.0` (checked in
  the published tarball: `.withResponse()` gives raw headers, also for streams; `request_id`
  is read from `x-request-id`; `APIError.type` is Tamiz's error type) plus a `curl` example.
  Switch to Python if Citara is Python.
- **D3 — Topology**: the guide covers same-network and remote over TLS (proxy); the example
  takes any base URL.
- **D4 — No Citara rule or alias**: `tamiz-auto` and `tamiz-local` from the default policy.
- **D5 — No new eval** (constitution IV): no AI behaviour is added; the existing gated evals
  cover the paths. A Citara-shaped slice of `pii-leak-es` and `routing` once D1 is known.
- **D6 — Audit lookup by request id without a gateway change**: the admin audit API has no
  `requestId` filter, so the example scans a 5 s-before window (≤ 5 pages of 200) and matches
  client-side. Alternative: an optional backlog row adding `requestId`/`clientId` filters to
  the admin audit API and the MCP tool; proposed, not added.
- **D7 — Backlog split**: `T-010-02` no longer depends on `T-OPS-01` (blocked behind the
  dashboard design gate G1); the recorded `docker compose` run becomes new row `T-010-03`.
- **SDK retries off** (R-03): the OpenAI SDK retries 408/409/429/5xx twice by default, which
  multiplies Tamiz's own retries and fallbacks and can never fix a 451. The example sets
  `maxRetries: 0`, retries once only on 503/429 after `retry-after` (≤ 30 s), and uses a 70 s
  client timeout (policy deadline 60 s).
- **Tests reuse the gateway's E2E harness** (`T-008-02`) with opt-in scripted providers that
  echo what they received, so one test sees both the placeholders the provider got and the
  restored answer. Default off, so the dashboard's Playwright suite is unchanged.
- **The concrete 451 under the default policy** is `tamiz-frontier` with a name: level `high`
  allows only local and EU, the pinned route is US-only, `applyPrivacy` returns `no_target`.

## How it was verified

- Documentation only; no code changed.
- Gateway facts read from the code: header names and descriptions
  (`presentation/routes/chat-completions.ts`), error types and statuses
  (`packages/contracts/src/error.ts`), the audit query fields (`admin.ts`, no request-id
  filter), the request-id pattern (`middlewares/request-id.ts`), the default policy's aliases
  and privacy levels, `applyPrivacy`, the E2E harness's markers, keys and controls.
- `npm view openai` (7.47.0, `latest`, Node ≥ 22) and the tarball's type declarations.
- Scenario coverage: every scenario maps to a task in the `tasks.md` table.
- `pnpm lint` green.

## Pending / follow-ups

- Alex's answers to D1-D7; then flip this record and `spec.md` to approved.
- New backlog row `T-010-03` (recorded compose run), added in this PR.
- Optional row (not added, D6): `requestId`/`clientId` filters on the admin audit API.

## Pitfalls for the next session

- `.specify/feature.json` is git-ignored; it points at `specs/010-citara-integration`.
- The E2E harness's default (`providers that throw`) is part of the dashboard tests'
  contract; keep scripted providers opt-in.
- The `x-tamiz-privacy` description in the chat route's OpenAPI omits `block` and
  `anonymize;notice=v2`, which the gateway does send; the guide lists all values.
- Keep example prompts in English (ADR-0002); only the synthetic markers are Spanish data.

## Links

- Spec / plan / tasks: `specs/010-citara-integration/`
- ADRs: none added
- Related task records: `T-002-06-chat-completions-endpoint.md`, `T-005-04-privacy-in-route-inference.md`, `T-006-04-audit-query-api.md`, `T-008-02-dashboard-skeleton.md`, `T-009-05-native-tool-calling.md`
