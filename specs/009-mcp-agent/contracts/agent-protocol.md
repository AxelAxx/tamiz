# Contract: the agent's tool protocol

**Feature**: `009-mcp-agent` (FR-013 … FR-018, research R-09 … R-11). Types:
`data-model.md` section 4.

## Model calls

Every model call is a gateway chat completion:

```http
POST <TAMIZ_AGENT_GATEWAY_URL>/v1/chat/completions
Authorization: Bearer <TAMIZ_AGENT_API_KEY>

{ "model": "tamiz-local", "messages": [ … ], "temperature": 0 }
```

The body must validate against `ChatCompletionRequestSchema` (US5-2). The response's
`x-request-id` is kept for the run record. With the default policy, `tamiz-local` matches
the `pinned-local` rule (route `[ollama-llama]`, residency `local`).

A non-2xx answer stops the run: `stopReason: "gateway_error"`, with the error envelope's
`type` and the request id.

## Messages

1. `system`: `prompts/system.v1.md`, with `{{today}}` (UTC date) and `{{tools}}`. Each
   tool is rendered as:

   ```text
   - <name>: <description>
     input JSON Schema: <compact JSON Schema from the MCP tool list>
   ```
2. `user`: the question.
3. Then, per step: the model's `assistant` message, verbatim, and a `user` observation:
   - `Observation (<tool>): <compact JSON of the structured result>`;
   - `Observation (<tool>) error: <compact JSON of the tool error or the invalid-input message>`;
   - `Observation error: unknown tool "<name>"; available: <names>`;
   - `Observation error: answer with exactly one JSON object, {"tool": …, "arguments": …} or {"answer": …}`.

   Observations longer than 8 000 characters are cut and end with
   `… (truncated, N characters omitted)`.

## The model's answer

Exactly one JSON object, optionally in a code fence:

```json
{ "tool": "get_cost_report", "arguments": { "from": "2026-10-29T00:00:00Z", "to": "2026-10-31T00:00:00Z", "groupBy": "day" } }
```

```json
{ "answer": "Spend rose from $0.42 on 2026-10-29 to $0.87 on 2026-10-30. Almost all of the increase is route code-to-frontier (anthropic-sonnet): $0.31 → $0.74." }
```

## Limits

- 6 model calls per run; at the limit, `stopReason: "step_limit"` and the answer
  "I could not answer within 6 steps" with the steps taken.
- One tool call per model answer.
- `temperature: 0`, `maxRetries: 0` (the gateway retries and falls back).

## Run record (printed by the demo)

```json
{
  "question": "why did spend rise yesterday?",
  "promptVersion": "system.v1",
  "model": "tamiz-local",
  "today": "2026-10-31",
  "steps": [
    { "kind": "tool", "tool": "get_cost_report", "arguments": { "from": "2026-10-29T00:00:00Z", "to": "2026-10-31T00:00:00Z", "groupBy": "day" }, "requestId": "req-1", "ok": true },
    { "kind": "tool", "tool": "get_cost_report", "arguments": { "from": "2026-10-30T00:00:00Z", "to": "2026-10-31T00:00:00Z", "groupBy": "route" }, "requestId": "req-2", "ok": true },
    { "kind": "tool", "tool": "get_cost_report", "arguments": { "from": "2026-10-29T00:00:00Z", "to": "2026-10-30T00:00:00Z", "groupBy": "route" }, "requestId": "req-3", "ok": true },
    { "kind": "answer", "requestId": "req-4" }
  ],
  "requestIds": ["req-1", "req-2", "req-3", "req-4"],
  "stopReason": "answered",
  "answer": "Spend rose from $0.42 on 2026-10-29 to $0.87 on 2026-10-30. …"
}
```

A `groupBy: "route"` report sums its whole range per route, so the prompt asks for one
route report per day (`from`/`to` spanning a single UTC day) after the daily totals, as in
the US5-1 test. Four model calls stay within the limit of 6.
