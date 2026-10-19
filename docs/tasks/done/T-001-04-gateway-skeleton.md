# T-001-04 — Gateway skeleton: Hono app, Clean Architecture folders, `Result`, config, logger, `/health`

| Field | Value |
|---|---|
| Task | `T-001-04` (see `docs/tasks/BACKLOG.md`) |
| Feature | `001-contracts-and-skeleton` |
| Spec | `specs/001-contracts-and-skeleton/spec.md` (US3, US4, US5; FR-013 … FR-020; SC-005, SC-007); `tasks.md` Phase 3 (T032–T051); `data-model.md` sections 6–8; `research.md` R-08 … R-11 |
| Branch / PR | `T-001-04-gateway-skeleton` / PR opened after this commit |
| Date | 2026-10-19 |
| Session | Claude Code (Claude Fable 5.1), side session started from the `T-001-03` session |
| Status | done |

## What was done

`apps/gateway` is now a running Hono 4 service laid out in the four Clean Architecture
layers plus a `main.ts` composition root (FR-013), each layer folder with a README stating
what it may import. The domain holds `Result<T, E>` with `ok`/`err`/`isOk`/`isErr`/`map`/
`mapErr`/`andThen`/`unwrapOr` and the `DomainError` union (`validation`, `configuration`,
`not_found`) with constructors and an `assertNever` helper (FR-014). Configuration is a
Zod `EnvSchema` behind `loadConfig(env) → Result<GatewayConfig, ConfigurationError>`; an
invalid environment stops the process with exit code 1 and one `PATH: expected …` line per
variable, never the value (FR-015). The pino logger redacts `prompt`, `messages` and
`authorization` at the top level, under `req.headers` / `body` and one level deep under any
key (FR-016). `GET /health` answers the `HealthResponseSchema` contract with version and
uptime from `ClockPort` (FR-017); every response carries `x-request-id` (FR-018); unknown
routes and unhandled errors answer `ErrorEnvelope` bodies without stack traces (FR-019); a
valid environment serves `/health` over HTTP and logs one `gateway listening` line
(FR-020). Spec scenarios US3-1 … US3-4, US4-1 … US4-3 and US5-1 … US5-3 each map to a
named test; 43 gateway tests pass.

## Files touched

- `apps/gateway/package.json` — dependencies `hono`, `@hono/node-server`, `@hono/zod-validator` (unused until feature 002), `pino`, `zod`, `@tamiz/contracts` (`workspace:*`); dev `tsx`, `pino-pretty`; scripts `dev`, `start`, `test` is now `vitest run`.
- `apps/gateway/vitest.config.ts` — node environment, `include: test/**/*.test.ts`.
- `apps/gateway/src/index.ts` — placeholder removed.
- `apps/gateway/src/domain/{result,errors}.ts`, `README.md` — FR-014; zero imports.
- `apps/gateway/src/application/ports/{clock,logger}.port.ts`, `README.md` — `ClockPort` (R-09) and `LoggerPort` (see Decisions).
- `apps/gateway/src/infrastructure/config/env.ts` — `EnvSchema`, `loadConfig`, `GatewayConfig`, `PACKAGE_VERSION`, `LOG_LEVELS`.
- `apps/gateway/src/infrastructure/logging/logger.ts` — `createLogger({ level, destination? })`, `REDACT_PATHS`, `REDACTED`.
- `apps/gateway/src/infrastructure/clock/system-clock.ts` — `systemClock`.
- `apps/gateway/src/infrastructure/README.md`.
- `apps/gateway/src/presentation/app.ts` — `createApp({ clock, version, startedAt, logger })`, request log middleware, `notFound`, `onError`.
- `apps/gateway/src/presentation/routes/health.ts` — `buildHealthResponse`, `healthRoutes`.
- `apps/gateway/src/presentation/middlewares/request-id.ts` — strict `x-request-id` middleware.
- `apps/gateway/src/presentation/mappers/error-envelope.ts` — `toErrorEnvelope`, `httpStatusFor`, `domainErrorToErrorType`, `domainErrorToEnvelope`.
- `apps/gateway/src/presentation/README.md`.
- `apps/gateway/src/main.ts` — composition root.
- `apps/gateway/test/{result,env,logger,health,not-found-and-request-id}.test.ts`, `test/boot.integration.test.ts`, `test/helpers/noop-logger.ts` — scenario tests; `test/root-manifest.test.ts` kept.
- `apps/gateway/README.md` — layout, behaviour table, env table, scripts.
- `pnpm-lock.yaml`.
- `docs/tasks/BACKLOG.md` — `T-001-04` row set to `done` (that row only).

## Decisions

- **Own `request-id` middleware instead of Hono's `requestId()`** (R-08 suggested the
  built-in with `limitLength: 128`). The built-in accepts `=` and the `RequestId` contract
  does not (`^[A-Za-z0-9_-]{1,128}$`); a bundled-middleware wrapper cannot reject a header
  the built-in already accepted, so the replacement is twelve lines with the same shape
  (`c.get("requestId")`, header set on the response). The test covers 200 characters,
  control characters, spaces, `=`, `/` and non-ASCII.
- **`LoggerPort` in `application/ports/logger.port.ts`** (not in the brief, which listed
  only `clock.port.ts`). `createApp` needs a logger and `presentation/` may not import
  `infrastructure/logging/logger.ts`; importing pino's `Logger` type into presentation
  would also tie HTTP code to the logging library. The port is the four-method subset
  `{ debug, info, warn, error }(bindings, message)`; pino satisfies it structurally.
- **Expected-format table instead of Zod messages** for configuration issues
  (`expected an integer between 1 and 65535`). Zod 4's own messages are value-free for
  these schemas, but the table keeps the spec's "expected format" wording stable and makes
  the no-value guarantee independent of the library's message format.
- **Package version read with `readFileSync(new URL("../../../package.json", import.meta.url))`**
  rather than a JSON import: `tsconfig.build.json` has `rootDir: src`, and importing a file
  outside `rootDir` fails the build (TS6059). The relative path is the same from `src/` and
  from `dist/`.
- **Request log line lists `authorization`, `user-agent` and `content-type` only when
  present.** The first version put `authorization: undefined` in the object and pino
  redacted the *key*, so every request appeared to carry a redacted credential. Quickstart
  section 5 (send `authorization`, see `"[REDACTED]"`) still holds.
- **`uptimeMs` is clamped at 0** (`Math.max(0, Math.round(now − startedAt))`): the
  `Milliseconds` constructor throws on negatives and a clock skew must not turn `/health`
  into a 500.
- **Level label as a string** (`formatters.level`) so a line reads `"level":"info"` rather
  than `30`; the spec only asks for `level`, `time`, `msg`, and readable levels help the
  Compose/Jaeger stage.
- **Boot test spawns `node --import tsx src/main.ts`** from `apps/gateway` with a free port
  found by binding port 0; it is the only test that opens a socket and is capped at 15 s.
- **`@hono/zod-validator` added now, unused** as `tasks.md` T032 says; feature 002 uses it.
- **Backlog edit kept to the `T-001-04` row only**, as instructed.

## How it was verified

```bash
pnpm --filter @tamiz/gateway test
#  Test Files  7 passed (7)      Tests  43 passed (43)
# (before implementing src/: 6 failed | 1 passed — module-not-found on every new import)
pnpm lint        # Checked 53 files in 32ms. No fixes applied.
pnpm typecheck   # Tasks: 4 successful, 4 total
pnpm test        # Tasks: 4 successful; gateway 7 files / 43 tests, contracts 6 files / 95 tests
pnpm build       # Tasks: 3 successful; apps/gateway/dist/{main.js,domain,application,infrastructure,presentation}

# US4-1 against the built output
PORT=abc LOG_LEVEL=loud node dist/main.js
# Invalid environment configuration:
#   PORT: expected an integer between 1 and 65535
#   LOG_LEVEL: expected one of fatal, error, warn, info, debug, trace
# exit: 1

# Quickstart section 3 (LOG_LEVEL=debug tsx src/main.ts, port 3000)
curl -i http://localhost:3000/health
# HTTP/1.1 200 OK  content-type: application/json  x-request-id: 90cc2959-a4ec-4404-8234-d95e17272ade
# {"status":"ok","version":"0.1.0","uptimeMs":7054}
curl -i -H "x-request-id: abc-123" http://localhost:3000/nope
# HTTP/1.1 404 Not Found  x-request-id: abc-123
# {"error":{"type":"not_found","message":"Route not found","requestId":"abc-123"}}
# Quickstart section 5: curl -H "authorization: Bearer secret" /health → log line
# {"level":"info","time":"2026-10-19T09:59:42.460Z","service":"tamiz-gateway","requestId":"…",
#  "req":{"method":"GET","path":"/health","headers":{"authorization":"[REDACTED]","user-agent":"curl/8.18.0"}},
#  "status":200,"durationMs":1,"msg":"request completed"}
# Startup line: {"level":"info",…,"host":"0.0.0.0","port":3000,"version":"0.1.0","nodeEnv":"development","msg":"gateway listening"}
```

The import direction of every source file was checked by hand (`grep from`): `domain`
imports nothing; `application` nothing outside itself; `infrastructure` → domain,
application, `node:fs`, `zod`, `pino`; `presentation` → domain, application,
`@tamiz/contracts`, `hono`, `node:crypto`; only `main.ts` imports `infrastructure`.
dependency-cruiser will enforce it in `T-001-05`.

The engine warning `Unsupported engine: wanted {"node":">=22 <23"} (current: v24.14.0)` is
printed by every pnpm command and is expected.

## Pending / follow-ups

- `T-001-05` (dependency-cruiser + CI) and `T-001-06` (`FakeClock`, builders, root Vitest
  projects) can start; `health.test.ts` carries a local `fixedClock` that `T-001-06` T071
  replaces with `createFakeClock`.
- No graceful shutdown handler (`SIGTERM` → `server.close()`); not in this task's scope,
  needed before the Docker Compose stage (OPS). Not added to the backlog as a row because
  the OPS tasks already own container behaviour; mention it there.
- `@hono/zod-validator` is a dependency without an import until `T-002-06`.

## Pitfalls for the next session

- **`@tamiz/contracts` is resolved through its `dist/` entry point.** A fresh worktree
  needs `pnpm install` and then `pnpm --filter @tamiz/contracts build` before a direct
  `vitest run` or `pnpm --filter @tamiz/gateway dev`; otherwise Vite reports *Failed to
  resolve entry for package "@tamiz/contracts"*. Root `pnpm test` / `pnpm build` handle it
  through Turborepo's `^build`.
- **`noPropertyAccessFromIndexSignature` vs Biome `useLiteralKeys`** pull in opposite
  directions on `Record<string, unknown>`: `tsc` demands `obj["key"]`, Biome rewrites it to
  `obj.key`. Do not fight it with brackets; give parsed JSON an explicit interface with the
  fields the test reads (see `CapturedLine` in `logger.test.ts`).
- **pino redacts a key whose value is `undefined`** (the key becomes `"[REDACTED]"` instead
  of disappearing). Build log objects from present values only.
- **Importing a JSON file outside `rootDir` breaks `tsc -p tsconfig.build.json`** even
  though `tsconfig.json` (noEmit) accepts it. Read it with `fs` relative to `import.meta.url`.
- **Narrowing on `const r: Result<T, E> = ok(x)`**: TypeScript narrows the declared union to
  `Ok<T>` at the assignment, so the `else` branch is `never`. Produce the value through a
  function returning `Result` when a test needs both branches.
- **`biome check --write` reflows files it fixes**; run it before `pnpm lint` and re-read any
  file you edit afterwards.
- **Killing the dev server on Windows**: `Get-NetTCPConnection -LocalPort 3000 -State Listen`
  then `Stop-Process -Id <OwningProcess>`; the Bash background task reports exit 127 when
  killed that way, which is expected.
- Long heredocs in the Bash tool are still unreliable here; short Python `<<'EOF'` scripts
  for targeted replacements worked, the Write tool for whole files.

## Links

- Spec / plan / tasks: `specs/001-contracts-and-skeleton/{spec,plan,tasks}.md` (Phase 3), `data-model.md` sections 6–8, `research.md` R-08 … R-11, `quickstart.md` sections 3–5, `contracts/openapi.yaml`
- ADRs: none added
- Related task records: `docs/tasks/done/T-001-03-contracts-package.md` (contracts consumed here), `docs/tasks/done/T-001-02-monorepo-tooling.md` (tooling and machine pitfalls)
