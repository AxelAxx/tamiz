# apps/gateway

The Tamiz gateway: a Hono v4 HTTP API on Node.js 22 that receives OpenAI-compatible chat
completion requests, inspects them for personal data through the privacy service, decides
a route with a declarative policy, executes it with its own resilience layer (timeout,
retry, circuit breaker, fallback chain) and audits every decision without storing content.
Strict Clean Architecture (`domain` / `application` / `infrastructure` / `presentation`,
only `main.ts` wires adapters), enforced by dependency-cruiser from `T-001-05`. See
`docs/architecture.md` and ADR-0001.

## Layout (since `T-001-04`)

```
src/
├── domain/          result.ts (Result<T, E>), errors.ts (DomainError)       — imports nothing
├── application/     ports/clock.port.ts, ports/logger.port.ts                — imports domain
├── infrastructure/  config/env.ts, logging/logger.ts, clock/system-clock.ts  — adapters
├── presentation/    app.ts (createApp), routes/health.ts,
│                    middlewares/request-id.ts, mappers/error-envelope.ts    — HTTP only
└── main.ts          composition root: the only module that imports infrastructure
```

Each layer folder has a `README.md` stating what it may import.

## Behaviour

| Endpoint / event | Result |
|---|---|
| `GET /health` | `200` with `{ status: "ok", version, uptimeMs }`, validated against `HealthResponseSchema` from `@tamiz/contracts` |
| Unknown route | `404` with `{ error: { type: "not_found", message, requestId } }` |
| Unhandled error | `500` with `{ error: { type: "internal", … } }`, no stack trace in the body |
| Every response | `x-request-id` header: a well-formed client value (`^[A-Za-z0-9_-]{1,128}$`) is echoed, anything else is replaced by a UUID |
| Every request | One JSON log line (`request completed`) with method, path, status, duration, request id and the `authorization` / `user-agent` / `content-type` headers when present; never the body |
| Invalid environment | The process prints each offending variable with its expected format (never the value) to stderr and exits with code 1 before binding a port |

Configuration is read once from the environment by `loadConfig` and injected:

| Variable | Default | Accepted |
|---|---|---|
| `PORT` | `3000` | integer 1–65535 |
| `HOST` | `0.0.0.0` | non-empty host name or IP |
| `LOG_LEVEL` | `info` | `fatal` `error` `warn` `info` `debug` `trace` |
| `NODE_ENV` | `development` | `development` `test` `production` |
| `APP_VERSION` | package version | non-empty string (for container builds) |
| `TAMIZ_POLICY_FILE` | `policies/default.yaml` | path to a YAML or JSON routing policy (see `policies/README.md`) |
| `OLLAMA_BASE_URL` | `http://localhost:11434/v1` | http(s) URL of Ollama's OpenAI-compatible endpoint |
| `MISTRAL_API_KEY` / `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` | unset | required when a policy target uses that provider; empty counts as unset |
| `MISTRAL_BASE_URL` / `ANTHROPIC_BASE_URL` / `OPENAI_BASE_URL` | provider default | http(s) URL override (proxies); ignored without the key |

At boot the gateway also loads the policy file and checks that every provider it uses is
configured. Any problem prints one `path: message` line per issue to stderr (never a
secret) and exits 1 before binding a port. The shipped `default.yaml` needs the three
API keys; `TAMIZ_POLICY_FILE=policies/local-only.yaml` needs none.

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
```

`@tamiz/contracts` is consumed through its `dist/` entry point, so run `pnpm build` at the
root (or `pnpm --filter @tamiz/contracts build`) before `dev` or a direct `vitest` call;
`pnpm test` from the root does it through Turborepo's `^build` dependency.

Tests live in `test/`: `result.test.ts`, `env.test.ts`, `logger.test.ts`, `health.test.ts`
and `not-found-and-request-id.test.ts` run in-process (`app.request()`, no sockets);
`boot.integration.test.ts` is the only one that spawns the real process (invalid env,
invalid policy or missing provider key exits 1; valid env serves `/health`);
`root-manifest.test.ts` guards the root manifest fields of
spec 001 (US1-5).
