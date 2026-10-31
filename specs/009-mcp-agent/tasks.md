---

description: "Task list for feature 009-mcp-agent"
---

# Tasks: MCP Server and Agent

**Input**: `specs/009-mcp-agent/` (`plan.md`, `spec.md`, `research.md` R-01 … R-14,
`data-model.md`, `contracts/`, `quickstart.md`); features 005 and 006 merged; this spec
approved by Alex (`T-009-01`).

**Tests**: Mandatory. They are written before the code, and every scenario maps to a test
(table below); the scenario id is the test name. `US5-6` is the recorded demo run.

**Organization**: Phases are the backlog tasks `T-009-02` … `T-009-04`, one PR each.
`mcp/` abbreviates `apps/mcp-server/`, and `contracts/` abbreviates `packages/contracts/`.

## Scenario coverage

| Scenario | Task | Scenario | Task |
|---|---|---|---|
| US1-1 four tools, schemas, read-only | T003 | US3-3 page size default 20, max 50 | T017 |
| US1-2 simulate a DNI text, contract-valid | T003 | US3-4 cost report, contract-valid | T017 |
| US1-3 text → one user message, model default | T003 | US3-5 extra field → `gateway_contract` | T017 |
| US1-4 provider health, default window 15 | T003 | US4-1 stdio: built binary, stdout clean | T007 |
| US1-5 invalid input → no gateway call | T003 | US4-2 HTTP: bearer forwarded per request | T006 |
| US1-6 unreachable / timeout / off-contract | T004 | US4-3 HTTP: no bearer → 401 | T006 |
| US2-1 allowlist: disabled not listed, not callable | T005 | US4-4 HTTP: foreign Host/Origin → 403 | T006 |
| US2-2 unknown tool name → no start | T005 | US4-5 HTTP: two keys stay apart | T006 |
| US2-3 only read calls, annotations | T005 | US4-6 README snippets | T018 |
| US2-4 key in no output or log | T005 | US5-1 spend question → route and amounts | T023 |
| US2-5 stdio without key → no start | T005 | US5-2 model calls via gateway, contract-valid | T023 |
| US2-6 401/403 → coded tool errors | T004 | US5-3 bad tool/args/format → observation; step limit | T022, T023 |
| US2-7 400 → `gateway_rejected` with message | T004 | US5-4 gateway error stops the run | T023 |
| US3-1 audit filters forwarded, page valid | T017 | US5-5 run record, prompt version, UTC date | T023 |
| US3-2 cursor → next page | T017 | US5-6 demo on the real stack, audit shows `pinned-local` | T030 |

---

## Phase 1: `T-009-02` — Server, contracts, transports, `simulate_routing`, `get_provider_health` (US1, US2, US4-1 … US4-5)

**Goal**: an MCP server any host can launch, with two tools, the allowlist, the error
mapping and both transports. **Independent test**: `pnpm --filter @tamiz/mcp-server test`
passes T003–T007 against the fake gateway.

### Tests first

- [x] T001 [P] `contracts/test/mcp.test.ts` covers:
  - `SimulateRoutingInputSchema`: `text` 1 … 32 000 chars, `messages` ≥ 1, "exactly one of
    `text` / `messages`" (both or neither fail), `model` 1 … 200 chars;
  - `QueryAuditLogInputSchema`: `limit` is `z.int().min(1).max(50).default(20)`, no string
    coercion, the filter fields of `AuditQuerySchema`;
  - `GetCostReportInputSchema` (`groupBy` default `day`) and `GetProviderHealthInputSchema`
    (`z.int().min(1).max(1440).default(15)`);
  - all strict (an extra field fails);
  - `McpToolErrorSchema` (the seven codes, message ≤ 500);
  - `specs/009-mcp-agent/contracts/tool-result.example.json`: its `structuredContent`
    parses with `ProvidersReportSchema`, and its error text parses with
    `McpToolErrorSchema`.
- [x] T002 [P] `mcp/test/support/` holds the shared harness (research R-12):
  - `fake-gateway.ts`: a Hono app with `POST /v1/simulate`, `GET /v1/admin/{audit,cost,providers}`
    and `POST /v1/chat/completions`. It:
    - checks the bearer against configured admin and client keys (401/403 as the gateway);
    - parses queries and bodies with the real contracts;
    - records every request (method, path, query, headers, body);
    - answers from scripted fixtures, or with a scripted failure (status, delay, malformed
      body).
  - `fixtures.ts`: the fixtures, each parsed with its response contract at load.
  - `mcp-harness.ts`: `connect({ tools?, key?, fetch? })` → an in-process `Client` over
    `InMemoryTransport.createLinkedPair()` (both halves from `@modelcontextprotocol/client`),
    plus a captured log stream.
  - `no-key.ts`: asserts a key string is absent from listed tools, results, errors and logs.
- [x] T003 [US1] `mcp/test/tools-simulate-health.test.ts` covers US1-1 … US1-5, one test
  per scenario:
  - the list shows four tools with descriptions, input and output schemas, and
    `readOnlyHint: true`;
  - a DNI text: the result parses with `SimulateResponseSchema`;
  - the recorded simulate body has one user message, or the given messages, and the given
    model or `TAMIZ_MCP_SIMULATE_MODEL`;
  - provider health with and without `windowMinutes` (the recorded query is 15 by
    default);
  - invalid input (empty text, both `text` and `messages`, a window of 0) is a protocol
    error and the fake records nothing.
- [x] T004 [US1] `mcp/test/errors.test.ts` covers US1-6, US2-6 and US2-7, with one case per
  row of the error table in `contracts/tools.md`:
  - connection refused, a delay past a 100 ms timeout, a body with a missing field;
  - 401, 403, 400 with the gateway's message, 500.

  Each case checks `isError: true`, the code, no `structuredContent`, and no key in the
  text.
- [x] T005 [US2] `mcp/test/permissions.test.ts` covers US2-1 … US2-5:
  - `TAMIZ_MCP_TOOLS=simulate_routing,get_provider_health` lists two tools, and calling
    `query_audit_log` is an unknown-tool error with nothing recorded;
  - `loadConfig` with `nope` fails naming `nope`;
  - calling every tool records only `POST /v1/simulate` and `GET /v1/admin/*`, and every
    tool has `idempotentHint: true`, `destructiveHint: false`, `openWorldHint: false`;
  - `no-key.ts` over a full session with successes and failures;
  - stdio config without `TAMIZ_MCP_GATEWAY_KEY` fails naming the variable.
- [x] T006 [US4] `mcp/test/transport-http.test.ts` covers US4-2 … US4-5:
  - the Hono app from `transports/http.ts` is called in process through
    `StreamableHTTPClientTransport` with a custom `fetch` that calls `app.fetch`;
  - the bearer value reaches the fake gateway, and nothing is cached across requests;
  - no `Authorization` gives `401` and nothing recorded;
  - `Host: evil.example` or `Origin: https://evil.example` gives `403`;
  - two clients with different keys call concurrently, and each recorded request carries
    its own key.
- [x] T007 [US4] `mcp/test/transport-stdio.test.ts` covers US4-1:
  - the fake gateway is served on `@hono/node-server` port 0;
  - `StdioClientTransport` spawns `node mcp/dist/main.js` with the env;
  - list and call `get_provider_health`;
  - the child's stderr holds JSON log lines, and every stdout line is a JSON-RPC message
    (checked by a transport wrapper that parses each line);
  - the test is skipped with a clear message if `dist/` is missing (the root `pnpm test`
    builds first).

### Implementation

- [x] T008 `contracts/src/mcp.ts` (data-model 1.1, 1.2, 1.4): `McpToolNameSchema`,
  `MCP_TOOL_NAMES`, the four input schemas built from `AuditQuerySchema.shape`,
  `CostQuerySchema` and `ChatMessageSchema`, `McpToolErrorCodeSchema`, `McpToolErrorSchema`
  and their types; export them from `contracts/src/index.ts`.
- [x] T009 Make `mcp/` the `@tamiz/mcp-server` package:
  - `package.json`: private, ESM; bin `tamiz-mcp` → `dist/main.js`; scripts `build`,
    `typecheck`, `test`, `start:http`, `agent:demo`;
  - dependencies per plan "Technical Context", with versions from research R-01; check the
    `@modelcontextprotocol/hono` peer range and record the result;
  - `tsconfig.json`, `tsconfig.build.json`, `vitest.config.ts`;
  - register the project in the root `vitest.config.ts` and turbo.
- [x] T010 [P] `mcp/src/config.ts`: the Zod env of data-model section 3, `loadConfig(env,
  argv)`, failing with the variable's name. `mcp/src/logger.ts`: pino to file descriptor 2,
  redacting `authorization`, `*.authorization` and `*.key`.
- [x] T011 [P] `mcp/src/gateway-client.ts` (research R-07):
  - `createGatewayClient({ baseUrl, key, timeoutMs, fetch })` with `simulate`, `providers`,
    `audit` and `cost`;
  - each sets the bearer and `x-request-id: mcp-<uuid>`, applies an abort timeout, builds the
    query string without `undefined`, parses with the contract and maps failures to the
    seven codes;
  - it returns `Result<T, ToolError>` and never puts headers in messages.
- [x] T012 `mcp/src/tools/definition.ts` (`ToolDefinition`, `toToolResult`,
  `toToolError`), `simulate-routing.ts`, `get-provider-health.ts` (descriptions verbatim
  from `contracts/tools.md`), and `registry.ts` (`ALL_TOOLS`, `selectTools(allowlist)`).
- [x] T013 `mcp/src/server.ts`: `createMcpServer({ tools, gateway, version })` registers each
  selected tool with `registerTool(name, { title, description, inputSchema, outputSchema,
  annotations })`, with the four fixed annotations. Check how the SDK treats `isError`
  results with an `outputSchema` (research R-07) and pin it in T004.
- [x] T014 `mcp/src/transports/stdio.ts`, `mcp/src/transports/http.ts` (research R-05:
  `createMcpHonoApp({ host, allowedHosts })`, the bearer middleware, a server and a
  `WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined })` per request,
  `405` for `GET`/`DELETE`), and `mcp/src/main.ts` (the composition root; exit 1 on
  configuration errors).
- [x] T015 `.dependency-cruiser.cjs`: the rule `mcp-agent-isolated`, so nothing in
  `apps/mcp-server/src` outside `agent/` imports `apps/mcp-server/src/agent/`. Add
  `apps/mcp-server/src` to the root `arch` script.
- [x] T016 Gates (`pnpm lint`, `typecheck`, `arch`, `test`, `build`). Run quickstart §3–§5
  by hand against a local gateway. Update `mcp/README.md` (status, how to run). Write the
  task record and set the backlog row.

---

## Phase 2: `T-009-03` — `query_audit_log`, `get_cost_report`, README (US3, US4-6)

**Goal**: the two tools that carry the demo question, and the connection recipe.
**Independent test**: T017 and T018 pass; quickstart §6 in a real host.

### Tests first

- [ ] T017 [P] [US3] `mcp/test/tools-audit-cost.test.ts` covers US3-1 … US3-5:
  - all seven filters plus `cursor` are recorded exactly as the gateway query, with
    `undefined` fields absent;
  - the page parses with `AuditPageSchema`;
  - passing `nextCursor` returns the fixture's second page;
  - no `limit` records `limit=20`, and `limit: 51` is invalid input with nothing recorded;
  - `get_cost_report` for each `groupBy` parses with `CostReportSchema`;
  - a fixture entry with an extra `prompt` field gives `gateway_contract`.
- [ ] T018 [P] [US4] `mcp/test/readme.test.ts` covers US4-6. It extracts the blocks between
  `<!-- mcp-config:start -->` and `<!-- mcp-config:end -->` in `mcp/README.md` and checks:
  - the Claude Desktop JSON parses, runs `node` with `.../apps/mcp-server/dist/main.js`, and
    its `env` keys are documented variables;
  - the Claude Code commands name the same entry and the HTTP URL;
  - every key value is the placeholder `tamiz_admin_key_here`.

### Implementation

- [ ] T019 `mcp/src/tools/query-audit-log.ts` and `get-cost-report.ts`, with descriptions
  verbatim from `contracts/tools.md`; add both to `ALL_TOOLS`.
- [ ] T020 `mcp/README.md`, following `contracts/configuration.md`:
  - purpose, tools table, environment table;
  - the snippets between markers (Claude Desktop, Claude Code stdio and HTTP, a Windows path
    note);
  - choosing tools with a client key, and the simulation-text caveat.
- [ ] T021 `CLAUDE.md` §12 (`pnpm --filter @tamiz/mcp-server start:http`, the inspector
  command). Gates; quickstart §6 in Claude Desktop or Claude Code, recorded. Task record and
  backlog row.

---

## Phase 3: `T-009-04` — Dogfooding agent (US5)

**Goal**: the agent answers the spend question through Tamiz. **Independent test**: T022
and T023 pass with scripted model answers; T030 records the real run.

### Tests first

- [ ] T022 [P] [US5] `mcp/test/agent-action.test.ts` checks `extractAction` (research R-10,
  data-model 4.1):
  - a bare object, an object in a ```` ```json ```` fence, an object after prose;
  - `{"answer": ""}` (fails, `min(1)`), two objects (the first wins), no JSON, a JSON array;
  - `arguments` default `{}` (part of US5-3).
- [ ] T023 [US5] `mcp/test/agent.test.ts` covers US5-1 … US5-5. It uses the in-process MCP
  pair, `createMCPClient({ transport: <InMemoryTransport half> })`, the fake gateway serving
  the admin fixtures and scripted chat answers, and a fixed clock (2026-10-31):
  - **US5-1.** The scripted model asks for the daily cost, then the route cost for each day,
    then answers. The recorded admin calls are `get_cost_report` with the expected UTC
    ranges, and the answer contains the route id and both amounts.
  - **US5-2.** Every chat request has the client key and `model: "tamiz-local"`, and its body
    parses with `ChatCompletionRequestSchema`. No other host is called: the fetch spy allows
    only the fake.
  - **US5-3.** An unknown tool, invalid arguments and a prose answer each produce the
    observation text of `contracts/agent-protocol.md`, and the run continues. Six
    non-answers give `stopReason: "step_limit"`.
  - **US5-4.** A scripted 451 `policy_blocked` (or 502 `provider_error`) gives `stopReason:
    "gateway_error"` with the type and request id, and no further calls.
  - **US5-5.** The run record has `promptVersion: "system.v1"`, `today: "2026-10-31"`,
    the steps with arguments, and `requestIds` equal to the fake's `x-request-id`s. The
    first system message contains `2026-10-31`.

### Implementation

- [ ] T024 [P] `mcp/src/agent/action.ts`: `AgentActionSchema` (data-model 4.1) and
  `extractAction`.
- [ ] T025 [P] `mcp/src/agent/gateway-model.ts`: `createOpenAICompatible({ name: "tamiz",
  baseURL: <gateway>/v1, apiKey })`. If T023's body check fails on an extra field, switch
  the model call to `fetch` plus the contract (research R-09 risk), and record which path
  was taken.
- [ ] T026 [P] `mcp/src/agent/prompts/system.v1.md` (research R-11: answer only from tool
  results; the spend recipe; UTC days with `from` inclusive and `to` exclusive; the one-object
  JSON format; the `{{today}}` and `{{tools}}` placeholders). The build copies `prompts/` to
  `dist/agent/prompts/`.
- [ ] T027 `mcp/src/agent/run-agent.ts`: `runAgent({ question, model, mcpTools, now,
  maxSteps = 6, observationLimit = 8000 })`, implementing the loop of data-model 4.3 and the
  messages of `contracts/agent-protocol.md`. It returns an `AgentRun` and calls
  `generateText` with `temperature: 0, maxRetries: 0`.
- [ ] T028 `mcp/src/agent/demo.ts` and the `agent:demo` script. It reads the agent variables
  of data-model section 3, connects with `createMCPClient({ transport: { type: "http", url,
  headers: { Authorization: "Bearer …" } } })`, runs one question, prints the answer and the
  run record as JSON, closes the client in `finally`, and exits 0 when answered, 1 otherwise.
- [ ] T029 `mcp/demo/seed-audit.sql`: synthetic, content-free audit rows for the two days
  before today, relative to `now()`, with columns taken from the gateway's Drizzle schema
  (`apps/gateway/src/infrastructure/persistence/`). Yesterday's cost on one route is about
  twice the day before's. The file uses fixed UUIDs and a fixed `request_hash` value of 64
  hex characters, and runs again cleanly (`on conflict do nothing`).
- [ ] T030 [US5] Run quickstart §7 (US5-6, SC-004) against the real stack, with Ollama
  `llama3.1:8b`. Record in the task record:
  - the transcript and the run record;
  - the audit query showing one `pinned-local` entry on `ollama-llama` per request id.

  If the local model cannot follow the format within 6 steps, record that, and try
  `qwen2.5:3b` through a policy override. Do not raise the step limit silently.
- [ ] T031 Polish:
  - the README status line (009);
  - `docs/architecture.md`: the MCP server and the agent in the system view, with the
    agent's calls through the gateway;
  - `CLAUDE.md` §12 (`agent:demo`);
  - gates;
  - the task record and the backlog row.

---

## Dependencies

```text
T-009-02 ──▶ T-009-03 ──▶ T-009-04
```

- Within a phase: tests first, then implementation; `[P]` tasks touch different files.
- T008 (contracts) blocks T011–T013.
- T002 (harness) blocks T003–T007, T017 and T023.

## Parallel examples

- **Phase 1:** T001 and T002 together. Then T010 and T011 together, while T003–T005 are
  being written against the harness.
- **Phase 2:** T017 and T018 together.
- **Phase 3:** T022, T024, T025 and T026 together, before T027.

## Totals

| Phase | Backlog | Tasks |
|---|---|---|
| 1 | `T-009-02` | T001–T016 (16) |
| 2 | `T-009-03` | T017–T021 (5) |
| 3 | `T-009-04` | T022–T031 (10) |
| **Total** | | **31** |

## Implementation strategy

- **MVP.** `T-009-02` alone is a usable server (simulation and provider health) from any MCP
  host.
- **The demo question.** `T-009-03` adds the data it needs, and the README makes the server
  usable by others.
- **Cut order.** `T-009-04` is the first thing to cut if the roadmap runs late (`CLAUDE.md`
  §11). The tools stand without it.
