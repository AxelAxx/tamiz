# HTTP contract additions: privacy-aware routing

This extends [`specs/003-resilience/contracts/http.md`](../../003-resilience/contracts/http.md).
Everything there still holds. This page lists only what feature 005 adds.

## `POST /v1/chat/completions`: new response headers

| Header | When | Value |
|---|---|---|
| `x-tamiz-sensitivity` | every response, errors included, once inspection ran | `unknown`, `none`, `low`, `high` or `critical` |
| `x-tamiz-privacy` | same | `allow`, `anonymize;notice=v1`, `restrict_to_local` or `block` |

Example of an anonymized request answered by the EU target:

```http
HTTP/1.1 200 OK
x-tamiz-route: mistral-small
x-tamiz-rule: default
x-tamiz-sensitivity: high
x-tamiz-privacy: anonymize;notice=v1
```

The client receives the answer with the original values restored. `usage` and `cost_usd`
are those of the anonymized exchange.

## Errors added or changed

| Situation | Status | `error.type` | Message (never content) |
|---|---|---|---|
| The level's action is `block` | 451 | `policy_blocked` | `sensitivity critical: action block (rule default)` |
| No target left after filtering by the level's residencies | 451 | `policy_blocked` | `sensitivity high: no allowed target (rule code-to-frontier)` |
| Detection failed and `onDetectorError: block` | 503 | `privacy_unavailable` | `privacy service timeout` / `unavailable` / `contract` |

Blocked requests carry `x-tamiz-sensitivity` and `x-tamiz-privacy: block`. Streaming
requests that are blocked receive the JSON error; no stream starts.

## `POST /v1/simulate` (new)

- **Auth**: same as chat completions (`Authorization: Bearer <key>`).
- **Request**: the chat completion body (`model`, `messages`, and the optional fields).
  `stream` is ignored.
- **Effect**: no provider is called, and the call is not recorded as a request.

Response 200 (`SimulateResponse`):

| Field | Type | Notes |
|---|---|---|
| `sensitivity` | `unknown`/`none`/`low`/`high`/`critical` | |
| `detector` | `ok`/`unavailable`/`timeout`/`contract` | |
| `entities` | array of `{messageIndex, kind, start, end, score}` | UTF-16 offsets into that message; no values |
| `ruleId` | string | matched rule or `default` |
| `decision` | `route`/`block` | |
| `privacyAction` | `allow`/`anonymize`/`restrict_to_local`/`block` | |
| `chain` | array of `{id, provider, model, residency}` | empty when blocked |
| `allowedResidencies` | array | |
| `blockReason` | `action`/`no_target`/`detector_unavailable` | only when blocked |
| `providerMessages` | array of `{role, content}` | only for `anonymize`: exactly what the provider would receive (placeholders, notice) |
| `notice` | `v1` | only for `anonymize` |

Example: [`simulate.example.json`](simulate.example.json). It is a short summary with a
name and an email, so the matched rule is `cheap-short-tasks`, the level is `high` and the
action is `anonymize`. The rule orders its targets by cost (ollama, mistral, openai), and
the level's `[local, eu]` residencies remove `openai-mini`.

Errors: `400 invalid_request` and `401 unauthorized` as for chat completions. A detector
failure is not an error here: it is reported in `detector` and `sensitivity`.

## Environment (gateway)

| Variable | Default | Notes |
|---|---|---|
| `TAMIZ_PRIVACY_URL` | required | base URL of the privacy service, for example `http://privacy:8001` |
| `TAMIZ_PRIVACY_TIMEOUT_MS` | `2000` | 100–30 000 |
| `TAMIZ_PRIVACY_CACHE_MAX_ENTRIES` | `1000` | `0` disables the cache |
| `TAMIZ_PRIVACY_CACHE_TTL_MS` | `600000` | |
