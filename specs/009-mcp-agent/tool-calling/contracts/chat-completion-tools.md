# Contract: tool calling in `POST /v1/chat/completions`

**Addendum**: `specs/009-mcp-agent/tool-calling/` (FR-001 … FR-005). Source of truth after
implementation: `packages/contracts/src/chat-completion.ts`. Every object stays strict.

## Request additions

```jsonc
{
  "model": "tamiz-auto",
  "messages": [
    { "role": "user", "content": "¿Cuándo es la próxima cita del paciente 4411?" },
    { "role": "assistant", "content": null,
      "tool_calls": [ { "id": "call_a1", "type": "function",
        "function": { "name": "get_patient", "arguments": "{\"patientId\":\"4411\"}" } } ] },
    { "role": "tool", "tool_call_id": "call_a1",
      "content": "{\"name\":\"Ana Ruiz Gil\",\"dni\":\"12345678Z\",\"next\":\"2026-11-04\"}" }
  ],
  "tools": [
    { "type": "function",
      "function": { "name": "get_patient", "description": "Look up a patient by id",
        "parameters": { "type": "object", "properties": { "patientId": { "type": "string" } },
                        "required": ["patientId"] } } }
  ],
  "tool_choice": "auto"
}
```

| Field | Rule |
|---|---|
| `tools` | 1-128 entries; `type: "function"`; `function.name` `^[a-zA-Z0-9_-]{1,64}$`, unique; `description` string ≤ 1 024; `parameters` a JSON object; `strict` boolean |
| `tool_choice` | `"none" \| "auto" \| "required" \| {type: "function", function: {name}}`; requires `tools`; a named function must be declared |
| assistant message | `content: string \| null` (optional when `tool_calls` present); `tool_calls`: 1-128 of `{id (1-128 chars), type: "function", function: {name, arguments}}`; `arguments` parses to a JSON object; content or calls required |
| tool message | `{role: "tool", tool_call_id, content: string}`; `tool_call_id` matches a call in an earlier assistant message |
| still rejected | `parallel_tool_calls`, `response_format`, `functions`, `function_call`, non-function tool types, array `content` |

Cross-field rules are a `superRefine` on the request; each failure is a 400
`invalid_request_error` whose message names the field path, never its value.

## Response additions

```json
{
  "choices": [ {
    "index": 0,
    "message": { "role": "assistant", "content": null,
      "tool_calls": [ { "id": "call_b7", "type": "function",
        "function": { "name": "send_reminder", "arguments": "{\"name\":\"Ana Ruiz Gil\"}" } } ] },
    "finish_reason": "tool_calls"
  } ]
}
```

`finish_reason` enum: `stop | length | content_filter | tool_calls`. `content` is a string
when the model wrote text, `null` when it wrote only calls.

## Stream additions

```text
data: {"choices":[{"index":0,"delta":{"role":"assistant","tool_calls":[{"index":0,"id":"call_b7","type":"function","function":{"name":"send_reminder","arguments":""}}]},"finish_reason":null}], …}
data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\"name\":\"Ana "}}]},"finish_reason":null}], …}
data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"Ruiz Gil\"}"}}]},"finish_reason":null}], …}
data: {"choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}], …}
data: {"choices":[], "usage":{…}, …}
data: [DONE]
```

The chunk delta's `tool_calls` items: `index` (required), `id`, `type`, `function.name`
(first piece of a call only), `function.arguments` (string piece). Restored text in the
pieces never contains a placeholder or a part of one (FR-013).

## Headers

Unchanged. `x-tamiz-privacy: anonymize` with notice `v2` when tools are present (FR-014);
`x-tamiz-privacy: restrict_to_local` also when anonymization was not safe (FR-011).

## `POST /v1/simulate`

Takes the same body. Each entity gains `location`:

```json
{ "messageIndex": 2, "location": { "kind": "content", "messageIndex": 2 }, "kind": "DNI", "start": 34, "end": 43, "score": 0.99 }
{ "messageIndex": 1, "location": { "kind": "arguments", "messageIndex": 1, "toolCallIndex": 0 }, "kind": "PERSON", "start": 9, "end": 21, "score": 0.85 }
{ "location": { "kind": "tool_definition", "toolIndex": 0 }, … }
```

`messageIndex` is kept for `content` and `arguments` locations (compatibility with spec 005
clients) and absent for tool definitions; `start`/`end` are offsets into the located text.
`providerMessages` uses the message union above; `notAnonymizable` is set when FR-011
applied.
