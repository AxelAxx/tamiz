# Feature Specification: Native Tool Calling Through the Gateway (addendum to 009)

**Feature Branch**: `T-009-05-native-tool-calling-spec` (spec); implementation on
`T-009-05-native-tool-calling`

**Created**: 2026-10-31

**Status**: Approved (reviewed by Alex on 2026-10-31)

**Input**: User description: "Native OpenAI tool calling through the Tamiz gateway (backlog
T-009-05): tools, tool_choice, assistant tool_calls and tool messages in the chat contract;
provider port and AI SDK adapters pass them; privacy inspection and anonymization cover
tool arguments and tool results, restored in the answer including streamed tool-call
deltas; fallback across providers with tool calls; content-free audit and spans (tool names
allowed, arguments never); leak eval extended with tool-message cases; the MCP agent can
switch from the text protocol (spec 009 R-10) to native tools."

**Backlog**: `T-009-05` (this addendum and its implementation). See
`docs/tasks/BACKLOG.md`, section "Day 12".

**Where this lives**: an addendum folder, `specs/009-mcp-agent/tool-calling/`, not a new
feature number. The roadmap fixes features 001-010, and this work completes spec 009
(it replaces the workaround of research R-10). Spec Kit supports it through
`SPECIFY_FEATURE_DIRECTORY` (`.specify/scripts/powershell/common.ps1`), so `/speckit-plan`,
`/speckit-tasks` and `/speckit-implement` run against this folder unchanged.

**Builds on**: `002-provider-routing` (chat contract, provider port, adapters, cost),
`003-resilience` (chain execution, streaming, first-token rule), `005-privacy-aware-routing`
(inspection, privacy actions, placeholders, stream restoration, simulator),
`006-audit-and-telemetry` (audit entry, spans), `007-evals-gate` (leak eval) and
`009-mcp-agent` (the agent, R-10).

## Purpose

Today the gateway accepts only plain text conversations. An application that wants the
model to call its functions (look up an appointment, fetch an invoice) cannot use Tamiz,
and Tamiz's own agent fakes tool calling with a prompted JSON protocol. Tool calling is
also where personal data travels in a new way: a tool *result* (a patient record, a bank
statement) is often the most sensitive text in the conversation, and it was never typed by
the user. After this addendum, a client sends the standard OpenAI tool-calling fields; the
gateway inspects every byte the model will read, tool definitions, tool-call arguments and
tool results included; the policy decides as it does for text; anonymized values come back
restored inside the tool calls the model makes, also when streamed; and the agent uses
native tools.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A client uses standard tool calling through Tamiz (Priority: P1)

A developer points an OpenAI-compatible client at Tamiz and declares two functions. The
model answers with a tool call; the client runs the function and sends the result back as
a `tool` message; the model answers in text. Nothing in the client changes compared with
calling OpenAI directly.

**Why this priority**: Without the contract and the provider support, nothing else in this
addendum exists.

**Independent Test**: With fake providers, send a request with `tools`, get a tool call
back, send the follow-up with the assistant `tool_calls` and the `tool` message, and check
both responses and what each provider received.

**Acceptance Scenarios**:

1. **Given** a request with `tools` and `tool_choice: "auto"` and a provider that answers
   with a tool call, **When** it is processed, **Then** the response's message has
   `content: null`, one `tool_calls` entry with the provider's id, `type: "function"`, the
   function name and its arguments as a JSON string, and `finish_reason: "tool_calls"`.
2. **Given** a follow-up request whose history has the assistant's `tool_calls` and a
   matching `tool` message, **When** it is processed, **Then** the provider receives the
   tool call and the tool result linked by the same id and name, and the text answer comes
   back as in feature 002.
3. **Given** `tool_choice` set to `"none"`, `"required"` or a named function, **When** the
   request is processed, **Then** the provider receives the same choice.
4. **Given** a request without any tool field, **When** it is processed, **Then** the
   request, the response and the headers are byte-for-byte what they were before this
   addendum (regression).
5. **Given** each of the four providers (local, EU, two frontier), **When** an adapter test
   sends tool definitions, a tool-call history and a tool result, **Then** the upstream body
   has the provider's own tool format and the answer's tool calls come back normalized.

---

### User Story 2 - Personal data in a tool result is routed like any other personal data (Priority: P1)

A clinic's application lets the model call `get_patient`. The user's question has no
personal data, but the tool result contains a DNI. The gateway inspects the tool result,
finds critical data, and the follow-up request is answered by the local model only.

**Why this priority**: It is the backlog's acceptance criterion and the reason this
addendum touches privacy at all (constitution V).

**Independent Test**: With the scripted fake detector, send a follow-up whose only personal
data is a DNI in a `tool` message and check the decision and the target called.

**Acceptance Scenarios**:

1. **Given** the default policy and a request whose only personal data is a valid DNI in a
   `tool` message, **When** it is processed, **Then** only a local target is called and the
   response carries `x-tamiz-sensitivity: critical` and `x-tamiz-privacy: restrict_to_local`.
2. **Given** a request whose only personal data is a name in a tool-call's arguments,
   **When** it is processed with the default policy, **Then** the action is `anonymize`,
   exactly as if the name were in a user message.
3. **Given** personal data in a tool definition (a description or a schema enum), **When**
   the request is inspected, **Then** it counts towards the request's level like any other
   text (FR-007).
4. **Given** the detector is unreachable, **When** a tool-calling request is processed,
   **Then** the policy's `onDetectorError` applies, as in spec 005.

---

### User Story 3 - Anonymized values come back restored inside tool calls (Priority: P1)

A request at level `high` is anonymized: the provider sees `<PERSON_1>` in a tool result.
The model calls `send_reminder` with `{"name": "<PERSON_1>"}`. The client receives the call
with the real name, so the function it runs gets real data, while the provider never saw
it.

**Why this priority**: Without restoration, anonymization would break every tool the client
runs; without anonymization of tool messages, names would leave the EU unprotected.

**Independent Test**: With a fake detector that marks a name in a tool result and a fake
provider that echoes a placeholder in a tool call's arguments, check what the provider got
and what the client got.

**Acceptance Scenarios**:

1. **Given** an `anonymize` decision and a name in a `tool` message, **When** the request is
   sent, **Then** the provider receives the placeholder in that tool result, and no
   annotated value appears verbatim in anything the provider receives.
2. **Given** the same request and a provider answer whose tool-call arguments contain
   `<PERSON_1>`, **When** the response is built, **Then** the client's arguments contain the
   original value, are still valid JSON, and parse to the same structure with the value in
   place of the placeholder.
3. **Given** a value that needs escaping in JSON (a quote or a backslash), **When** it is
   restored inside arguments, **Then** it is escaped, and the arguments still parse.
4. **Given** a name inside the JSON string of a client-sent tool-call's arguments, **When**
   it is anonymized, **Then** the arguments the provider receives still parse as JSON.
5. **Given** a personal value written as a JSON number in arguments (a phone as
   `612345678`), **When** it is anonymized, **Then** it becomes the placeholder as a JSON
   string, and the arguments still parse.
6. **Given** a detected value that cannot be replaced without breaking the structure (its
   span crosses a JSON string boundary, or it sits in a tool definition), **When** the
   action is `anonymize`, **Then** the request fails closed to the policy's local route
   (`restrict_to_local`) with a routing event saying why, never sent unprotected (FR-011).

---

### User Story 4 - Streamed tool calls are restored and stream like OpenAI's (Priority: P2)

A client streams a tool-calling request. It receives the tool call's id and name in the
first chunk for that call and the arguments in pieces, as OpenAI sends them. When the
request was anonymized, a placeholder split across pieces is held and restored once.

**Why this priority**: Streaming clients (chat UIs, agents) are the majority; a split
placeholder must never reach the client.

**Independent Test**: A fake streaming provider emits a tool call whose arguments contain a
placeholder split across three deltas; the client's chunks are checked for order, format
and restoration.

**Acceptance Scenarios**:

1. **Given** a streamed request and a provider that starts a tool call, **When** the stream
   is relayed, **Then** the first chunk for that call has `index`, `id`, `type: "function"`,
   `function.name` and `function.arguments: ""`, and later chunks carry only `index` and
   `function.arguments` pieces, and the stream ends with `finish_reason: "tool_calls"`, the
   usage chunk and `[DONE]`.
2. **Given** an anonymized stream whose arguments split `<PERSON_1>` across deltas, **When**
   it is relayed, **Then** no chunk contains a placeholder or a part of one, the
   concatenated arguments equal the restored arguments of the non-streamed answer, and
   text deltas are not delayed by it.
3. **Given** two tool calls in one answer, **When** they are streamed, **Then** each keeps
   its own `index` and its own restoration state.
4. **Given** a stream whose first output is a tool call (no text), **When** the provider
   fails before that tool call starts, **Then** the fallback rules of spec 003 apply; once
   it has started, a failure ends the stream with the error event and no fallback.

---

### User Story 5 - Fallback keeps the tools and the privacy guarantees (Priority: P2)

The first target of a chain times out on a tool-calling request. The next target gets the
same tools, the same tool choice and the same (possibly anonymized) history, and its
answer is restored with the same mapping.

**Why this priority**: Fallbacks are where guarantees usually get lost (constitution VI).

**Independent Test**: A two-target chain with the first fake provider failing; check what
the second received and the `x-tamiz-fallback` header.

**Acceptance Scenarios**:

1. **Given** a chain of two targets and a first target that times out, **When** a
   tool-calling request is processed, **Then** the second target receives the same tool
   definitions, choice and messages as the first, and `x-tamiz-fallback` names the first.
2. **Given** a target whose provider rejects tools (an upstream 4xx), **When** the request
   is processed, **Then** the error is not retried on that target and the chain moves on
   as for any non-retryable provider error.
3. **Given** a tool-call id written by one provider in the history, **When** the request is
   sent to another provider whose id format differs, **Then** the request still succeeds
   and the client sees its own ids unchanged (FR-016).
4. **Given** a tool-calling request with critical data, **When** every local target fails,
   **Then** the request fails; it never falls back to a non-local target (spec 003 residency
   guard, unchanged).

---

### User Story 6 - Audit and traces say which tools were used, never with what (Priority: P2)

An operator opens the audit log and sees that a request declared three tools and that the
model called `get_patient`. Neither the log, the traces nor the database contain the
arguments, the results or the descriptions.

**Why this priority**: Constitution V; the dashboard and the MCP `query_audit_log` tool
read these entries.

**Independent Test**: Run a tool-calling request with a recognizable marker in arguments,
results and descriptions through the in-process app with the in-memory audit log, the test
tracer and the captured log; search all three for the marker.

**Acceptance Scenarios**:

1. **Given** an answered tool-calling request, **When** its audit entry is written, **Then**
   it records how many tools were declared, how many tool messages the request had, and
   the names of the tools the model called, in order, and nothing else about tools.
2. **Given** the same request, **When** its spans are exported, **Then** the request span
   has the declared-tool count and the called tool names, `finish_reasons` includes
   `tool_calls`, and no attribute or event holds arguments, results, descriptions or
   schemas.
3. **Given** a marker string in arguments, results and descriptions, **When** the request
   completes, **Then** the marker appears in no log line, span, event or audit row.
4. **Given** a tool name that does not match the contract's name pattern, **When** the
   request arrives, **Then** it is rejected by validation, so a name in the audit is always
   a short identifier.

---

### User Story 7 - The leak eval covers tool messages (Priority: P1)

CI's leak eval now includes cases where the personal data is only in a tool result, only
in a tool call's arguments, or in both, and fails if any critical value would reach a
non-local target.

**Why this priority**: Evals are the executable spec (constitution IV); a privacy path
without an eval is not done.

**Independent Test**: Run the leak eval against the gateway with the extended dataset; the
report lists the tool cases separately.

**Acceptance Scenarios**:

1. **Given** the extended synthetic dataset, **When** the leak eval runs, **Then** every
   critical value in tool messages has leak rate 0 and every name, email or phone below 2 %,
   the same bounds as for text.
2. **Given** a dataset where the tool cases were removed, **When** the eval runs, **Then** it
   fails because the gate on the number of tool-message values is not met (FR-024).
3. **Given** a regression where tool messages are not inspected, **When** the eval runs,
   **Then** it fails on the DNI cases in tool results.

---

### User Story 8 - The agent uses native tools (Priority: P3)

Tamiz's dogfooding agent declares the four MCP tools natively, the model calls them with
`tool_calls`, and the results go back as `tool` messages. The text protocol stays available
for models without tool support.

**Why this priority**: It is the backlog's last acceptance item and removes the R-10
workaround, but the agent works today.

**Independent Test**: The agent's scripted tests with the fake gateway, run in native mode:
the gateway receives `tools` and `tool` messages that validate against the contract, and
the run record is the same shape as in spec 009.

**Acceptance Scenarios**:

1. **Given** native mode and a scripted model that calls `get_cost_report` and then answers,
   **When** the agent runs, **Then** every request validates against the chat contract,
   carries the four tools and the tool result as a `tool` message, and the run record lists
   the tool step and the answer.
2. **Given** the model answers with two tool calls at once, **When** the agent runs, **Then**
   it runs both, in order, and sends both results before the next model call; the step
   limit counts model calls, as in spec 009.
3. **Given** the protocol setting is `text`, **When** the agent runs, **Then** it behaves
   exactly as in spec 009 (R-10).

---

### Edge Cases

- **A `tool` message whose `tool_call_id` matches no earlier assistant tool call**:
  rejected with a 400 `invalid_request_error` (the provider needs the tool name, which only
  the call has).
- **Duplicate tool names in `tools`**, or a `tool_choice` naming an undeclared function, or
  `tool_choice` without `tools`: 400.
- **Client-sent arguments that are not a JSON object**: 400. OpenAI forwards any string, but
  every provider here needs the parsed input, and inspecting a structure the gateway cannot
  parse would make FR-010 untestable. *(Decision D4, flagged for Alex.)*
- **The model returns arguments that are not valid JSON**: they are passed to the client as
  the model wrote them (after restoration), as OpenAI does; the client validates its own
  inputs.
- **An assistant message with both text and tool calls**: allowed; both are inspected and
  both are restored.
- **An assistant message with neither**: 400.
- **`tool_choice: "required"` on a provider that cannot honour it**: the provider's error is a
  non-retryable provider error (fallback as US5-2).
- **A tool result that is very long**: inspected like any message; its length counts
  towards the request's size class (FR-008).
- **The detection cache**: keyed by every inspected text, so a different tool result never
  reuses another's inspection.
- **Anonymization with the placeholder pattern already present in a tool result**: numbered
  after the highest existing one, as in spec 005.
- **A provider that returns a tool call for an undeclared function**: passed through; the
  gateway does not police tool names in answers.
- **`parallel_tool_calls` or other OpenAI fields outside the subset** (`strict` on a tool,
  `response_format`): `strict` is accepted (FR-001), the rest stay rejected as in feature
  002.

## Requirements *(mandatory)*

### Functional Requirements

**Contract**

- **FR-001**: The chat completion request MUST accept `tools`: 1 to 128 entries, each
  `{type: "function", function: {name, description?, parameters?, strict?}}`, with `name`
  matching `^[a-zA-Z0-9_-]{1,64}$`, unique within the request, and `parameters` a JSON
  Schema object.
- **FR-002**: The request MUST accept `tool_choice`: `"none"`, `"auto"`, `"required"` or
  `{type: "function", function: {name}}` naming a declared tool; it is invalid without
  `tools`.
- **FR-003**: Messages MUST accept, besides `system` and `user` with string content: an
  `assistant` message with `content` (string or null) and optional `tool_calls`
  (`{id, type: "function", function: {name, arguments}}`, `arguments` a string that parses
  to a JSON object), at least one of the two present; and a `tool` message
  `{role: "tool", tool_call_id, content}` whose id matches a tool call of an earlier
  assistant message.
- **FR-004**: The response MUST be able to carry an assistant message with `content: null`
  and `tool_calls`, and `finish_reason: "tool_calls"`. The stream chunk's delta MUST be able
  to carry `tool_calls` pieces in OpenAI's shape (`index`; `id`, `type` and
  `function.name` only in a call's first piece; `function.arguments` pieces).
- **FR-005**: A request without any tool field MUST validate, route and answer exactly as
  before (US1-4). The OpenAPI document MUST describe the new fields.

**Providers**

- **FR-006**: The provider port MUST carry tool definitions, the tool choice, assistant
  tool calls and tool results to every adapter, and bring back tool calls in completions
  and in streams (call start, argument pieces). The four adapters (Ollama, Mistral,
  Anthropic, OpenAI) MUST pass them through the AI SDK without executing any tool.

**Privacy**

- **FR-007**: Inspection MUST cover every text the provider will read: message contents,
  each tool call's arguments, each tool result, and each tool definition (description and
  parameter schema). Tool names and tool-call ids are identifiers chosen by the client or
  the provider and are not inspected.
- **FR-008**: The request's sensitivity is the highest level found across all inspected
  texts; the privacy action follows from it exactly as in spec 005. Personal data found
  only in a tool result MUST lead to the same action as the same data in a user message
  (US2-1). Task classification and size see all inspected texts.
- **FR-009**: For `anonymize`, values MUST be replaced by placeholders in message contents,
  tool-call arguments and tool results, with one mapping for the whole request (the same
  value gets the same placeholder wherever it appears).
- **FR-010**: Anonymized arguments MUST still parse as JSON with the same structure: a value
  inside a JSON string is replaced in place; a value that is a whole JSON number becomes
  the placeholder as a JSON string.
- **FR-011**: When the action is `anonymize` and some detected value cannot be replaced
  safely (it crosses JSON structure in arguments, or lies in a tool definition), the
  request MUST be handled as `restrict_to_local` (the policy's local route), with a routing
  event `privacy.not_anonymizable` carrying the request id and the reason only. If there is
  no local route, the request is blocked as in spec 005 (`no_target`).
- **FR-012**: The answer's text and every tool call's arguments MUST be restored with the
  request's mapping; a value restored inside arguments MUST be JSON-escaped.
- **FR-013**: Streamed arguments MUST be restored placeholder-safely and per tool call
  (spec 005 FR-016, FR-017): a split placeholder is held until complete; plain pieces are
  released at once; held text is flushed before the finish or the error.
- **FR-014**: When anonymizing a request that has tools or tool messages, the notice MUST
  also tell the model to keep placeholders verbatim in tool-call arguments (a new notice
  version); requests without tools keep notice `v1` unchanged.
- **FR-015**: The simulator (`POST /v1/simulate`) MUST accept tool-calling requests and
  report entities with where they were found (message content, a tool call's arguments,
  a tool result, a tool definition) and, for `anonymize`, the exact messages and arguments
  the provider would receive.

**Resilience**

- **FR-016**: Every attempt in a chain MUST receive the same tools, tool choice and
  (protected) messages. Tool-call ids MUST reach the client unchanged; an adapter whose
  provider constrains id format MAY alias ids within one call and MUST map them back.
- **FR-017**: A stream whose first output is a tool call reaches its "first token" when the
  provider starts that call; fallback rules apply before it and never after (spec 003
  FR-023, FR-024).

**Audit and telemetry**

- **FR-018**: The audit entry MUST record the number of declared tools, the number of
  `tool` messages and the names of the tools the model called, in order; never arguments,
  results, descriptions or schemas. The request hash covers every inspected text.
- **FR-019**: The request span MUST carry the declared-tool count and the called tool names;
  `gen_ai.response.finish_reasons` reports `tool_calls`. The GenAI content attributes for
  tool arguments and results MUST NOT be set.
- **FR-020**: The audit query API, its contract and the MCP `query_audit_log` tool MUST
  expose the new audit fields.

**Evals**

- **FR-021**: The PII leak dataset MUST gain synthetic cases with personal data only in tool
  results, only in tool-call arguments, and in both, across DNI, NIE, NSS, IBAN, card,
  name, email and phone, generated by the dataset generator (never by hand).
- **FR-022**: The leak eval MUST treat what the provider would receive as message contents
  plus tool-call arguments plus tool results, and annotate each value with where it is.
- **FR-023**: The existing per-kind leak thresholds (0 for critical kinds, < 2 % for names,
  emails, phones) MUST apply to tool-message values unchanged.
- **FR-024**: A new gated metric MUST count the annotated values in tool messages, with a
  minimum (≥ 40), so the tool cases cannot silently disappear (spec 007 R-02).

**Agent**

- **FR-025**: The agent MUST support a native protocol: the MCP tools declared as `tools`,
  tool calls answered with `tool` messages, several calls per answer run in order. A
  setting chooses `native` or `text`; the text protocol of spec 009 stays as it is.

### Key Entities

- **Tool definition**: name, optional description, optional parameter schema. Inspected,
  never anonymized, never stored.
- **Tool call**: id, function name, arguments (JSON text). Arguments are inspected,
  anonymized and restored.
- **Tool result** (`tool` message): the id of the call it answers and text content.
  Inspected and anonymized; never restored (the model never returns it).
- **Inspected text**: one piece of text the provider will read, with where it is (message
  and field, tool call, tool definition). The detector and the anonymizer work on these.
- **Audit tool summary**: declared count, tool message count, called names.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An unmodified OpenAI-compatible client completes a two-turn tool-calling
  exchange through Tamiz with each of the four provider adapters (adapter tests with
  recorded upstream shapes).
- **SC-002**: 0 % of critical values placed only in tool results or tool-call arguments
  reach a non-local target in the leak eval; under 2 % for names, emails and phones; at
  least 40 such values are measured.
- **SC-003**: In 100 % of anonymized test answers, streamed or not, the client's tool-call
  arguments parse as JSON and contain the original values, and no chunk contains a
  placeholder or part of one.
- **SC-004**: A marker string placed in tool arguments, results and descriptions appears
  0 times in logs, spans and audit rows of the test run.
- **SC-005**: Requests without tool fields: every existing contract, gateway and eval test
  passes unchanged.
- **SC-006**: The agent's scripted spend question is answered in native mode within the
  same 6-model-call limit as in spec 009.

## Assumptions

- **The gateway never runs tools.** It relays definitions, calls and results; the client
  (or the agent) runs them. No `execute` is ever given to the AI SDK.
- **Function tools only.** OpenAI's built-in tools, custom (grammar) tools, `parallel_tool_calls`,
  `response_format` and multimodal tool results stay out of the subset; they are rejected.
- **No per-target tool capability in the policy.** All four providers support function
  calling; a model that does not fails with a non-retryable provider error and the chain
  moves on (US5-2). A capability flag can come later if the evals show the need
  (constitution X).
- **Agent default.** The agent's protocol setting defaults to `native`; `text` remains for
  models without tool support. *(Decision D8, flagged for Alex.)*
- **The privacy service is unchanged.** It receives more texts per request; offsets are per
  text, as today.
- **Dashboard.** The audit screens are not built yet (feature 008); they will read the new
  audit fields from the contract.
