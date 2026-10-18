# HTTP contract: `POST /v1/chat/completions` (non-streaming)

Review projection of the endpoint delivered by `T-002-06`. Schemas: `@tamiz/contracts`
(`ChatCompletionRequestSchema`, `ChatCompletionResponseSchema`, `ErrorEnvelopeSchema`).
The generated OpenAPI document at `GET /openapi.json` is the shipped description.

## Request

```http
POST /v1/chat/completions
Authorization: Bearer tmz_<43 base64url chars>
Content-Type: application/json
x-request-id: <optional, RequestId charset>

{ "model": "tamiz-auto", "messages": [{ "role": "user", "content": "Resume este informe en tres frases: ..." }],
  "temperature": 0.2, "max_tokens": 300 }
```

Body rules: feature 001 `ChatCompletionRequestSchema` (unchanged). Body size ≤ 1 MiB.
`model` is a hint evaluated by rule conditions (`when.requestedModel`); unknown values
fall through to the default chain.

## Success response

```http
HTTP/1.1 200 OK
content-type: application/json
x-request-id: 7f3c…
x-tamiz-route: mistral-small
x-tamiz-rule: long-documents-eu

{ "id": "chatcmpl-7f3c…", "object": "chat.completion", "created": 1792000000,
  "model": "mistral-small-latest",
  "choices": [{ "index": 0, "message": { "role": "assistant", "content": "…" }, "finish_reason": "stop" }],
  "usage": { "prompt_tokens": 1180, "completion_tokens": 96, "total_tokens": 1276,
             "cost_usd": 0.0001468, "estimated": false } }
```

`usage.cost_usd` and `usage.estimated` are the only additions to the 001 response
schema (both optional in the schema, both always set by the gateway).

## Error responses

| Situation | Status | `error.type` | `x-tamiz-route` / `x-tamiz-rule` |
|---|---|---|---|
| No / malformed `Authorization`, unknown key | 401 | `unauthorized` | absent |
| Body fails the contract, `stream: true`, body > 1 MiB | 400 | `invalid_request` | absent |
| Primary target: 429, 5xx, 4xx, network, malformed body | 502 | `provider_error` | present |
| Primary target: timeout | 504 | `provider_timeout` | present |
| Unhandled exception | 500 | `internal` | absent |
| Unknown route | 404 | `not_found` | absent |

Envelope shape: 001 `ErrorEnvelopeSchema`; `message` never contains field values,
credentials, prompt text or upstream bodies. Example 400 message:
`"messages: expected array with at least 1 element; temperature: expected number ≤ 2"`.

## OpenAPI route (what `createRoute` declares)

| Item | Value |
|---|---|
| `method` / `path` | `post` / `/v1/chat/completions` |
| `security` | `bearerAuth` (http, bearer) |
| `request.body` | `application/json` → `ChatCompletionRequestSchema` |
| `responses.200` | `ChatCompletionResponseSchema` + headers `x-tamiz-route`, `x-tamiz-rule`, `x-request-id` |
| `responses.400/401/502/504` | `ErrorEnvelopeSchema` |
| Also documented | `GET /health` (001), `GET /openapi.json` |

## API key generation (operator command)

```bash
pnpm --filter @tamiz/gateway generate-api-key acme
```

Prints once: `key: tmz_…` and `TAMIZ_API_KEYS entry: acme:<sha256 hex>`. The key is
never stored by Tamiz.
