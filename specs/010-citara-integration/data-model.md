# Data Model: Citara Integration

The feature adds no persisted data and no wire contract. Its entities live in the example
client (`examples/citara-client/`) and in the E2E harness's test controls. Gateway entities
it reads (chat completion, error envelope, audit entry, audit page) are defined in
`packages/contracts` and are not repeated here.

## 1. Example configuration (`ExampleConfig`)

Read once from the environment at start and validated with Zod; an invalid value exits
with status `2` and names the variable, never its value (constitution VI).

| Variable | Type / default | Meaning |
|---|---|---|
| `TAMIZ_BASE_URL` | URL, required | Gateway base URL including `/v1` (for example `http://localhost:3000/v1`) |
| `TAMIZ_API_KEY` | string ≥ 1, required | Client key issued for Citara |
| `TAMIZ_MODEL` | string, `tamiz-auto` | Model alias sent in the request |
| `TAMIZ_PROMPT` | string ≥ 1, required | The user message (CLI argument overrides it) |
| `TAMIZ_STREAM` | `true` \| `false`, `false` | Send `stream: true` |
| `TAMIZ_REQUEST_ID` | `[A-Za-z0-9_-]{1,128}`, optional | Correlation id sent as `x-request-id` |
| `TAMIZ_TIMEOUT_MS` | int 1 000 … 600 000, `70000` | Client timeout (R-03) |
| `TAMIZ_ADMIN_KEY` | string, optional | Admin key; enables the audit check when set |
| `TAMIZ_AUDIT_WAIT_MS` | int 0 … 60 000, `5000` | How long the audit check polls (R-07) |

The guide's configuration table lists exactly these keys (US4-3).

## 2. Outcome classification (`ErrorClass`)

Derived from the gateway's error type (the body's `error.type`; the HTTP status when the
body is not an error envelope):

| Error type | Status | Class | Example behaviour |
|---|---|---|---|
| `invalid_request` | 400 | `fix_request` | no retry, exit 1 |
| `unauthorized` | 401 | `fix_request` | no retry, exit 1 |
| `forbidden` | 403 | `fix_request` | no retry, exit 1 (audit check with a client key) |
| `policy_blocked` | 451 | `never` | no retry, exit 1 |
| `provider_error` | 502 | `never` (Tamiz already fell back) | no retry, exit 1 |
| `provider_timeout` | 504 | `never` (deadline reached) | no retry, exit 1 |
| `internal` | 500 | `never` | no retry, exit 1 |
| `provider_unavailable` | 503 | `later` | one retry after `retry-after`, then exit 1 |
| `privacy_unavailable` | 503 | `later` | one retry after `retry-after`, then exit 1 |
| `rate_limited` | 429 | `later` | one retry after `retry-after`, then exit 1 |
| network error / client timeout | — | `later` | no retry (the request may be in flight), exit 1 |

`retry-after` is read in seconds; absent → 1 s; capped at 30 s. In the guide's error
table, `fix_request` reads "after fixing the request", `never` reads "never" and `later`
reads "later" (US4-2).

## 3. Run report (`RunReport`)

What the example prints, one `key: value` line per field (machine-checkable in tests),
then the answer text after a blank line.

| Field | Source | Present |
|---|---|---|
| `status` | HTTP status | always |
| `request_id` | `x-request-id` received (never the one sent) | always when the gateway answered |
| `route`, `rule`, `fallback`, `sensitivity`, `privacy` | `x-tamiz-*` headers, verbatim | when sent |
| `retry_after` | `retry-after` header | when sent |
| `error_type`, `retryable` | error envelope, `ErrorClass` | on errors |
| `attempts` | number of HTTP requests sent | always |
| `model`, `finish_reason`, `usage` | completion body (usage chunk when streamed) | on success |
| `audit` | the audit entry as one JSON line | audit check found it |
| `audit_error` | `not_found` \| `forbidden` \| `unauthorized` | audit check failed |

Never printed: either key, the `authorization` header, the prompt.

## 4. Exit codes

| Code | Meaning |
|---|---|
| `0` | Answered, and (if enabled) the audit entry was found |
| `1` | Gateway error, network error, or audit check failed |
| `2` | Invalid configuration |

## 5. Audit check state

`startedAt` (taken before the first attempt) → poll loop (`now() < startedAt + wait`):
query `from = startedAt − 5 s`, `limit = 200`, follow `nextCursor` ≤ 5 pages, match
`entry.requestId === request_id` → `found` | `not_found` (deadline) | `forbidden` (403) |
`unauthorized` (401). A 401/403 ends the loop at once.

## 6. Harness scripted providers (test tooling, `apps/gateway/scripts/e2e-gateway.ts`)

| Item | Shape |
|---|---|
| `TAMIZ_E2E_PROVIDERS` | `none` (default, today's throwing providers) \| `scripted` |
| Scripted answer | `echo: <content of the last user message as received>`; streamed as two deltas plus usage |
| `GET /__e2e/provider-calls` | `{ calls: [{ targetId, messages: [{ role, content }] }] }`, in call order |
| `POST /__e2e/provider-script` | `{ targetId, fail: "http_error" \| "timeout" }`: that target fails every call until reset |
| `POST /__e2e/reset` | also clears provider calls and scripts |
| `TAMIZ_E2E_CITARA_KEY` | a client key of client `citara` (fixture default, like the existing `demo` key), always registered |

Messages recorded by the harness are synthetic fixture markers only; the harness is never
part of an image.
