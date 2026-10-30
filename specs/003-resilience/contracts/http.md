# HTTP contract additions: `POST /v1/chat/completions`

Extends [`specs/002-provider-routing/contracts/http.md`](../../002-provider-routing/contracts/http.md).
Everything there still holds; this page lists only what feature 003 adds.

## Response headers

| Header | When | Value |
|---|---|---|
| `x-tamiz-route` | every response with a routing decision (002) | the target that answered or, on failure, the last target tried |
| `x-tamiz-rule` | same (002) | matched rule id or `default` |
| `x-tamiz-fallback` | only when at least one target was abandoned | `targetId:reason` pairs in order, comma-separated, reason ∈ `rate_limited`, `http_error`, `timeout`, `network`, `malformed_response`, `authentication`, `circuit_open` |
| `retry-after` | 503 `provider_unavailable` only | seconds until the shortest cool-down ends, rounded up |

Example after the primary timed out twice and the second target answered:

```http
HTTP/1.1 200 OK
x-tamiz-route: openai-mini
x-tamiz-rule: default
x-tamiz-fallback: mistral-small:timeout
```

## Error responses added or changed

| Situation | Status | `error.type` | `x-tamiz-route` / `x-tamiz-fallback` |
|---|---|---|---|
| Every target failed, last failure not a timeout | 502 | `provider_error` | last target / earlier ones |
| Every target failed, last failure a timeout, or request deadline exceeded | 504 | `provider_timeout` | last target tried / earlier ones |
| Every target skipped: circuits open | 503 | `provider_unavailable` (+ `retry-after`) | last target / all but the last (`circuit_open`) |
| A target outside the decision's allowed residencies was reached | 451 | `policy_blocked` | that target / earlier ones |

Envelope: 001 `ErrorEnvelopeSchema`. Example 451 message:
`"rule long-documents-eu does not allow residency us (target openai-mini)"` — policy
data only, never request content.

## Streaming (`"stream": true`)

Request: the 002 body with `"stream": true` and optionally
`"stream_options": { "include_usage": true }` (accepted; the usage chunk is always sent).

The response starts only when the answering target has produced its first token, so
the headers above are final. Before that point, every failure follows the
non-streaming rules and, if the chain is exhausted, the client gets the **JSON** error
response of the table above (no event stream).

```http
HTTP/1.1 200 OK
content-type: text/event-stream
x-request-id: 7f3c…
x-tamiz-route: mistral-small
x-tamiz-rule: default

data: {"id":"chatcmpl-7f3c…","object":"chat.completion.chunk","created":1793350800,"model":"mistral-small-latest","choices":[{"index":0,"delta":{"role":"assistant","content":"Hola"},"finish_reason":null}]}

data: {"id":"chatcmpl-7f3c…","object":"chat.completion.chunk","created":1793350800,"model":"mistral-small-latest","choices":[{"index":0,"delta":{"content":", ¿qué tal?"},"finish_reason":null}]}

data: {"id":"chatcmpl-7f3c…","object":"chat.completion.chunk","created":1793350800,"model":"mistral-small-latest","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}

data: {"id":"chatcmpl-7f3c…","object":"chat.completion.chunk","created":1793350800,"model":"mistral-small-latest","choices":[],"usage":{"prompt_tokens":9,"completion_tokens":4,"total_tokens":13,"cost_usd":0.0000021,"estimated":false}}

data: [DONE]
```

Failure after the first token (no fallback, no `[DONE]`, connection closed):

```http
data: {"id":"chatcmpl-7f3c…","object":"chat.completion.chunk", … "delta":{"content":"Hola"} …}

data: {"error":{"type":"provider_error","message":"provider stream failed","requestId":"7f3c…"}}
```

Rules: every `data:` line validates against `ChatCompletionChunkSchema` or
`StreamErrorEventSchema`; `id`, `created` and `model` are identical in every chunk; the
effective timeout bounds the first token and every gap between chunks; a client
disconnect aborts the upstream call.

## OpenAPI

The route declares `200` with both `application/json` (`ChatCompletionResponse`) and
`text/event-stream` (description referencing `ChatCompletionChunk`), and responses
`451`, `503`, `504` with `ErrorEnvelope`; `ChatCompletionChunk` is registered as a
named component.
