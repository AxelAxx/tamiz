# T-009-05 — Native OpenAI tool calling through the gateway

| Field | Value |
|---|---|
| Task | `T-009-05` (see `docs/tasks/BACKLOG.md`) |
| Feature | `009-mcp-agent` (addendum `tool-calling`) |
| Spec | `specs/009-mcp-agent/tool-calling/spec.md` |
| Branch / PR | `T-009-05-native-tool-calling-spec` (spec, draft PR); implementation on `T-009-05-native-tool-calling` after approval |
| Date | 2026-10-31 |
| Session | Claude Code (Claude Opus 5.5), side session |
| Status | spec approved by Alex on 2026-10-31 ("Approve", D1-D8 as written); implementation follows on `T-009-05-native-tool-calling` |

## What was done

Phase 1 (spec first, constitution III). The Spec Kit set for native tool calling, written
with `/speckit-specify`, `/speckit-plan` and `/speckit-tasks` into an addendum folder of
feature 009:

- **`spec.md`**: 8 stories (33 scenarios), FR-001 … FR-025, SC-001 … SC-006, edge cases,
  assumptions.
- **`research.md`**: T-R01 … T-R15; decisions D1-D8 flagged for review (below).
- **`data-model.md`**, **`contracts/chat-completion-tools.md`**,
  **`contracts/leak-eval-tools.md`**, **`quickstart.md`**, **`checklists/requirements.md`**
  (all items pass).
- **`tasks.md`**: 30 tasks, tests first, with the scenario coverage table.

## Decisions flagged for Alex

- **D1** Addendum folder `specs/009-mcp-agent/tool-calling/` instead of a new feature
  number; Spec Kit resolves it with `SPECIFY_FEATURE_DIRECTORY` (T-R01).
- **D2** Tool definitions (description + schema) are inspected too: the provider reads them
  (T-R04).
- **D3** No special privacy rule for tool results: the request's level is the maximum over
  all texts, so a DNI only in a tool result → `restrict_to_local` (T-R05).
- **D4** Arguments are anonymized on their JSON text, JSON-safely; a value that cannot be
  replaced safely (crosses JSON structure, or sits in a tool definition) downgrades
  `anonymize` → `restrict_to_local` with event `privacy.not_anonymizable`. Client-sent
  arguments that are not a JSON object are a 400 (OpenAI forwards any string) (T-R06).
- **D5** No per-target tool capability flag; a provider that rejects tools is a
  non-retryable error and the chain moves on (T-R10).
- **D6** New anonymization notice `v2` only for requests with tools or tool messages;
  tool-free requests keep `v1` (T-R12).
- **D7** Leak dataset goes to v2 with ≥ 40 tool cases; same per-kind thresholds plus a gate
  `values.tool_messages ≥ 40` (T-R13).
- **D8** The agent's protocol defaults to `native`; `TAMIZ_AGENT_TOOL_PROTOCOL=text` keeps
  spec 009 R-10 (T-R14).

## Files touched

- `specs/009-mcp-agent/tool-calling/*` — the addendum (new).
- `docs/tasks/done/T-009-05-native-tool-calling.md` — this record (draft).
- `docs/tasks/BACKLOG.md` — the T-009-05 row: status `in review`.

## How it was verified

Documentation only. Checklist `checklists/requirements.md` reviewed item by item; task ids,
scenario coverage table and the plan's requirement → task table cross-checked. AI SDK 6
tool APIs checked with Context7 (`/websites/ai-sdk_dev`). No code changed, no gates run.

## Pending / follow-ups

- Alex's review of D1-D8; then implementation per `tasks.md` (same backlog task, one PR),
  and this record is rewritten as the implementation record.

## Pitfalls for the next session

- `.specify/feature.json` is git-ignored; for `/speckit-implement` set
  `SPECIFY_FEATURE_DIRECTORY=specs/009-mcp-agent/tool-calling` (or write that file
  locally).
- The AI SDK docs site shows AI SDK 7 names in places; the repo is on the `ai-v6` line
  (research T-R02).
- The worktree had no `node_modules` during the spec phase; run `pnpm install` first.

## Links

- Spec / plan / tasks: `specs/009-mcp-agent/tool-calling/`
- Parent: `specs/009-mcp-agent/research.md` R-10
- Related task records: `T-009-04-mcp-agent.md`, `T-005-04-privacy-in-route-inference.md`,
  `T-005-05-streaming-restoration.md`, `T-006-05-opentelemetry.md`,
  `T-007-03-leak-detection-evals.md`
