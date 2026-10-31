# Data Model: Native Tool Calling Through the Gateway

**Addendum**: `specs/009-mcp-agent/tool-calling/` | **Date**: 2026-10-31

Wire shapes are in `contracts/chat-completion-tools.md`; this file is the domain, port and
storage view.

## 1. Domain (`apps/gateway/src/domain/model/`)

### 1.1 `inference-request.ts`

```ts
export interface ToolDefinition {
  readonly name: string;                 // ^[a-zA-Z0-9_-]{1,64}$, unique
  readonly description?: string;
  readonly parameters?: Readonly<Record<string, unknown>>; // JSON Schema object
  readonly strict?: boolean;
}

export type ToolChoice =
  | "auto" | "none" | "required"
  | { readonly name: string };           // a declared tool

export interface ToolCall {
  readonly id: string;
  readonly name: string;
  /** JSON text: what is inspected, anonymized, restored; parsed only by the adapter. */
  readonly arguments: string;
}

export type Message =
  | { readonly role: "system" | "user"; readonly content: string }
  | { readonly role: "assistant"; readonly content: string | null;
      readonly toolCalls: ReadonlyArray<ToolCall> }      // empty when none
  | { readonly role: "tool"; readonly toolCallId: string;
      readonly toolName: string;          // from the matching earlier call (mapper)
      readonly content: string };

export interface InferenceRequest {
  // … unchanged fields …
  readonly tools?: ReadonlyArray<ToolDefinition>;
  readonly toolChoice?: ToolChoice;
}
```

Invariants (validated at the edge, relied on in the domain): every `tool` message answers
an earlier call; an assistant message has content or calls; `toolChoice` only with `tools`.

### 1.2 `inspected-text.ts` (new)

```ts
export type TextLocation =
  | { readonly kind: "content"; readonly messageIndex: number }
  | { readonly kind: "arguments"; readonly messageIndex: number; readonly toolCallIndex: number }
  | { readonly kind: "tool_definition"; readonly toolIndex: number };

export interface InspectedText { readonly location: TextLocation; readonly text: string }

/** Every text the provider will read, in a fixed order (research T-R04). */
export function inspectedTexts(request: Pick<InferenceRequest, "messages" | "tools">):
  ReadonlyArray<InspectedText>;
```

Order: messages in order; within a message, content (if non-null) then each call's
arguments; then tool definitions. For a request without tools the list equals today's
message contents, so detection, cache keys (apart from the version bump) and offsets for
tool-free requests are unchanged.

`DetectedEntity.messageIndex` is renamed `textIndex` (an index into this list). The
`PiiDetectorPort` signature is unchanged: it already takes a list of strings.

### 1.3 `json-spans.ts` (new)

```ts
export type SpanPlacement =
  | { readonly kind: "in_string" }        // replace in place
  | { readonly kind: "whole_number" }     // replace by a quoted placeholder
  | { readonly kind: "unsafe" };          // crosses structure

export function placeJsonSpan(json: string, start: number, end: number): SpanPlacement;
```

A small tokenizer over JSON text (strings with escapes, numbers, literals, punctuation).
Pure, property-tested: for any valid JSON object and any `in_string`/`whole_number` span,
the replaced text parses with the same shape.

### 1.4 `placeholders.ts`, `restore-stream.ts`

- `anonymizeTexts(texts, entities, placement)` generalizes `anonymizeMessages`: the same
  numbering, one mapping across all texts; for argument texts, `whole_number` replacements
  are quoted. Returns `{ texts, mapping, unsafe: "json_structure" | "tool_definition" |
  undefined }`.
- `restoreJson(text, mapping)`: restore with JSON-escaped values.
- `createStreamRestorer(mapping, escape = identity)`.

### 1.5 `routing-decision.ts`

`ClassifiedRequest` gains `anonymizable: true | { reason: "json_structure" |
"tool_definition" }`, computed from the inspection and the request before `decide`. In
`decide`: when the level's action is `anonymize` and the request is not anonymizable, the
action becomes `restrict_to_local` with the policy's `localRoute` (no target → block
`no_target`, as in spec 005), and the decision carries `downgradedFrom: "anonymize"` and the
reason, for the event and the simulator.

### 1.6 `audit-entry.ts`

```ts
export interface AuditTools {
  readonly declared: number;
  readonly toolMessages: number;
  readonly called: ReadonlyArray<string>;   // names, in order, at most 32
}
// AuditEntry: readonly tools?: AuditTools   — absent without tools and tool messages
```

`FINISH_REASONS` (port) and the contract enum gain `"tool_calls"`.

## 2. Port (`application/ports/llm-provider.port.ts`)

```ts
export interface ProviderCompletionInput {
  // … unchanged …
  readonly messages: ReadonlyArray<Message>;       // the union above
  readonly tools?: ReadonlyArray<ToolDefinition>;
  readonly toolChoice?: ToolChoice;
}

export interface ProviderCompletion {
  readonly text: string;                             // "" when the answer is only calls
  readonly toolCalls?: ReadonlyArray<ToolCall>;      // absent or empty when none
  // … finishReason (now may be "tool_calls"), usage, modelName …
}

export type ContentPart =
  | { readonly type: "delta"; readonly text: string }
  | { readonly type: "tool-call-start"; readonly index: number; readonly id: string;
      readonly name: string }
  | { readonly type: "tool-call-delta"; readonly index: number; readonly arguments: string };

export type StreamPart = ContentPart | /* finish */ … | /* error */ …;

export interface StartedStream {
  readonly first: string;   // "" when the stream starts with a tool call: rest begins with its start
  readonly modelName: string;
  readonly rest: AsyncIterable<StreamPart>;
}
```

## 3. Use cases

- `protectMessages` → `protectRequest(decision, inspection, request, notices)`: returns the
  provider messages and tools (definitions unchanged), `restore` for text, `restoreArguments`
  (JSON-escaped), `streamRestorer()` and `argumentsRestorer()` factories, `placeholders`,
  `noticeVersion` (`v2` when the request has tools or tool messages).
- `routeInference` and `streamInference` pass `tools`/`toolChoice` to each attempt and
  restore text and every call's arguments; the routed stream keeps one restorer per call
  index (research T-R07).
- `simulatePolicy` reports entity locations and, for `anonymize`, the provider messages with
  anonymized arguments and tool results.
- `withAudit` / `withTracing` fill `tools` and the span attributes from the request and the
  completion (called names from `toolCalls` or from streamed `tool-call-start` parts).

## 4. Storage

Migration `apps/gateway/drizzle/0001_audit_tools`: `ALTER TABLE audit_entries ADD COLUMN tools jsonb`
(nullable). The repository maps `null` ↔ absent.

## 5. Contracts (`packages/contracts`)

- `chat-completion.ts`: request, message union, response message, chunk delta, finish reason
  (contract file: `contracts/chat-completion-tools.md`).
- `simulate.ts`: `SimulatedEntity` gains `location` (the `TextLocation` shape; `messageIndex`
  stays for content locations, for compatibility); `providerMessages` uses the new message
  union; the response gains `notAnonymizable?: "json_structure" | "tool_definition"`.
- `audit.ts`: `tools` as above (optional); the MCP `query_audit_log` output follows.
- `evals.ts`/`packages/evals/src/datasets.ts`: `LeakCase` messages use the message union;
  values gain an optional `location` (default `content` at `messageIndex`).

## 6. Agent (`apps/mcp-server/src/agent/`)

`AgentConfig.toolProtocol: "native" | "text"` (default `native`); the run record gains
`protocol` and, per tool step, the call id. Data model of spec 009 section 4 otherwise
unchanged.
