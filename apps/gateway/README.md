# apps/gateway

The Tamiz gateway: a Hono v4 HTTP API on Node.js 22 that receives OpenAI-compatible chat
completion requests, inspects them for personal data through the privacy service, decides
a route with a declarative policy, executes it with its own resilience layer (timeout,
retry, circuit breaker, fallback chain) and audits every decision without storing content.
Strict Clean Architecture (`domain` / `application` / `infrastructure` / `presentation`,
only `main.ts` wires adapters), enforced by dependency-cruiser from `T-001-05`. See
`docs/architecture.md` and ADR-0001.

## Layout

```
src/
├── domain/          result, errors, model/ (routing policy, decide, classifier) — imports nothing
├── application/     ports/, provider-registry.ts, use-cases/ (classifyTask, routeInference)
├── infrastructure/  config/, auth/api-keys.ts, llm/ (AI SDK adapters), policy/,
│                    logging/, clock/                                        — adapters
├── presentation/    app.ts (createApp, OpenAPI), routes/, middlewares/, mappers/ — HTTP only
└── main.ts          composition root: the only module that imports infrastructure
scripts/generate-api-key.ts   prints a new client key and its TAMIZ_API_KEYS entry
policies/                     routing policy files (see policies/README.md)
```

Each layer folder has a `README.md` stating what it may import.

## Behaviour

| Endpoint / event | Result |
|---|---|
| `POST /v1/chat/completions` | OpenAI-compatible (spec 002). Needs `Authorization: Bearer <key>`. Routed by the active policy and executed with resilience (spec 003): per target a residency guard, the circuit breaker, retries with jittered backoff and a timeout, then the next target of the chain. `200` with the contract body, `x-tamiz-route` / `x-tamiz-rule`, and `x-tamiz-fallback` (`target:reason,…`) when a target was abandoned; `400` `invalid_request` (contract, non-JSON, > 1 MiB; paths only, never values); `401` `unauthorized`; `451` `policy_blocked` (residency); `502` `provider_error`; `503` `provider_unavailable` with `retry-after` (every circuit open); `504` `provider_timeout` (last failure a timeout, or the request deadline) — with the routing headers |
| `POST /v1/chat/completions` with `stream: true` | Server-sent OpenAI `chat.completion.chunk` lines, a usage chunk with `cost_usd`, then `[DONE]`. Starts at the first token, so the headers are final; before it the rules above apply (JSON error if every target fails); after it a failure ends the stream with one `data: {"error": …}` event and no `[DONE]` |
| Privacy (spec 005) | Every request is inspected by the privacy service (`TAMIZ_PRIVACY_URL`) before routing, and the policy's `privacy` section applies an action per sensitivity level. `allow` and `anonymize` route along the rule's chain, keeping only the residencies the level allows; `anonymize` replaces personal data with `<KIND_n>` placeholders, adds the versioned notice `prompts/anonymization-notice.v1.md`, and restores the answer. `restrict_to_local` uses the local route. `block` returns `451 policy_blocked`. If inspection fails, the gateway fails closed: `onDetectorError` applies, and with `block` the answer is `503 privacy_unavailable`. Responses carry `x-tamiz-sensitivity` and `x-tamiz-privacy`. Values and mappings never reach logs, events or headers |
| `POST /v1/simulate` | Dry run (spec 005), with the same API key. It takes the chat completion body and returns the inspection (kinds and offsets, never values), the matched rule, the privacy action, the chain and the allowed residencies; for `anonymize` it also returns the exact messages a provider would receive. No provider is called |
| Audit (spec 006) | Every request that reaches the routing decision leaves exactly one audit entry when it ends: answered, failed, blocked or cancelled, streamed or not. An entry holds the decision, the entity kinds and counts, the target and the fallbacks, tokens, cost, the baseline cost and latency. It never holds content: the messages are identified by an HMAC (`TAMIZ_AUDIT_HASH_KEY`). With `DATABASE_URL` the entries go to PostgreSQL. The gateway runs migrations at boot and writes in batches, asynchronously; every loss is an `audit.dropped` event. Without `DATABASE_URL` the log is in memory (bounded) |
| Traces (spec 006) | One `tamiz.request` span per request (decision as `tamiz.*` attributes: route, rule, sensitivity, privacy action, entity counts, fallbacks, tokens, cost) with one `chat {model}` child per provider attempt (GenAI attributes: `gen_ai.operation.name`, `gen_ai.provider.name`, request and response model, finish reasons, usage). Routing, fallback, circuit and privacy steps are span events. No span carries content, and the GenAI content attributes are never set. A stream's attempt span ends at the first token; its request span ends with the stream |
| `GET /v1/admin/audit` | Admin keys only: client keys get `403 forbidden`, missing ones `401` (spec 006). Returns audit entries newest first. Filters: `from`, `to`, `route`, `rule`, `sensitivity`, `action`, `entity`, `outcome`. `limit` is 1–200 (default 50); pass `nextCursor` back as `cursor` for the next page, which repeats and skips nothing while new entries arrive |
| `GET /v1/admin/cost` | Admin only. Cost of served requests in `[from, to)` (both required, ISO), grouped by `groupBy` = `day` (UTC, default), `route` or `model`. Each row has requests, tokens, actual cost and the cost on the baseline target (the policy's most expensive one, named in `baseline`); blocked and failed requests are counted in `notServed`; `totals` sums the rows |
| `GET /v1/admin/providers` | Admin only. Every declared target, idle ones included: circuit state (`closed`, `open` with `cooldownRemainingMs`, `half_open`) and, over the last `windowMinutes` (1–1440, default 15), attempts, errors, error rate and answered latency p50/p95 |
| Routing events | Every attempt, retry wait, fallback, skipped target, residency block, circuit change and failed stream is one `routing event` log line (no content); feature 006 adds traces and metrics |
| `GET /openapi.json` | The OpenAPI 3.1 document generated from the contract schemas |
| `GET /health` | `200` with `{ status: "ok", version, uptimeMs }`, validated against `HealthResponseSchema` from `@tamiz/contracts` |
| Unknown route | `404` with `{ error: { type: "not_found", message, requestId } }` |
| Unhandled error | `500` with `{ error: { type: "internal", … } }`, no stack trace in the body |
| Every response | `x-request-id` header: a well-formed client value (`^[A-Za-z0-9_-]{1,128}$`) is echoed, anything else is replaced by a UUID |
| Every request | One JSON log line (`request completed`) with method, path, status, duration, request id, `clientId` and `route` when known, and the `authorization` / `user-agent` / `content-type` headers when present; never the body |
| Invalid environment | The process prints each offending variable with its expected format (never the value) to stderr and exits with code 1 before binding a port |

Configuration is read once from the environment by `loadConfig` and injected:

| Variable | Default | Accepted |
|---|---|---|
| `PORT` | `3000` | integer 1–65535 |
| `HOST` | `0.0.0.0` | non-empty host name or IP |
| `LOG_LEVEL` | `info` | `fatal` `error` `warn` `info` `debug` `trace` |
| `NODE_ENV` | `development` | `development` `test` `production` |
| `APP_VERSION` | package version | non-empty string (for container builds) |
| `TAMIZ_API_KEYS` | **required** | `clientId:sha256hex` entries, comma-separated; `pnpm --filter @tamiz/gateway generate-api-key <clientId>` prints a key and its entry |
| `TAMIZ_POLICY_FILE` | `policies/default.yaml` | path to a YAML or JSON routing policy (see `policies/README.md`) |
| `OLLAMA_BASE_URL` | `http://localhost:11434/v1` | http(s) URL of Ollama's OpenAI-compatible endpoint |
| `MISTRAL_API_KEY` / `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` | unset | required when a policy target uses that provider; empty counts as unset |
| `MISTRAL_BASE_URL` / `ANTHROPIC_BASE_URL` / `OPENAI_BASE_URL` | provider default | http(s) URL override (proxies); ignored without the key |
| `REDIS_URL` | unset (in-memory circuit state) | `redis://` or `rediss://`; shares circuit breaker state between instances, falling back to memory while unreachable (`docker compose up valkey`) |
| `DATABASE_URL` | unset (in-memory audit log) | `postgres://…`; audit log and API keys in PostgreSQL, with migrations applied at boot (`docker compose up postgres`). Requires `TAMIZ_AUDIT_HASH_KEY` |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | unset (tracing off, a no-op) | OTLP/HTTP collector, e.g. `http://localhost:4318` (`docker compose up jaeger`, UI on 16686). `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`, `OTEL_SERVICE_NAME` (default `tamiz-gateway`), `OTEL_TRACES_SAMPLER` and `OTEL_SDK_DISABLED` are honoured |
| `TAMIZ_AUDIT_HASH_KEY` | ephemeral | at least 32 characters; keys the HMAC that identifies each request's messages in the audit log |
| `TAMIZ_ADMIN_API_KEYS` | unset | admin keys for `/v1/admin/*`, in the same format as `TAMIZ_API_KEYS`. Database keys come from `pnpm --filter @tamiz/gateway api-key:add <client> [--admin]` |
| `TAMIZ_PRIVACY_URL` | required | http(s) base URL of the privacy service (`services/privacy`); requests are inspected there before routing (spec 005) |
| `TAMIZ_PRIVACY_TIMEOUT_MS` | `2000` | 100–30 000; a slower answer counts as a detector failure (fail closed) |
| `TAMIZ_PRIVACY_CACHE_MAX_ENTRIES` / `TAMIZ_PRIVACY_CACHE_TTL_MS` | `1000` / `600000` | in-memory cache of detection results (positions only) by SHA-256 of the messages; `0` entries disables it |

At boot the gateway also loads the policy file and checks that every provider it uses is
configured. Any problem prints one `path: message` line per issue to stderr (never a
secret) and exits 1 before binding a port. The shipped `default.yaml` needs the three
API keys; `TAMIZ_POLICY_FILE=policies/local-only.yaml` needs none. The policy's optional
`resilience` section (request deadline, attempts, backoff, breaker threshold and
cool-down) and `residency` statements are documented in `policies/README.md` and
`specs/003-resilience/contracts/policy.example.yaml`.

The logger is pino with one JSON object per line, `service: "tamiz-gateway"`, ISO
timestamps, and redaction of `prompt`, `messages` and `authorization` at the top level,
under `req.headers` / `body`, and one level deep under any key (`"[REDACTED]"`).

## Scripts

```bash
pnpm --filter @tamiz/gateway dev         # tsx watch src/main.ts (needs @tamiz/contracts built once)
pnpm --filter @tamiz/gateway start       # node dist/main.js (after build)
pnpm --filter @tamiz/gateway typecheck   # tsc --noEmit
pnpm --filter @tamiz/gateway test        # vitest run
pnpm --filter @tamiz/gateway build       # tsc -p tsconfig.build.json → dist/
pnpm --filter @tamiz/gateway generate-api-key acme   # prints "key: tmz_…" once and the TAMIZ_API_KEYS entry
```

`@tamiz/contracts` is consumed through its `dist/` entry point, so run `pnpm build` at the
root (or `pnpm --filter @tamiz/contracts build`) before `dev` or a direct `vitest` call;
`pnpm test` from the root does it through Turborepo's `^build` dependency.

Tests live in `test/`. The HTTP tests (`health`, `not-found-and-request-id`,
`chat-completions`, `openapi`) run in-process with `app.request()` and no sockets;
`helpers/app.ts` wires the real use case to the default policy and a scripted provider.
`domain/`, `application/`, `config/`, `policy/` and `llm/` (MSW, no real network) cover
the layers. `contracts-drift.test.ts` keeps the contract enums equal to the domain tuples.
`boot.integration.test.ts` is the only one that spawns the real process (invalid env,
invalid policy, missing provider key or malformed `TAMIZ_API_KEYS` exits 1; a valid env
serves `/health`). `root-manifest.test.ts` guards the root manifest fields of spec 001
(US1-5).
