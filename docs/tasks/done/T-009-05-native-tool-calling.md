# T-009-05 — Native OpenAI tool calling through the gateway

| Field | Value |
|---|---|
| Task | `T-009-05` (see `docs/tasks/BACKLOG.md`) |
| Feature | `009-mcp-agent` (addendum `tool-calling`) |
| Spec | `specs/009-mcp-agent/tool-calling/spec.md` |
| Branch / PR | spec: `T-009-05-native-tool-calling-spec` / PR #53 (merged); implementation: `T-009-05-native-tool-calling` / PR opened after this commit |
| Date | 2026-10-31 |
| Session | Claude Code (Claude Opus 5.5), side session |
| Status | done; spec approved by Alex on 2026-10-31 ("Approve", decisions D1-D8 as written) |

## What was done

The gateway carries OpenAI function tools end to end, the privacy step covers them, and
the dogfooding agent uses them natively.

- **Contract** (FR-001 … FR-005): `tools`, `tool_choice`, assistant `tool_calls`, `tool`
  messages, `finish_reason: "tool_calls"`, streamed tool-call pieces; cross-field rules
  (unique names, declared choice, tool message answers an earlier call, arguments are a JSON
  object) as a `superRefine` whose issues name paths, never values. Simulate entities gain a
  `location`; the audit entry gains `tools`.
- **Providers** (FR-006, FR-016, FR-017): the port carries tools, tool choice, tool calls and
  tool-call stream parts; the AI SDK adapter passes tools without `execute`; a stream that
  starts with a call is started at its first input part. The Mistral adapter aliases tool-call
  ids it would reject and maps them back.
- **Privacy** (FR-007 … FR-015): inspection over *inspected texts* (contents, arguments, tool
  results, tool definitions); JSON-safe anonymization of arguments (`placeJsonSpan`); the
  `anonymize` → `restrict_to_local` downgrade with `privacy.not_anonymizable` when a value
  cannot be replaced safely; restoration of the answer's arguments with JSON-escaped values,
  per call when streamed; notice `v2` for requests with tools (`v1` otherwise).
- **Audit and spans** (FR-018 … FR-020): `tools: {declared, toolMessages, called}` in the
  entry (`jsonb` column, migration `0001_audit_tools`), `tamiz.tools.*` span attributes;
  never arguments, results or schemas.
- **Evals** (FR-021 … FR-024): `pii-leak-es` v2 = the 160 v1 cases (byte-identical) plus 40
  tool cases (tool results, arguments, both); the scorer reads contents, arguments and tool
  results; new gate `values.tool_messages ≥ 40`, reported `leak_rate.tool_messages`.
- **Agent** (FR-025): `TAMIZ_AGENT_TOOL_PROTOCOL=native` (default) declares the MCP tools,
  runs every call of an answer in order and sends results as `tool` messages; `text` keeps
  spec 009 R-10. Prompt `system.v2.md` for native.

## Files touched

- `packages/contracts/src/{chat-completion,simulate,audit,index}.ts` and tests — the contract.
- `apps/gateway/src/domain/model/{inference-request,inspected-text,json-spans,placeholders,restore-stream,privacy-policy,routing-decision,task-classifier,audit-entry}.ts` — domain.
- `apps/gateway/src/application/` — port, routing events, `protect-request.ts` (replaces `protect-messages.ts`), route, stream, simulate, audit, tracing.
- `apps/gateway/src/infrastructure/llm/{ai-sdk-provider,mistral,tool-call-ids}.ts`, `privacy/anonymization-notice.ts`, `persistence/{schema,audit-log-repository}.ts`; `drizzle/0001_audit_tools.sql`; `prompts/anonymization-notice.v2.md`.
- `apps/gateway/src/presentation/` — request, response and chunk mappers, chat and simulate routes.
- `apps/gateway/test/` — `llm/tool-calling.adapter.test.ts`, `chat-completions-tools{,-stream}.test.ts`, `domain/tool-texts.test.ts`, simulate and Postgres cases, small updates to existing tests.
- `packages/evals/` — dataset schema, generator, `pii-leak-es.v2.jsonl` (v1 removed), leak scorer, thresholds, client, README.
- `apps/mcp-server/` — `run-agent.ts`, `demo.ts`, `prompts/system.v2.md`, README, fake gateway, agent tests.
- `CLAUDE.md` §5 and §12; `specs/009-mcp-agent/research.md` (R-10 note); the addendum's `tasks.md`, `data-model.md`, `plan.md`, `research.md` (implementation notes).

## Decisions

- **D1-D8 as approved** (`research.md` T-R01 … T-R14).
- **Deviations from the data model, smaller than planned.**
  - `StartedStream.first` stays a string. A stream that starts with a tool call has
    `first: ""` and its `rest` begins with the call's start, so the stream tests and the
    first-token rule kept their shape.
  - `ProviderCompletion.toolCalls` is optional (absent when none), so tool-free completions
    and their tests are unchanged (FR-005).
  - The migration is `0001_audit_tools` (there was only `0000_init`).
- **The request hash** is now over the domain messages plus the tool definitions. Assistant
  messages carry `toolCalls: []` in the domain, so the hash of a conversation with an
  assistant turn differs from before this change. It only correlates identical requests, and
  the key may be ephemeral, so no migration was attempted.
- **Size counts every inspected text**; the task type still reads the system and last user
  messages only (spec 002 R-07 unchanged).
- **Invalid tool calls in the agent**: AI SDK 6 already answers an unknown tool or
  unparsable arguments with an error tool result in `response.messages`; the agent records
  the step as `observation_error` and does not add a second result.
- **Generator**: the tool cases use their own seeds (`seed + 4`, `seed + 5`), so the v1 cases
  of `pii-leak-es` are byte-identical in v2.

## How it was verified

```bash
pnpm lint        # 0 errors (2 warnings, 90 infos: pre-existing)
pnpm typecheck   # 9/9 tasks
pnpm arch        # no dependency violations (149 modules)
pnpm test        # 121 files, 1276 passed, 28 skipped (Testcontainers suites skip without Docker)
pnpm build       # 6/6 tasks
```

- The generated datasets match the generator (`--check`, in the synthetic test).
- The adapter tests run all four providers against MSW with their wire formats (tools, tool
  choice, history, two calls, a streamed call, a 400 rejection, Mistral id aliasing).
- The leak eval with the real privacy service and the Postgres round trip run in CI only
  (no Docker here): the `evals` and `ci` checks of the PR are their verification.

## Pending / follow-ups

- `T-009-06` (recorded agent demo on the full stack) now runs the native protocol by
  default; if `llama3.1:8b` does not follow native tools, record it and run with
  `TAMIZ_AGENT_TOOL_PROTOCOL=text`.
- A per-target "no tools" flag stays out until an eval shows the need (D5).

## Pitfalls for the next session

- `.specify/feature.json` is git-ignored; Spec Kit commands for this addendum need
  `SPECIFY_FEATURE_DIRECTORY=specs/009-mcp-agent/tool-calling`.
- The AI SDK docs site shows AI SDK 7 names in places; the repo is on `ai` 6.0.319.
- `DetectedEntity.messageIndex` is now `textIndex`: an index into `inspectedTexts`, which is
  the message contents for tool-free requests but not in general.
- Long `node -e` and heredoc edits with quotes break the Bash tool on this machine; an edit
  script in the scratchpad with a separate edits file worked reliably.
- Anthropic receives `tool_choice: {type: "none"}` with the tools, not an empty tool list.

## Links

- Spec / plan / tasks: `specs/009-mcp-agent/tool-calling/`
- Parent: `specs/009-mcp-agent/research.md` R-10
- Related task records: `T-009-04-mcp-agent.md`, `T-005-04-privacy-in-route-inference.md`,
  `T-005-05-streaming-restoration.md`, `T-006-05-opentelemetry.md`,
  `T-007-03-leak-detection-evals.md`
