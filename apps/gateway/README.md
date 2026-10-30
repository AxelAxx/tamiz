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
