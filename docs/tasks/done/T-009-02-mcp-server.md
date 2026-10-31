# T-009-02 — MCP server skeleton with `simulate_routing` and `get_provider_health`

| Field | Value |
|---|---|
| Task | `T-009-02` (see `docs/tasks/BACKLOG.md`) |
| Feature | `009-mcp-agent` |
| Spec | `specs/009-mcp-agent/spec.md` |
| Branch / PR | `T-009-02-mcp-server`, cut from `main` at c4d62b5 / PR opened after this commit |
| Date | 2026-10-31 |
| Session | Claude Code (Claude Opus 5.5), side session |
| Status | done |

## What was done

`apps/mcp-server` is now the `@tamiz/mcp-server` app (`tasks.md` T001–T016). It is built on
MCP SDK v2. It exposes `simulate_routing` and `get_provider_health` over stdio and over
stateless streamable HTTP (FR-001, FR-002, FR-004, FR-008, FR-009). It also has:

- the `TAMIZ_MCP_TOOLS` allowlist; an unknown name stops the server at start (FR-003);
- the key handling of research R-04: an environment key on stdio, the bearer key of each
  request on HTTP, and the key in no output (FR-005, FR-006);
- the seven coded tool errors (FR-007).

The contract module `packages/contracts/src/mcp.ts` ships whole, with all four input
schemas and the tool error. The dependency-cruiser rule `mcp-agent-isolated` is added, and
`pnpm arch` now cruises `apps/mcp-server/src`.

## Files touched

- `packages/contracts/src/mcp.ts`, `src/index.ts`: tool names, the four input schemas, the
  tool error; `test/mcp.test.ts` (T001).
- `apps/mcp-server/package.json`, `tsconfig*.json`, `vitest.config.ts`: the package; the
  root Vitest projects glob and turbo already pick it up.
- `apps/mcp-server/src/`:
  - `config.ts`, `logger.ts`, `result.ts`;
  - `gateway-client.ts`;
  - `tools/{definition,simulate-routing,get-provider-health,registry}.ts`;
  - `server.ts`, `transports/{stdio,http}.ts`, `main.ts`.
- `apps/mcp-server/test/`:
  - `support/{fake-gateway,fixtures,mcp-harness,no-key}.ts` (T002);
  - `tools-simulate-health`, `errors`, `permissions`, `transport-http`, `transport-stdio`
    tests (T003–T007).
- `apps/mcp-server/README.md`: status and how to run.
- `.dependency-cruiser.cjs`, `package.json` (`arch`): rule `mcp-agent-isolated` (R-13).

## Decisions

- **Versions, re-checked on 2026-10-31.** Checked with `npm view` and Context7 (MCP
  TypeScript SDK v2.4.0 docs), and pinned exactly:
  - `@modelcontextprotocol/server` and `@modelcontextprotocol/client` 2.4.0 (`latest`);
  - `@modelcontextprotocol/hono` 2.0.2. Its peer range is `@modelcontextprotocol/server
    ^2.3.0` and `hono ^4.11.4`, so it accepts 2.4.0 and `createMcpHonoApp` is used as
    planned (R-01).
- **Invalid input is an `isError` result, not a protocol error.** SDK 2.4.0 validates the
  arguments inside its `tools/call` try block. A schema failure comes back as
  `{ isError: true, content: [{ text: "Input validation error: …" }] }`. This deviates from
  the error table in `contracts/tools.md`, which says "protocol error: invalid params".
  - US1-5 pins the behaviour as it is: `isError`, no `structuredContent`, the text, and no
    gateway call.
  - Unknown and disabled tools are still a protocol error (`Tool … not found`), as US2-1
    expects.
- **`isError` results skip output validation (R-07, verified).** `validateToolOutput`
  returns early on `isError`. A tool error therefore carries no `structuredContent` and is
  not checked against the output schema.
- **US1-1 lists two tools in this task, not four.** The spec scenario lists all four tools
  of the finished feature. Here the registry holds only the two implemented tools, and
  `selectTools` ignores allowlisted names that have no implementation yet. `T-009-03` adds
  the other two and changes the US1-1 test to four.
- **`run(input, context)` takes a context, not just the gateway client.** `ToolContext`
  holds the gateway client and `simulateModel`, because `simulate_routing` needs the
  default model. This is a small deviation from data-model section 2.
- **The timeout is a race, not just an `AbortSignal`.** An in-process `fetch` (the fake
  gateway's `app.fetch`) ignores the signal. The client races the call, body included,
  against a timer, and still aborts the signal for real sockets.
- **Fixed messages for 401 and 403.** They are "the gateway key is missing or invalid" and
  "the gateway key lacks the admin role", from `contracts/tools.md`. Other 4xx answers
  carry the gateway envelope's message. 5xx answers carry the status. Contract failures
  carry the first failing path, never the value.
- **Logger to fd 2, synchronously.** It uses `pino.destination({ fd: 2, sync: true })`, so
  a start-up error line is not lost on exit. Configuration errors go straight to stderr
  before any logger exists.
- **The fake gateway has no `POST /v1/chat/completions` yet.** Only the agent needs it, so
  it is added with `T-009-04`. The audit and cost routes and fixtures are there already
  (fixtures from the spec 006 examples), ready for `T-009-03`.
- **HTTP: a server and a transport per request** (`sessionIdGenerator: undefined`).
  `GET`/`DELETE` answer `405`. The bearer middleware answers `401` with
  `WWW-Authenticate: Bearer`. A non-local `TAMIZ_MCP_HTTP_HOST` needs
  `TAMIZ_MCP_ALLOWED_HOSTS`, which is used for both `Host` and `Origin` validation.

## How it was verified

```bash
pnpm lint        # exit 0 (existing infos in the gateway only)
pnpm typecheck   # 7 packages green
pnpm arch        # ✔ no dependency violations found (139 modules, 478 dependencies cruised)
pnpm test        # Test Files 106 passed; Tests 1076 passed | 27 skipped (Testcontainers suites)
pnpm build       # green (part of pnpm test)
```

- `@tamiz/mcp-server`: 39 tests in 5 files. The stdio test ran against the built
  `dist/main.js` and was not skipped.
- `contracts/test/mcp.test.ts`: 24 tests.
- `mcp-agent-isolated` was tried with a deliberate violation
  (`src/probe.ts` → `src/agent/probe.ts`). The result was
  `error mcp-agent-isolated … 1 dependency violations`; the probe files were then removed.

Quickstart §3–§5 by hand, against a real gateway (`tsx src/main.ts`, port 3300,
`policies/local-only.yaml`, no privacy service, no Docker on this machine). A small SDK
client script spawned `dist/main.js` over stdio:

- **Admin key.** The tool list was `simulate_routing(ro), get_provider_health(ro)`.
  - `get_provider_health` returned the real report (`ollama-llama`, `closed`).
  - `simulate_routing` with the DNI text returned `detector: "unavailable"`,
    `privacyAction: "restrict_to_local"`, chain `[ollama-llama]`. This is the fail-closed
    path, because no privacy service was running.
- **Client key.** `get_provider_health` returned
  `{"error":{"code":"gateway_forbidden","message":"the gateway key lacks the admin role"}}`;
  `simulate_routing` worked.
- **`TAMIZ_MCP_TOOLS=simulate_routing`.** One tool listed; `get_provider_health` gave the
  protocol error `Tool get_provider_health not found`.
- **Start-up failures.**
  - `TAMIZ_MCP_TOOLS=nope`: exit 1, `TAMIZ_MCP_TOOLS: unknown tool "nope" (known: …)`.
  - No key: exit 1, `TAMIZ_MCP_GATEWAY_KEY is required for the stdio transport`.
- **Gateway down** (first attempt, before the gateway was up): every call returned
  `gateway_unreachable`.
- **HTTP** (`--transport http`, port 3101), checked with `curl`:
  - no bearer: `401`;
  - with the admin bearer: the tool list as SSE;
  - `Host: evil.example`: `403`;
  - `GET /mcp`: `405`;
  - stderr: one JSON start line.

The DNI simulation with a live privacy service (`critical`) was not run by hand. The
in-process tests cover the result shape with the fake.

## Pending / follow-ups

- `T-009-03`: `query_audit_log`, `get_cost_report`, the README snippets and their test,
  and US1-1 with four tools.
- `contracts/tools.md`, error table: the "input fails the schema" row says "protocol
  error". SDK 2.4.0 answers an `isError` result instead (see Decisions). Correct the row
  when the spec is next touched; there is no behaviour change to make.

## Pitfalls for the next session

- **No `Host` header on in-process requests.** A `Request` built in process has none, and
  `createMcpHonoApp`'s localhost validation rejects a missing `Host` with `403`. The HTTP
  test's `inProcess` fetch sets `Host` from the URL.
- **`createMcpHonoApp` returns a plain `Hono`.** `c.get("parsedBody")` does not type-check
  on it. `transports/http.ts` casts the app to `McpHttpApp` (`Variables: { parsedBody }`).
- **`noPropertyAccessFromIndexSignature` against Biome's `useLiteralKeys`.** Header and env
  records hit this conflict. The fake records `authorization` as its own field, and the
  tests destructure `process.env` instead of using `env["X"]`.
- **The startup log line lists the allowlist, not the registered tools.** The two are
  identical once `T-009-03` lands.
- **Running the real gateway locally.** It refuses `policies/default.yaml` without
  Mistral, OpenAI and Anthropic keys; use `policies/local-only.yaml` for hand checks. Admin
  keys go in `TAMIZ_ADMIN_API_KEYS` (`generate-api-key` prints the entry format).

## Links

- Spec / plan / tasks: `specs/009-mcp-agent/`
- ADRs: none added
- Related task records: `docs/tasks/done/T-009-01-spec-plan-tasks-009.md`, `docs/tasks/done/T-005-06-simulate-endpoint.md`, `docs/tasks/done/T-006-06-cost-and-providers.md`
