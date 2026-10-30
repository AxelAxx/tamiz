# T-003-01 — Spec, plan and tasks for `003-resilience`

| Field | Value |
|---|---|
| Task | `T-003-01` (see `docs/tasks/BACKLOG.md`) |
| Feature | `003-resilience` |
| Spec | `specs/003-resilience/spec.md` |
| Branch / PR | `003-resilience` (Spec Kit naming), cut from `main` at 89d6344 / PR opened after this commit |
| Date | 2026-10-30 |
| Session | Claude Code (Claude Opus 5.5), side session |
| Status | done; spec reviewed and approved by Alex on 2026-10-30 without changes (`spec.md` flipped to `Approved` in the same PR, as in `T-002-01`) |

## What was done

I wrote the Spec Kit set for feature 003 with `/speckit-specify`, `/speckit-plan` and
`/speckit-tasks`:

- `spec.md`: 7 user stories with 35 Given/When/Then scenarios, FR-001 … FR-031 grouped
  by backlog task, SC-001 … SC-009, 12 edge cases and the assumptions.
- `checklists/requirements.md`: all items pass, with notes.
- `plan.md`: technical context, constitution check with no violations, source tree,
  requirement → backlog-task mapping.
- `research.md`: decisions R-01 … R-15.
- `data-model.md`: contract, domain, port, adapter and presentation shapes.
- `contracts/{README,http}.md` and `contracts/policy.example.yaml`.
- `quickstart.md`.
- `tasks.md`: 66 tasks in 6 phases, one phase per backlog task `T-003-02` …
  `T-003-06` plus polish, with the scenario → task coverage table.

The backlog gains no row: `T-003-02` … `T-003-06` already cover the work.

## Files touched

- `specs/003-resilience/spec.md`, `checklists/requirements.md`: specification and its quality checklist.
- `specs/003-resilience/plan.md`, `research.md`, `data-model.md`, `quickstart.md`: design.
- `specs/003-resilience/contracts/{README.md,http.md,policy.example.yaml}`: review projections.
- `specs/003-resilience/tasks.md`: 66 tasks.
- `docs/tasks/BACKLOG.md`: `T-003-01` → `done` (draft, pending approval).
- `docs/tasks/done/T-003-01-spec-plan-tasks-003.md`: this record.

## Decisions (flagged for Alex's review)

- **Residency is an explicit allowed set (R-06).** Rules and the default chain may
  declare `residency: [...]`, and the decision carries `allowedResidencies` (all four
  residencies when nothing is declared, which keeps 002 behaviour).
  - The executor never calls a target outside the set; reaching one stops the request
    with 451 `policy_blocked` instead of degrading it.
  - `validatePolicy` rejects a chain that contradicts its own rule at boot.
  - Feature 005 narrows the set per request; this feature builds the guard that
    enforces it.
  - Rejected alternative: implicit "never weaker than the primary". It would block the
    default chain's EU → US step for every non-sensitive request.
- **`default.yaml` changes (R-06):**
  - `pinned-local` gets `[local]`.
  - `long-documents-eu` gets `[eu, local]`, and its chain drops `openai-mini`, which
    would otherwise be a boot error.
  - The policy moves to version 2.
  - The first target of every rule is unchanged, so the routing dataset still scores
    44/44 (checked in `T-003-04`).
- **Any final failure advances the chain; only retryable ones are retried and counted
  by the breaker (R-05).** A rejected credential is not an outage.
- **New `provider_unavailable` (503) with `retry-after`** when every circuit is open
  (R-13). Residency violations reuse `policy_blocked` (451, 001).
- **Request deadline** (`resilience.requestDeadlineMs`, default 60 s) bounds all
  attempts, waits and fallbacks (R-07). Deadline or client disconnect aborts use a new
  cause `aborted`, which is never retried or counted.
- **`ClockPort.sleep`** (R-01) extends the 001 port, and the fake clock gains pending
  sleepers, so no resilience test waits in real time. Randomness is an injected
  function, not a port (R-02).
- **Breaker logic lives in the domain and application; the port only stores (R-04).**
  The port's atomic operations (`recordFailure`, `open`, `tryAcquireTrial`, …) are the
  minimum Redis needs for the single half-open trial across instances.
- **One `executeChain` serves completions and streams (R-08).** The streaming port
  resolves at the first token (R-09), so "fallback only before the first token" falls
  out of the types.
- **Streaming format (R-10):** OpenAI `chat.completion.chunk` lines and a usage chunk
  (always sent, because cost visibility is a product promise), then `[DONE]`. A
  mid-stream failure writes `data: {"error": …}` and closes without `[DONE]`.
- **Events (R-12):** a `RoutingEventsPort` with a log sink now; feature 006 adds the
  trace, metric and audit sinks. The event type has no field for content.
- **Placement:** the in-memory circuit-state adapter goes in `infrastructure/cache/`
  (it is a production adapter), not in `test-utils` as the backlog row of `T-003-03`
  says.
- **`ioredis` 5 plus Testcontainers with Valkey 8 (R-11).** `docker-compose.yml` does not
  exist on `main` yet; `T-003-06` creates it with the `valkey` service only.

## How it was verified

No code exists yet; verification is structural.

```bash
git checkout -b 003-resilience origin/main
SPECIFY_FEATURE=003-resilience powershell.exe -NoProfile -File .specify/scripts/powershell/setup-plan.ps1 -Json
SPECIFY_FEATURE=003-resilience powershell.exe -NoProfile -File .specify/scripts/powershell/setup-tasks.ps1 -Json
#  AVAILABLE_DOCS: research.md, data-model.md, contracts/, quickstart.md
grep -c "^- \[ \] T0" specs/003-resilience/tasks.md   # 66
```

- **Coverage:** checked by hand. All 35 scenarios and all 31 FRs map to at least one
  task (the coverage table in `tasks.md`), and every SC names its measuring task.
- **Library facts checked on 2026-10-30:**
  - AI SDK 6 `streamText`: the `fullStream` part types `text-delta`, `finish`, `error`
    and `abort` are in the installed `index.d.ts`. The current online docs describe v7
    (`stream`, `onEnd`), which does not apply.
  - Hono `streamSSE` is exported from `hono/streaming`.
- **Not run:** `/speckit-analyze`, the optional consistency pass. A self-review fixed
  scenario counts and the residency path in quickstart §4.

## Pending / follow-ups

- Alex approved the artefacts on 2026-10-30 without changes; every decision above
  stands as planned. `T-003-02` can start (and `T-003-06` after `T-003-03`).
- No new backlog rows.

## Pitfalls for the next session

- `T-003-02` changes `ClockPort` and `createFakeClock`. Rebuild `@tamiz/test-utils`
  before gateway-only Vitest runs (T-002-03 pitfall).
- `T-003-04` widens `DomainError` twice. Grep `assertNever(` (mapper and
  `test/result.test.ts`).
- `T-003-04` changes `default.yaml`: update the version and chain assertions in
  `file-policy-loader.test.ts`, and confirm the routing dataset gate with
  `--reporter=default`.
- Contract schemas used in OpenAPI must be named with `.meta({ id })`, never
  `.openapi()` (T-002-06 pitfall). `ChatCompletionChunk` follows the same rule.

## Links

- Spec / plan / tasks: `specs/003-resilience/{spec,plan,tasks}.md`
- Design: `specs/003-resilience/{research,data-model,quickstart}.md`, `contracts/`
- Builds on: `specs/002-provider-routing/`, `docs/tasks/done/T-002-0{4,5,6,7,8}-*.md`
- ADRs: none added (the residency model is recorded in R-06; promote it to an ADR if Alex wants it permanent beyond this feature)
- Related task records: `docs/tasks/done/T-002-01-spec-plan-tasks-002.md` (conventions and script pitfalls)
