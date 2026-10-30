# T-002-06 — Chat completions endpoint, API keys and OpenAPI

| Field | Value |
|---|---|
| Task | `T-002-06` (see `docs/tasks/BACKLOG.md`) |
| Feature | `002-provider-routing` |
| Spec | `specs/002-provider-routing/spec.md` (US1-1 … US1-6, US2-4, US5-1 … US5-5, FR-024 … FR-032, SC-007); `tasks.md` Phase 5 (T049–T063); `research.md` R-03, R-10, R-11, R-15; `contracts/http.md` |
| Branch / PR | `T-002-06-chat-completions-endpoint` / PR opened after this commit |
| Date | 2026-10-30 |
| Session | Claude Code (Claude Opus 5.5), side session (Alex away; merge authority delegated for the session) |
| Status | done |

## What was done

The gateway now serves `POST /v1/chat/completions` end to end. The real
`routeInference` runs behind API-key auth, and the AI SDK provider registry, the
loaded policy and the system clock are wired in `main.ts` (FR-024, FR-029). Every
response with a routing decision carries `x-tamiz-route` and `x-tamiz-rule`, both
success and provider failure (FR-026). Bodies that fail the contract, are not JSON, are
not declared as JSON or exceed 1 MiB answer `400 invalid_request` with paths and Zod's
messages, never values (FR-027, FR-032). A provider `timeout` answers
`504 provider_timeout` (a new contract error type) and any other provider failure
answers `502 provider_error` (FR-027, FR-028). `TAMIZ_API_KEYS` is required. It holds
SHA-256 hashes that are compared in constant time against every record, and
`generate-api-key` prints a key and its entry (FR-029, FR-030). The app is an
`OpenAPIHono`, and `/openapi.json` serves an OpenAPI 3.1 document generated from the
contract schemas (FR-031). The hand-written 001 `openapi.yaml` is deleted. A drift test
pins the contract enums to the domain tuples (R-03).

## Files touched

- `packages/contracts/src/error.ts`, `test/error.test.ts`: `provider_timeout` → 504 (T050).
- `apps/gateway/src/infrastructure/auth/api-keys.ts`, `scripts/generate-api-key.ts`: T055. `tsconfig.json` now typechecks `scripts/`.
- `apps/gateway/src/infrastructure/config/env.ts`: `TAMIZ_API_KEYS` required and parsed into `apiKeys` (T056).
- `apps/gateway/src/presentation/mappers/{inference-request,chat-completion-response}.ts`: T057. `mappers/error-envelope.ts` adds the timeout case and `fromZodIssues` (T058).
- `apps/gateway/src/presentation/middlewares/api-key-auth.ts`: T059.
- `apps/gateway/src/presentation/routes/chat-completions.ts`: T060. `routes/health.ts` now uses `createRoute`.
- `apps/gateway/src/presentation/app.ts` (T061) and `openapi-schemas.ts` (see Decisions).
- `apps/gateway/src/main.ts`: wiring (T062).
- `specs/001-contracts-and-skeleton/contracts/openapi.yaml`: deleted. The folder's `README.md` now points at `/openapi.json` (001 T076).
- Tests: `test/chat-completions.test.ts` (T052), `test/openapi.test.ts` (T053), `test/contracts-drift.test.ts` (T054), `test/config/api-keys.test.ts` (T051), `test/helpers/app.ts`.
  - Updated: `env.test.ts` and `config/env-002.test.ts` (the required key), `health.test.ts` and `not-found-and-request-id.test.ts` (`NO_CHAT` deps), `error-envelope.test.ts`, and `boot.integration.test.ts` (the US5-4 `todo` is now a test, T047).
- `apps/gateway/package.json`, `pnpm-lock.yaml`: `@hono/zod-openapi` 1.6, script `generate-api-key` (T049).
- `apps/gateway/README.md`, `src/presentation/README.md`, `src/infrastructure/README.md`: endpoint, variables, modules.
- `docs/tasks/BACKLOG.md`: `T-002-06` row set to `done` (that row only).

## Decisions

- **Contract schemas get their OpenAPI names from Zod 4's `.meta({ id })`, not from
  `registry.register()`.** `register()` calls the `.openapi()` method that
  `@hono/zod-openapi` patches into Zod. Zod 4 copies methods onto each schema when it is
  created, so a contract schema created before that patch never has the method. Whether
  it works then depends on import order: it worked in `node -e` and failed in every test
  file that imports `@tamiz/contracts` first. R-11 anticipated this risk.
  `presentation/openapi-schemas.ts` creates `.meta({ id })` copies (same validation),
  which the generator turns into `components.schemas` plus `$ref`. Contracts still
  depend only on `zod`.
- **Verification is injected into presentation.** `presentation/` may not import
  `infrastructure/`, so `createApp` takes `authenticate(key) → clientId | undefined`.
  `main.ts` passes `verifyApiKey(key, config.apiKeys)`.
- **The `model` of the response is `completion.modelName`** (what the provider says it
  served), as T052 and US1-1 test it. T057 said `target.model`, which is the requested
  name; FR-025 ("the target that answered") fits the reported name better.
- **Missing usage is reported as zeros** until `T-002-07` estimates it, as T057 allows.
- **A non-JSON media type is refused explicitly.** The validator of `@hono/zod-openapi`
  skips a body whose content type is not JSON, and the handler then crashed (500), so
  a small `/v1/*` middleware answers 400. A malformed JSON body (an `HTTPException` 400
  from the validator) is mapped in `onError`.
- **Order on `/v1/*`: body limit → auth → content type → validation.** An oversized
  body is refused before anything else. A request without a key gets 401 before its
  body is inspected.
- **The log keeps the 001 contract:** the port receives the raw `authorization` header
  and pino redacts it. The US5 tests therefore assert on real pino output captured in
  memory, not on the recording logger. The line gains `clientId` and `route`.
- **`/health` and `/openapi.json` need no key** (US5-5). The body limit and auth are
  mounted on `/v1/*` only.

## How it was verified

```bash
pnpm lint          # Checked 141 files. No fixes applied.
pnpm typecheck     # Tasks: 5 successful, 5 total
pnpm arch          # ✔ no dependency violations found (60 modules, 154 dependencies cruised)
pnpm test --coverage   # Test Files 43 passed (43)   Tests 471 passed (471)   Type Errors no errors
#  All files 96.49 % lines; src/presentation 100 % lines
pnpm build         # Tasks: 3 successful, 3 total
```

Quickstart §1–4 and §10 against the real process (`policies/local-only.yaml`, port 3123,
a key from `generate-api-key demo`, redacted). Ollama was **not running** on this
machine, so the routed call shows the 502 path rather than a model answer:

```text
GET /health                         → HTTP/1.1 200 OK  {"status":"ok","version":"0.1.0","uptimeMs":8135}
POST /v1/chat/completions (no key)  → HTTP/1.1 401 Unauthorized  {"error":{"type":"unauthorized","message":"Missing or invalid API key",…}}
POST … {"messages":[],"temperature":7}
                                    → HTTP/1.1 400 Bad Request
  {"error":{"type":"invalid_request","message":"messages: Too small: expected array to have >=1 items; temperature: Too big: expected number to be <=2",…}}
POST … valid body, Ollama down      → HTTP/1.1 502 Bad Gateway
  x-tamiz-route: ollama-llama
  x-tamiz-rule: default
  {"error":{"type":"provider_error","message":"provider unreachable",…}}
GET /openapi.json                   → {"openapi":"3.1.0","info":{"title":"Tamiz gateway",…
gateway log: the key appears 0 times; "authorization":"[REDACTED]" on both keyed requests
```

**Not verified here:** a 200 from a real model through the running process (no Ollama
locally). The 200 path is covered in-process by `chat-completions.test.ts` with the real
use case and a scripted provider, and the adapters' HTTP behaviour by the MSW tests of
T-002-04.

## Pending / follow-ups

- `T-002-07`: estimated usage and `cost_usd` / `estimated` in `usage` (the
  `contracts/http.md` example already shows them).
- A run against a live Ollama (`ollama pull llama3.1:8b`) to see a real 200. It is a
  manual check, not a backlog task.
- No new backlog rows.

## Pitfalls for the next session

- **Never call `.openapi()` or `registry.register()` on a `@tamiz/contracts` schema.**
  Use `.meta({ id })` in `presentation/openapi-schemas.ts`. The failure depends on
  import order, so a passing `node -e` probe proves nothing.
- **`.meta({ id })` adds the schema to Zod's global registry, and a duplicate id throws.**
  Create each named copy once, at module level.
- **`TAMIZ_API_KEYS` is required now.** Every `loadConfig` test spreads a `BASE`, and the
  boot test passes a test hash. Running the gateway by hand needs
  `generate-api-key <client>` first.
- `@hono/zod-openapi` does not validate a body whose content type is not JSON. Keep the
  explicit content-type middleware.

## Links

- Spec / plan / tasks: `specs/002-provider-routing/{spec,plan,tasks,quickstart}.md` (Phase 5), `contracts/http.md`, `research.md` R-03, R-10, R-11, R-15
- ADRs: none added
- Related task records: `docs/tasks/done/T-002-05-policy-file.md`, `docs/tasks/done/T-002-04-llm-adapters.md`, `docs/tasks/done/T-002-03-ports-and-use-cases.md`, `docs/tasks/done/T-001-04-gateway-skeleton.md`
