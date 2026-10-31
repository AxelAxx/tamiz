# Research: Native Tool Calling Through the Gateway

**Addendum**: `specs/009-mcp-agent/tool-calling/` | **Date**: 2026-10-31

Decisions marked **(review)** are flagged for Alex in the draft PR. AI SDK facts were
checked with Context7 (`/websites/ai-sdk_dev`, current docs, AI SDK 6) on 2026-10-31; the
gateway pins `ai@^6.0.319` and `@ai-sdk/*@^3`.

## T-R01 Where the spec lives **(review, D1)**

**Decision**: `specs/009-mcp-agent/tool-calling/`, an addendum to feature 009, with its own
`spec.md`, `plan.md`, `research.md`, `data-model.md`, `contracts/`, `quickstart.md` and
`tasks.md`. Spec Kit's scripts resolve it through `SPECIFY_FEATURE_DIRECTORY`
(`common.ps1`), so no script changes. Requirement ids are local to the addendum (FR-001 …);
references to the parent spec are written `spec 009 FR-…`.

**Alternatives**: a new `011-tool-calling` folder (breaks the fixed 001-010 roadmap and hides
that it replaces spec 009 R-10); editing spec 009 in place (an approved spec would change
under Alex's feet).

## T-R02 AI SDK 6 surface used

**Decision**, per Context7:
- **Tools without `execute`**: `tools: { [name]: tool({ description, inputSchema:
  jsonSchema(parameters) }) }`. Without `execute` the SDK never runs anything and returns the
  calls (`result.toolCalls`, `finishReason: "tool-calls"`). The gateway uses `jsonSchema()`
  from `ai`, not Zod: schemas are the client's JSON Schema, passed through.
- **`toolChoice`**: `"auto" | "none" | "required" | { type: "tool", toolName }`, mapped 1:1
  from OpenAI's `tool_choice`.
- **History**: assistant `ModelMessage` content parts `{ type: "tool-call", toolCallId,
  toolName, input }` (input is the parsed object) plus `{ type: "text", text }`; tool
  messages `{ role: "tool", content: [{ type: "tool-result", toolCallId, toolName, output:
  { type: "text", value } }] }`. OpenAI's tool message has no name, so the mapper takes it
  from the matching earlier call (FR-003 makes the match mandatory).
- **Stream parts** (`fullStream`): `tool-input-start {id, toolName}`, `tool-input-delta {id,
  delta}`, `tool-input-end {id}`, then `tool-call {toolCallId, toolName, input}`. The adapter
  maps start → `tool-call-start`, delta → `tool-call-delta`, and ignores `tool-call` when the
  input already streamed; a provider that sends no input deltas (Ollama's OpenAI endpoint
  often sends a call in one piece) gets one start and one delta with `JSON.stringify(input)`
  built from `tool-call`.
- **`maxRetries: 0`, `abortSignal`, no `stopWhen`**: one model step per gateway call, as
  today.
- **Version caveat**: the current docs site already shows some AI SDK 7 names (for example
  `result.stream`, `result.responseMessages`). The gateway stays on the `ai-v6` line
  (`ai` 6.0.32x, spec 009 R-01), so the code uses the v6 names it already uses
  (`fullStream`, `response.messages`); the part and message shapes above are the same in
  v6. `T011` reads the installed type declarations before coding.

**Risk, checked by adapter tests**: a model output whose arguments fail to parse. The SDK
marks such a call `invalid` and keeps the raw text; the adapter forwards the raw text
(edge case "model returns invalid JSON").

## T-R03 Where the port's messages change

**Decision**: the domain `Message` becomes a discriminated union:
`system | user` (`content: string`), `assistant` (`content: string | null`,
`toolCalls: ToolCall[]`), `tool` (`toolCallId`, `toolName`, `content`). `toolName` is filled
by the presentation mapper from the earlier call, so the port and adapters never search the
history. `InferenceRequest` gains `tools?: ToolDefinition[]` and `toolChoice?`. Arguments
travel as the JSON text (`ToolCall.arguments: string`): it is what is inspected, anonymized
and restored; the adapter parses it right before the SDK call.

**Alternatives**: arguments as parsed objects in the domain (inspection would need to
re-serialize, and offsets would be against a text nobody sends).

## T-R04 What is inspected: the inspected texts **(review, D2)**

**Decision**: a pure domain function `inspectedTexts(request)` lists every text the provider
will read, each with a location:
`{ kind: "content", messageIndex }`, `{ kind: "arguments", messageIndex, toolCallIndex }`,
`{ kind: "tool_definition", toolIndex }` (the definition's `description` and
`JSON.stringify(parameters)`, joined by a newline). Tool results are `content` locations of
`tool` messages. The detector receives the texts in this order; `DetectedEntity.messageIndex`
becomes the index into this list (renamed `textIndex` in the domain, mapped back to a
location for the simulator). The detection cache key hashes the list (options version
`analyze-v2`).

Tool definitions are inspected because the provider reads them (a schema enum of patient
names is personal data), but they are never anonymized (T-R06).

## T-R05 Action when personal data is only in a tool result **(review, D3)**

**Decision**: no special rule. The level is the maximum over all inspected texts, and the
policy's level → action map applies (spec 005 FR-002). With the default policy a DNI in a
tool result is `critical` → `restrict_to_local` (the backlog acceptance), a name is `high` →
`anonymize`. A tool result is not "less trusted" or "more trusted" than a user message: the
provider reads both.

**Alternatives**: a separate `toolResults` section in the policy (more knobs, no use case
yet, constitution X); always `restrict_to_local` for tool results (would send every agent
with a database tool to the local model, even with no personal data).

## T-R06 Anonymizing JSON arguments safely **(review, D4)**

**Decision**:
- Detection runs on the arguments' JSON text (context helps the NER model; offsets are
  against exactly what is sent).
- A pure domain function `placeJsonSpans(json, spans)` tokenizes the JSON text (strings,
  numbers, literals, punctuation) and, for each span: inside a single string literal (not
  touching its quotes) → replace in place; exactly a whole number literal → replace by
  `"<KIND_n>"` (quoted); anything else → *not anonymizable*.
- Entities in a tool definition are *not anonymizable* too (a schema with a placeholder
  would silently change the client's contract).
- *Not anonymizable* with action `anonymize` → the decision becomes `restrict_to_local` with
  the policy's local route, event `privacy.not_anonymizable {requestId, reason:
  "json_structure" | "tool_definition"}` (FR-011). This is decided in the domain, from the
  inspection and the request, before the chain is built, so the residency guard and the
  audit see the final action.
- Client-sent arguments must be a JSON object at validation time (edge case, 400): without a
  parseable structure FR-010 cannot hold.

**Rationale**: fail closed (constitution V, VI) without sending broken JSON to a provider.
A real detector never returns spans that cross quotes for the structured kinds; NER spans
crossing structure are the rare case this guards.

**Alternatives**: inspecting each JSON string leaf separately (loses NER context, misses
values split across keys); dropping the arguments (breaks the conversation).

## T-R07 Restoring arguments, completed and streamed

**Decision**:
- `restoreJson(text, mapping)`: like `restore`, but each value is JSON-escaped
  (`JSON.stringify(value).slice(1, -1)`). A placeholder the model wrote outside a string
  (`{"n": <PERSON_1>}`) is restored the same way; the output is then as (in)valid as the
  model's own text, never worse.
- Streaming: `createStreamRestorer(mapping, escape)` gains an optional escape function; the
  routed stream keeps one restorer for text and one per tool-call index, flushed in index
  order before `finish` or `error`.
- Placeholders in tool *results* never need restoring: the model never returns them.

## T-R08 Streaming shape and the first-token rule

**Decision**: `StreamPart` gains `{ type: "tool-call-start", index, id, name }` and
`{ type: "tool-call-delta", index, arguments }`. `StartedStream.first` becomes the first
content part (a text delta or a tool-call start) instead of a string, so a stream that
begins with a tool call is "started" at its `tool-input-start` (FR-017). The presentation
layer maps them to OpenAI chunks: start → `{index, id, type: "function", function: {name,
arguments: ""}}`, delta → `{index, function: {arguments}}`. Indices are assigned by the
adapter in order of first appearance.

## T-R09 Tool-call ids across providers (FR-016)

**Decision**: ids are passed through. The Mistral API requires tool-call ids of 9
alphanumeric characters; the Mistral adapter aliases any other id within one call
(deterministic `[a-zA-Z0-9]{9}` from a hash of the id) and maps aliases back in the answer.
Other providers accept OpenAI-style and Anthropic-style ids; adapter tests pin it.

**Alternative**: normalizing all ids at the gateway (changes ids the client must match).

## T-R10 Fallback across providers

**Decision**: nothing new in `executeChain`: the attempt closure captures the same tools,
choice and protected messages for every target (US5-1). A provider that rejects tools
answers 4xx → non-retryable `http_error` → the chain advances (spec 003 FR-013). No
per-target capability flag (constitution X); if the routing or quality evals show a model
that ignores tools, a `tools: false` target flag is a later task. **(review, D5)**

## T-R11 Audit and spans

**Decision**:
- `AuditEntry` gains `tools?: { declared: number; toolMessages: number; called:
  string[] }`, absent when the request had no tools and no tool messages (old entries and
  tool-free requests are unchanged). Postgres: one nullable `jsonb` column `tools`
  (migration `0001_audit_tools`). `called` is capped at 32 names (a model can return many calls; the
  cap keeps rows bounded).
- Request span: `tamiz.tools.declared` (int), `tamiz.tools.called` (string array, same
  cap). `gen_ai.response.finish_reasons` gets `tool_calls`. The OTel GenAI opt-in content
  attributes (`gen_ai.tool.call.arguments`, `gen_ai.tool.call.result`,
  `gen_ai.tool.definitions`) are never set; the content-free telemetry test of spec 006
  gains a marker in all three places (SC-004).
- `requestHash` hashes the inspected-text list (T-R04), so the same conversation with a
  different tool result hashes differently.

## T-R12 Anonymization notice v2 **(review, D6)**

**Decision**: `prompts/anonymization-notice.v2.md` = v1 plus one sentence (English and
Spanish) asking to keep placeholders verbatim in tool-call arguments too. It is used only
when the request has tools or tool messages; tool-free requests keep `v1`, so
`x-tamiz-privacy` and the audit's `noticeVersion` do not change for existing clients.

## T-R13 Leak eval with tool messages **(review, D7)**

**Decision**:
- Dataset `pii-leak-es` v2: the generator adds ≥ 40 tool cases (tool results with DNI, NIE,
  NSS, IBAN, card; arguments with names, emails, phones; both), tags `tool-result`,
  `tool-arguments`. v1 cases are kept as they are.
- Each value is annotated with a location (T-R04) instead of only `messageIndex`; v1 values
  are `content` locations.
- `observeSimulation` checks what the provider would receive: contents, arguments and tool
  results of `providerMessages` (or the request's own when not anonymized).
- New metric `values.tool_messages` (count) with threshold `gte 40` (FR-024). Per-kind
  thresholds are unchanged and cover tool values (FR-023).

**Alternative**: a separate eval id `leak-tools` (a new `EvalId`, a new dashboard column and
the same scorer; no benefit).

## T-R14 The agent's native protocol **(review, D8)**

**Decision**: `TAMIZ_AGENT_TOOL_PROTOCOL=native|text`, default `native`. Native mode passes
the MCP tools to `generateText` as tools without `execute` (input schema via `jsonSchema`
from the MCP tool list), reads `toolCalls`, runs each through the MCP client in order, and
appends the SDK's response messages plus one `tool` message per call. The step limit,
truncation (8 000 characters per result) and the run record are spec 009's; the prompt is
`system.v2.md` (no tool list in the text: the tools travel natively). Text mode is spec 009
R-10, unchanged.

**Risk**: `llama3.1:8b` through Ollama follows native tools; if T-009-06 shows it does not,
the demo runs with `TAMIZ_AGENT_TOOL_PROTOCOL=text` and the record says so.

## T-R15 What stays out

`parallel_tool_calls`, `response_format`, built-in and custom tools, multimodal tool
results, tool approval and server-side tool execution. All stay rejected by the strict
contract (FR-005 regression holds).
