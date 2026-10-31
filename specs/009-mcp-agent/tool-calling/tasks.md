---

description: "Task list for the 009 addendum: native tool calling through the gateway"
---

# Tasks: Native Tool Calling Through the Gateway

**Input**: `specs/009-mcp-agent/tool-calling/` (`plan.md`, `spec.md`, `research.md` T-R01 …
T-R15, `data-model.md`, `contracts/`, `quickstart.md`); features 002-007 and 009 merged.

**Tests**: Mandatory (constitution III). Each test task comes before the code it covers and
names its scenarios; the scenario id (`US3-2`, …) is the test name.

**Organization**: one backlog task (`T-009-05`), one implementation PR, phases by user
story. Abbreviations: `gw/` = `apps/gateway/`, `contracts/` = `packages/contracts/`,
`evals/` = `packages/evals/`, `mcp/` = `apps/mcp-server/`.

## Scenario coverage

| Scenario | Task | Scenario | Task |
|---|---|---|---|
| US1-1 tool call answer, `content: null` | T012 | US4-4 first-token rule with a tool call | T018 |
| US1-2 follow-up with call and result | T012 | US5-1 same tools on fallback | T019 |
| US1-3 `tool_choice` passed | T010, T012 | US5-2 provider rejects tools → next | T019 |
| US1-4 no tool fields: unchanged | T002, T012 | US5-3 foreign ids (Mistral aliasing) | T010, T020 |
| US1-5 four adapters, upstream shapes | T010 | US5-4 critical never leaves local | T019 |
| US2-1 DNI only in a tool result → local | T013 | US6-1 audit tools summary | T021 |
| US2-2 name in arguments → anonymize | T013 | US6-2 span attributes | T021 |
| US2-3 data in a tool definition counts | T013 | US6-3 marker nowhere | T023 |
| US2-4 detector down → `onDetectorError` | T013 | US6-4 name pattern enforced | T002 |
| US3-1 placeholders in tool results | T014 | US7-1 tool cases meet bounds | T026 |
| US3-2 restored arguments parse | T014 | US7-2 tool cases removed → fail | T026 |
| US3-3 escaping on restore | T008, T014 | US7-3 tool messages not inspected → fail | T026 |
| US3-4 anonymized string arguments parse | T007, T014 | US8-1 native run, contract-valid | T028 |
| US3-5 number → quoted placeholder | T007, T014 | US8-2 two calls in one answer | T028 |
| US3-6 unsafe → `restrict_to_local` | T013, T014 | US8-3 text protocol unchanged | T028 |
| US4-1 OpenAI chunk shape | T017 | | |
| US4-2 split placeholder in arguments | T017 | | |
| US4-3 two calls, own state | T017 | | |

---

## Phase 1: Setup

- [x] T001 Create branch `T-009-05-native-tool-calling` from `origin/main`; extend the scripted fakes so tests can script tool calls: `packages/test-utils/src/scripted-port.ts` and the gateway test helpers (`createTestApp` and its recorded `provider.calls` in `gw/test/helpers/app.ts`, `inspectAs` in `gw/test/helpers/privacy.ts`, which now scripts entities by inspected-text index) accept completions with `toolCalls` and streams with `tool-call-start` / `tool-call-delta` parts; record every `ProviderCompletionInput` (including `tools` and `toolChoice`) for assertions.

---

## Phase 2: Foundational (contracts and domain types; blocks every story)

- [x] T002 [P] Contract tests in `contracts/test/chat-completion-tools.test.ts`: valid request of `contracts/chat-completion-tools.md`; rejections (400 shapes): duplicate tool names, name not matching `^[a-zA-Z0-9_-]{1,64}$` (US6-4), more than 128 tools, `tool_choice` without `tools`, `tool_choice` naming an undeclared function, `tool` message whose `tool_call_id` matches no earlier call, assistant message with neither content nor calls, `arguments` not parsing to a JSON object, `parallel_tool_calls` / `response_format` / `functions` present; response with `content: null` and `tool_calls`, `finish_reason: "tool_calls"`; chunk delta with tool-call pieces; every pre-existing fixture still validates (US1-4).
- [x] T003 Implement in `contracts/src/chat-completion.ts`: `ToolDefinitionSchema`, `ToolChoiceSchema`, `ToolCallSchema`, the message union (`system`/`user` string content; `assistant` with `content: string | null` and optional `tool_calls`; `tool` with `tool_call_id` and `content`), the request `superRefine` cross-field rules (messages name the field path, never values), `FINISH_REASON_VALUES` plus `"tool_calls"`, response message and chunk delta additions; update the file's header comment; export from `contracts/src/index.ts`.
- [x] T004 [P] Contract changes in `contracts/src/simulate.ts` (entity `location` as `{kind: "content", messageIndex} | {kind: "arguments", messageIndex, toolCallIndex} | {kind: "tool_definition", toolIndex}`, `messageIndex` optional and absent for tool definitions, `notAnonymizable?: "json_structure" | "tool_definition"`, `providerMessages` uses the message union) and `contracts/src/audit.ts` (`tools?: {declared: int ≥ 0, toolMessages: int ≥ 0, called: string[] (max 32)}`), with tests in `contracts/test/`.
- [x] T005 Domain types in `gw/src/domain/model/inference-request.ts` per data-model 1.1 (`Message` union, `ToolDefinition`, `ToolCall` with `arguments: string`, `ToolChoice`, `InferenceRequest.tools?` and `toolChoice?`); `FINISH_REASONS` in `gw/src/application/ports/llm-provider.port.ts` gains `"tool_calls"` (drift test in `gw/test/contracts-drift.test.ts`); fix every compile error with no behaviour change (tool-free paths keep their output).
- [x] T006 [P] `gw/src/domain/model/inspected-text.ts` with tests first in `gw/test/domain/inspected-text.test.ts`: order (content, then each call's arguments, per message; then definitions as `description + "\n" + JSON.stringify(parameters)`), locations, and "tool-free request → exactly today's contents".
- [x] T007 [P] `gw/src/domain/model/json-spans.ts` with tests first in `gw/test/domain/json-spans.test.ts`: `placeJsonSpan` returns `in_string` / `whole_number` / `unsafe`; property test (fast-check): for generated JSON objects and spans classified `in_string` or `whole_number`, replacing by a placeholder (quoted for numbers) parses with the same shape (US3-4, US3-5).
- [x] T008 [P] `gw/src/domain/model/placeholders.ts` and `restore-stream.ts`, tests first in `gw/test/domain/`: `anonymizeTexts(texts, entities, kinds)` (one mapping across texts, quoted number replacement in argument texts, `unsafe` reason for structure-crossing spans and for any entity in a definition), `restoreJson` (JSON-escaped values, US3-3), `createStreamRestorer(mapping, escape)`; existing spec 005 vectors still pass.
- [x] T009 Presentation mappers in `gw/src/presentation/mappers/`: request DTO → domain (fills `toolName` of `tool` messages from the earlier call), domain completion → response (`content: null` when no text and calls present; `arguments` as text), `openapi-schemas.ts` updated; `gw/test/openapi.test.ts` covers the new fields.

**Checkpoint**: contracts and domain compile; all existing tests green.

---

## Phase 3: User Story 1 - standard tool calling (P1) 🎯 MVP

**Goal**: a two-turn tool-calling exchange works with fakes and with each adapter's upstream
shape. **Independent test**: T010 and T012.

- [x] T010 [P] [US1] Adapter tests in `gw/test/llm/adapter-scenarios.ts` and the four `*.adapter.test.ts` (MSW): tools and `tool_choice` (`auto`, `none`, `required`, named) reach the upstream body in each provider's format; history with tool calls and tool results; an answer with one and with two tool calls comes back as `toolCalls` with ids, names and arguments text; `finishReason: "tool_calls"`; invalid model JSON arguments are forwarded raw; Mistral: non-9-char ids aliased upstream and mapped back (US5-3); a 4xx answer to tools is a non-retryable `http_error`.
- [x] T011 [US1] Implement in `gw/src/application/ports/llm-provider.port.ts` (input `tools`/`toolChoice`, `ProviderCompletion.toolCalls`) and `gw/src/infrastructure/llm/ai-sdk-provider.ts` (tools as `tool({description, inputSchema: jsonSchema(parameters)})` without `execute`, `toolChoice` mapping, `toModelMessage` for assistant tool-call parts and tool-result parts with `output: {type: "text", value}`, `toCompletion` reads `toolCalls`, `toFinishReason("tool-calls") → "tool_calls"`); id aliasing in `gw/src/infrastructure/llm/mistral.ts` (research T-R09).
- [x] T012 [US1] Endpoint tests in `gw/test/chat-completions-tools.test.ts` (US1-1 … US1-4), then pass `tools` and `toolChoice` to every attempt in `gw/src/application/use-cases/route-inference.ts` and map `toolCalls` in the response.

---

## Phase 4: User Story 2 - personal data in tool messages is routed (P1)

**Goal**: inspection covers every inspected text. **Independent test**: T013.

- [x] T013 [US2] Tests first in `gw/test/chat-completions-tools-privacy.test.ts` and `gw/test/application/inspect-sensitivity.test.ts`: US2-1 (DNI only in a tool result → only the local target is called, `x-tamiz-sensitivity: critical`, `x-tamiz-privacy: restrict_to_local`), US2-2, US2-3, US2-4, US3-6 (decision level); the cache key changes with the tool result. Then: `inspect-sensitivity.ts` takes the inspected texts and bumps `DETECTION_OPTIONS_VERSION` to `analyze-v2`; `DetectedEntity.messageIndex` → `textIndex` (`sensitivity.ts`, `http-pii-detector.ts`); `classify-task.ts` / `task-classifier.ts` classify over all inspected texts; `routing-decision.ts` adds `anonymizable` and the anonymize → `restrict_to_local` downgrade with the policy's `localRoute` (no route → block `no_target`), emitting `privacy.not_anonymizable {requestId, reason}` from `decideWithPrivacy`; property test of `decide` extended.

---

## Phase 5: User Story 3 - anonymize and restore inside tool calls (P1)

**Goal**: placeholders in tool results and arguments, restored in the answer's calls.
**Independent test**: T014.

- [x] T014 [US3] Tests first in `gw/test/chat-completions-tools-privacy.test.ts` (US3-1 … US3-6) and `gw/test/application/protect-request.test.ts`; then replace `protect-messages.ts` by `protect-request.ts` (data-model section 3: provider messages with anonymized contents, arguments and tool results; definitions untouched; `restore`, `restoreArguments`, stream restorer factories; notice `v2` when tools or tool messages are present, `v1` otherwise); add `gw/prompts/anonymization-notice.v2.md` (v1 plus the tool-arguments sentence, English and Spanish) and load it in `main.ts` / config; `route-inference.ts` restores text and every call's arguments.

---

## Phase 6: User Story 4 - streamed tool calls (P2)

**Goal**: OpenAI-shaped tool-call chunks, restored per call. **Independent test**: T017, T018.

- [x] T015 [P] [US4] Stream adapter tests in `gw/test/llm/stream-scenarios.ts`: `tool-input-start`/`-delta`/`-end`/`tool-call` → `tool-call-start` + `tool-call-delta` parts with indices by first appearance; a provider sending a whole call in one `tool-call` part → one start and one delta; a stream that starts with a tool call resolves `stream()` at that start.
- [x] T016 [US4] Implement `ContentPart`, `StreamPart` additions in the port (`StartedStream.first` stays a string: `""` when the stream starts with a tool call, whose start opens `rest`), and the mapping in `ai-sdk-provider.ts` (`rest` and `stream`).
- [x] T017 [US4] Tests first in `gw/test/chat-completions-tools-stream.test.ts` (US4-1 … US4-3); then `stream-inference.ts` keeps one text restorer and one JSON-escaping restorer per call index, flushed in index order before `finish`/`error`, and `gw/src/presentation/mappers/chat-completion-chunk.ts` emits the chunk shapes of `contracts/chat-completion-tools.md`.
- [x] T018 [US4] Test US4-4 in `gw/test/chat-completions-tools-stream.test.ts`: failure before the first tool-call start falls back; after it, the error event and no fallback.

---

## Phase 7: User Story 5 - fallback keeps tools and guarantees (P2)

- [x] T019 [US5] Tests in `gw/test/resilience/tools-fallback.test.ts`: US5-1 (both attempts recorded with identical `tools`, `toolChoice`, messages; `x-tamiz-fallback`), US5-2 (4xx → no retry on that target, next target answers), US5-4 (critical data, local targets failing → failure, never a non-local call). No production change expected; fix any gap found.
- [x] T020 [US5] US5-3 end to end in `gw/test/chat-completions-tools.test.ts`: history with an Anthropic-style id routed to a Mistral fake returns the client's own ids.

---

## Phase 8: User Story 6 - content-free audit and traces (P2)

- [x] T021 [US6] Tests first in `gw/test/audit/` and `gw/test/telemetry/` (US6-1, US6-2); then `audit-entry.ts` (`tools?: AuditTools`, `called` at most 32 names), `with-audit.ts` (declared count, tool message count, called names from the completion or streamed starts; `requestHash` over inspected texts), `with-tracing.ts` (`tamiz.tools.declared`, `tamiz.tools.called`, `finish_reasons` with `tool_calls`; never `gen_ai.tool.call.arguments`, `gen_ai.tool.call.result`, `gen_ai.tool.definitions`).
- [x] T022 [US6] Persistence: `gw/src/infrastructure/persistence/schema.ts` adds nullable `tools jsonb`; generate `gw/drizzle/0001_audit_tools` with `pnpm --filter @tamiz/gateway db:generate`; `audit-log-repository.ts` maps null ↔ absent; Testcontainers test round-trips an entry with and without tools; admin audit query output and `mcp/` `query_audit_log` output expose `tools` (contract from T004).
- [x] T023 [US6] Marker test (US6-3, SC-004) in `gw/test/telemetry/content-free-tools.test.ts`: one marker in a tool description, in arguments and in a tool result; after an answered, a streamed and an anonymized request, the marker is absent from captured logs, exported spans and events, routing events and in-memory audit entries.

---

## Phase 9: User Story 7 - leak eval covers tool messages (P1)

- [x] T024 [US7] Simulator (FR-015): tests first in `gw/test/simulate.test.ts` (tool request with a DNI in a tool result: location, `critical`, `restrict_to_local`; with a name: `providerMessages` with placeholders in the tool result and arguments; `notAnonymizable` case); then `simulate-policy.ts` and its mapper.
- [x] T025 [US7] Dataset v2: `evals/src/datasets.ts` (`LeakCase` with the message union, optional `tools`, value `location` defaulting to `{kind: "content", messageIndex}`), `evals/src/synthetic/generate.ts` adds ≥ 40 tool cases and ≥ 60 tool-message values per the mix in `contracts/leak-eval-tools.md` (tags `tool-result`, `tool-arguments`, `tool-both`); generate `evals/datasets/pii-leak-es.v2.jsonl`, remove v1, point `leak.ts` at v2; generator tests check counts, offsets and that `--check` is stable.
- [x] T026 [US7] Tests first in `evals/test/leak.test.ts` (US7-1 scorer over contents + arguments + tool results; US7-2 thresholds fail when `values.tool_messages` < 40; US7-3 a simulated response that left a DNI in a tool result with a non-local chain counts as a leak); then `evals/src/evals/leak.ts` (texts sent, `values.tool_messages`, `leak_rate.tool_messages`) and `evals/src/thresholds.ts` (`values.tool_messages gte 40`). CI job `evals` must be green on the PR.

---

## Phase 10: User Story 8 - the agent uses native tools (P3)

- [x] T027 [P] [US8] Config: `TAMIZ_AGENT_TOOL_PROTOCOL` (`native` | `text`, default `native`) in `mcp/src/config.ts` with tests; `mcp/src/agent/prompts/system.v2.md` (no rendered tool list); the fake gateway in `mcp/test/support/fake-gateway.ts` answers with scripted `tool_calls` and still validates every body with `ChatCompletionRequestSchema`.
- [x] T028 [US8] Tests first in `mcp/test/agent-native.test.ts` (US8-1, US8-2; US8-3 by running the existing text-protocol tests with `text`); then `mcp/src/agent/native-protocol.ts` (MCP tools → AI SDK tools without `execute` via `jsonSchema`, run each call in order through the MCP client, append response messages and one `tool` message per call, 8 000-character truncation, 6-model-call limit) and the protocol switch in `run-agent.ts`; run record gains `protocol` and call ids; `mcp/README.md` and `specs/009-mcp-agent/research.md` R-10 get a note pointing to this addendum.

---

## Phase 11: Polish

- [x] T029 Docs: `CLAUDE.md` §5 (request flow mentions tool messages) and §12 (agent protocol variable), `.env.example` / `mcp` env docs, `README.md` (tool calling in the feature list), `docs/architecture.md` if it lists the message shape.
- [x] T030 Gates: `pnpm lint`, `pnpm typecheck`, `pnpm arch`, `pnpm test`, `pnpm build`, privacy service steps unchanged; required checks `ci` and `evals` green; task record `docs/tasks/done/T-009-05-native-tool-calling.md` and the backlog row in the same commit.

---

## Dependencies & Execution Order

- Phase 1 → Phase 2 (T002-T009) → stories.
- US1 (T010-T012) first: every other story sends tools through the port.
- US2 (T013) before US3 (T014): anonymization uses the inspected texts and the downgrade.
- US4 (T015-T018) after US1 and US3 (restorers).
- US5 (T019-T020) after US1; US6 (T021-T023) after US1, US4.
- US7 (T024-T026) after US2, US3: the eval measures them through the simulator.
- US8 (T027-T028) after US1 (contract) only; it can run in parallel with US2-US7.

## Parallel Opportunities

- T002, T004, T006, T007, T008 (different files).
- T010 with T015 (adapter tests), T027 with any gateway story.

## Implementation Strategy

1. MVP: Phases 1-3 (tool calling without privacy-specific changes is never merged alone:
   the PR lands only with US2 and US3, because a tool result must never skip inspection).
2. Then US4-US7 in order; US8 last, in the same PR (backlog: one PR per task).
3. Merge when `ci` and `evals` are green.
