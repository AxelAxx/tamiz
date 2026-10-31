# Integration Contract (what the guide promises Citara)

This is not a new API: it is the subset of existing gateway contracts that an integrating
client relies on, collected so the guide and its documentation tests have one source. The
authoritative definitions stay in `packages/contracts` and the gateway's `/openapi.json`.

## Endpoint and authentication

- `POST {TAMIZ_BASE_URL}/chat/completions`, OpenAI chat completion request and response
  (spec 002 `contracts/http.md`; tools since `T-009-05`).
- `Authorization: Bearer <client key>`; one key per integrating client; the audit entry's
  `clientId` is the key's client name (`citara`).
- Keys are issued by an operator:
  - database: `pnpm --filter @tamiz/gateway api-key:add citara`;
  - environment: `pnpm --filter @tamiz/gateway generate-api-key citara` and the printed
    `TAMIZ_API_KEYS` entry.
- Optional `x-request-id: <[A-Za-z0-9_-]{1,128}>`; echoed when well formed, else replaced.

## Response headers (guide table `headers`)

| Header | Values | When |
|---|---|---|
| `x-request-id` | the id | always |
| `x-tamiz-route` | target id (for example `ollama-llama`) | a routing decision was made |
| `x-tamiz-rule` | rule id or `default` | a routing decision was made |
| `x-tamiz-fallback` | `targetId:reason` list, in order | a target was abandoned |
| `x-tamiz-sensitivity` | `unknown` \| `none` \| `low` \| `high` \| `critical` | the request was inspected |
| `x-tamiz-privacy` | `allow` \| `anonymize;notice=v1` \| `anonymize;notice=v2` (with tools) \| `restrict_to_local` \| `block` | the request was inspected |
| `retry-after` | seconds | 503 with every circuit open |

## Errors (guide table `errors`)

Error envelope `{ "error": { "type", "message", "requestId" } }`; types, statuses and
retry guidance as in `data-model.md` section 2, limited to what the chat operation
documents (400, 401, 451, 502, 503, 504) plus `internal` (500).

## Model aliases (guide table `models`, default policy v3)

| Model | Rule | Meaning |
|---|---|---|
| `tamiz-auto` | none pins it (`x-tamiz-rule` is a task rule or `default`) | policy decides by task type, size and privacy |
| `tamiz-local` | `pinned-local` | local model only, fallbacks never leave the machine |
| `tamiz-frontier` | `pinned-frontier` | frontier model; personal data of level `high` is blocked (451), `critical` is restricted to local |

## What Tamiz stores per request

The audit entry (`AuditEntrySchema`): ids, client, times, latency, request hash, policy and
rule, sensitivity, entity counts (never values), privacy action, notice version, outcome,
target and model, abandoned targets, usage, cost, tool counts and called tool names. Never:
prompt or answer text, tool arguments or results, the key.

## Admin audit lookup (operator, used by the example's audit check)

`GET {TAMIZ_BASE_URL}/admin/audit?from=…&limit=200[&cursor=…]` with an admin key
(spec 006 `contracts/`); no request-id filter (research R-07).
