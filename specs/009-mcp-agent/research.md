# Research: MCP Server and Agent

**Feature**: `009-mcp-agent` · **Date**: 2026-10-31

Decisions taken for the plan. Each one names what was chosen, why, and what else was
considered. The ones flagged **(review)** are listed in the `T-009-01` task record for
Alex. Library APIs were checked on 2026-10-31 with Context7 (MCP TypeScript SDK v2.4.0 and
1.32.2 docs, AI SDK docs) and against the published packages (`npm view`, and the type
declarations of `@ai-sdk/mcp@1.0.100` and `ai@6.0.320`).

## R-01 Versions

| Package | Version | Role | Notes |
|---|---|---|---|
| `@modelcontextprotocol/server` | 2.4.0 (`latest`, 2026-10-23) | `McpServer`, `registerTool`, `StdioServerTransport` (`/stdio` subpath), `WebStandardStreamableHTTPServerTransport` | Depends on `zod ^4.2.0` (the catalog has 4.6.x); Node ≥ 20. |
| `@modelcontextprotocol/client` | 2.4.0 | Tests: `Client`, `InMemoryTransport`, `StdioClientTransport` (`/stdio`), `StreamableHTTPClientTransport` | Dev dependency only. |
| `@modelcontextprotocol/hono` | 2.0.2 | `createMcpHonoApp` (Host and Origin validation) | If its peer range does not accept server 2.4, `T-009-02` uses its `hostHeaderValidation` alone or an equivalent 20-line middleware; recorded in the task record. |
| `ai` | 6.0.320 (dist-tag `ai-v6`) | `generateText` for the agent's model calls | `latest` is 7.0.x; the stack pins AI SDK 6 (`CLAUDE.md` §4) and the gateway uses `^6.0.319`. |
| `@ai-sdk/mcp` | 1.0.100 (dist-tag `ai-v6`) | `createMCPClient`, `tools()` | `latest` (2.0.x) depends on provider-utils 5, which is AI SDK 7. |
| `@ai-sdk/openai-compatible` | 2.x (as the gateway, `^2.0.88`) | The gateway as the agent's model provider | `latest` (3.0.x) is AI SDK 7. |
| `hono`, `@hono/node-server`, `pino`, `zod` | as the gateway | HTTP transport, logs, schemas | Same versions through the workspace. |

**Decision**: the v2 MCP SDK, split packages. The agent stays on AI SDK 6 with the matching
`ai-v6` releases of its MCP and provider packages.

**Rationale**: v2 is the current line of the official SDK: it takes Zod v4 schemas directly
(Standard Schema), ships a web-standard streamable HTTP transport that fits Hono, and its
docs cover in-memory testing. AI SDK 6 matches the gateway and the project stack; mixing
AI SDK 7 packages into the workspace would duplicate the provider layer.

**Alternatives**:
- `@modelcontextprotocol/sdk` 1.32.2: still maintained (`latest` of the old package), but in
  maintenance; its Zod support goes through shapes and its HTTP transport is Node-specific;
- AI SDK 7: the newest, but a stack change for one app, outside this feature.

**Protocol versions**: the SDK negotiates with each host, including the stateless
2026-07-28 revision and the earlier `initialize` handshake; `@ai-sdk/mcp` supports both.
Nothing in this feature depends on a revision-specific feature.

## R-02 Tool contracts live in `@tamiz/contracts` and reuse the admin schemas

**Decision**: a new module `packages/contracts/src/mcp.ts` holds:
- `McpToolNameSchema` (the four names) and `MCP_TOOL_NAMES`;
- the four input schemas:
  - `SimulateRoutingInputSchema`: `text` (1 … 32 000 characters) or `messages`
    (`ChatMessageSchema[]`, at least one), exactly one of them, and an optional `model`;
  - `QueryAuditLogInputSchema`: the `AuditQuerySchema` filters with `limit` re-declared as
    `1 … 50`, default 20;
  - `GetCostReportInputSchema`: the `CostQuerySchema` fields;
  - `GetProviderHealthInputSchema`: `windowMinutes` `1 … 1440`, default 15;
- `McpToolErrorCodeSchema` and `McpToolErrorSchema` (`{ error: { code, message } }`).

The output schemas are the existing `SimulateResponseSchema`, `AuditPageSchema`,
`CostReportSchema` and `ProvidersReportSchema`, unchanged.

**Rationale**: constitution II names MCP tools as public contracts. Reusing the admin
schemas means a change to an admin endpoint changes the tool, and the contract tests catch
a mismatch. The admin query schemas coerce strings (they parse query strings); MCP inputs
are JSON, so numeric fields are re-declared as plain integers to give hosts a clean JSON
Schema.

**Alternatives**:
- schemas inside `apps/mcp-server`: against constitution II, and invisible to the dashboard
  or other clients;
- `oneOf` for the simulation input: models handle optional fields with a stated rule better
  than JSON Schema unions. The "exactly one" rule is a Zod refinement the server enforces;
  the JSON Schema shows both fields as optional and the description states the rule.

## R-03 One small app, flat modules, the gateway behind an injectable `fetch`

**Decision**: `apps/mcp-server` (`@tamiz/mcp-server`, private, ESM) with flat modules:
`config.ts`, `logger.ts`, `gateway-client.ts`, `tools/*`, `server.ts`, `transports/*`,
`main.ts` (composition root) and `agent/*` (plan, "Project Structure"). The gateway client
takes a `fetch` function; tests pass a fake gateway's `app.fetch`.

**Rationale**: the server is an adapter over four HTTP calls; gateway-style layers would be
ceremony (constitution X). The one seam tests need is the gateway, and an injectable
`fetch` gives it without a port. The app depends only on `@tamiz/contracts` among workspace
packages, so it cannot import gateway code.

**Alternatives**: Clean Architecture layers with a `GatewayPort`. That pays off with a
second adapter, and there is none.

## R-04 Who holds the key **(review)**

**Decision**:
- **Local transport**: the server reads `TAMIZ_MCP_GATEWAY_KEY` from its environment (the
  host's `env` block in the Claude Desktop or Claude Code configuration) and refuses to
  start without it. One admin key serves all four tools: `/v1/simulate` accepts admin keys.
- **HTTP transport**: the server holds no key. Each request's `Authorization: Bearer` value
  is forwarded to the gateway for that request's tool calls and dropped afterwards; a
  request without one gets `401`.
- **Never echoed**: tool errors are built from codes and the gateway's error message, never
  from request headers; pino redacts `authorization` and `*.key`; tests search every
  output for the key (SC-003).
- **No probe at start**: the server does not call the gateway when it starts, because hosts
  launch servers eagerly and the gateway may be down. A client key with admin tools enabled
  gives `gateway_forbidden` per call.

**Rationale**: on a shared HTTP server, a stored admin key would give admin reads to anyone
who can reach the server. Forwarding the caller's own key keeps the gateway as the only
authority on roles. On the local transport the operator's own key lives in their own host
configuration, the usual place for MCP server secrets.

**Alternatives**:
- a separate MCP access token plus a stored admin key: a second credential system to
  manage;
- MCP OAuth authorization: the right answer for a hosted product, far beyond this feature;
- a key per tool: no need while every tool is read-only and all read the same admin data.

## R-05 Transports: stdio, and stateless streamable HTTP on Hono

**Decision**:
- **stdio**: `StdioServerTransport`. Logs go to standard error (pino destination `2`),
  because standard output is the protocol channel.
- **HTTP**: a Hono app built with `createMcpHonoApp({ host, allowedHosts })`, served by
  `@hono/node-server`, on `127.0.0.1:3100` by default (the gateway is on 3000).
  - `POST /mcp` (and `GET`/`DELETE`, which answer `405` in stateless mode as the SDK does);
  - a bearer middleware runs first (`401` without a token);
  - then, per request, a new `McpServer` with tools bound to that request's key, and a
    `WebStandardStreamableHTTPServerTransport` with `sessionIdGenerator: undefined`.
- **Selection**: `TAMIZ_MCP_TRANSPORT=stdio|http` (default `stdio`), or the
  `--transport` flag of the `tamiz-mcp` binary.

**Rationale**: the tools hold no state between calls, so stateless mode is the simplest
deployment (any instance answers any request), and a server per request makes key
isolation structural (US4-5). Hono matches the gateway; the SDK's Hono helper brings the
DNS rebinding protection the MCP specification asks local servers to have.

**Alternatives**: stateful sessions (session ids, an in-memory map): needed only for
server-to-client notifications or resumability, which no tool uses. The deprecated SSE
transport: not offered.

## R-06 Permission per tool is an allowlist; every tool is read-only **(review)**

**Decision**:
- `TAMIZ_MCP_TOOLS` is a comma-separated allowlist, default all four; parsed with
  `McpToolNameSchema`, so an unknown name stops the server at start and is named.
- Disabled tools are never registered: they are not listed, and the SDK answers a call to
  them as an unknown tool, without running anything.
- Every tool is registered with the annotations `readOnlyHint: true`,
  `destructiveHint: false`, `idempotentHint: true`, `openWorldHint: false`.
- Each tool definition declares the one gateway call it makes; a test asserts that the
  methods and paths are only `GET /v1/admin/*` and `POST /v1/simulate`.

**Rationale**: four switches do not need a permission file. "Read-only by default" is true
by construction: no tool writes. Asking the user before each call is the host's job (Claude
Desktop and Claude Code ask, and the annotations inform them).

**Alternatives**: a YAML permission file with per-tool roles. Speculative while no write
tool exists; a future write tool gets its own spec and defaults to disabled.

## R-07 Gateway calls and tool errors

**Decision**: `gateway-client.ts` has one function per endpoint. Each one:
- builds the request: the query string from the validated input, dropping `undefined`
  (`exactOptionalPropertyTypes`, as the gateway's own route does);
- sets `Authorization` and `x-request-id`;
- applies `TAMIZ_MCP_TIMEOUT_MS` (default 10 000) with an `AbortSignal`;
- parses the body with the contract;
- returns `Result<T, ToolError>`.

Errors map to the codes of FR-007:

| Condition | Code |
|---|---|
| `fetch` rejects | `gateway_unreachable` |
| timeout | `gateway_timeout` |
| 401 | `gateway_unauthorized` |
| 403 | `gateway_forbidden` |
| other 4xx | `gateway_rejected` (message from the gateway's error envelope) |
| 5xx | `gateway_error` |
| body fails the contract | `gateway_contract` |

A tool error is returned as a tool result with `isError: true` and text content
`{"error":{"code","message"}}` (`McpToolErrorSchema`), with no `structuredContent`.

**Rationale**: MCP tool errors are results, so the model can see them and react; protocol
errors are for unknown tools and invalid input, which the SDK already produces (US1-5,
US2-1). Parsing with the contract is what makes "never unvalidated data" true.

**To verify in `T-009-02`**: the SDK skips output-schema validation for `isError` results;
if it does not, the error result carries no output and the test pins the behaviour.

## R-08 Tool results: structured value plus compact JSON text

**Decision**: a successful call returns `structuredContent` (the parsed contract value) and
one text content with the same value as compact JSON.

**Rationale**: hosts that read structured output use it; older hosts and models read the
text. Compact JSON keeps audit pages small in an assistant's context.

**Alternatives**: a human-formatted summary as text. That duplicates formatting logic and
loses fields; the model formats for the user.

## R-09 The agent: AI SDK 6, `@ai-sdk/mcp`, the gateway as an OpenAI-compatible provider

**Decision**:
- **MCP client**: `createMCPClient` from `@ai-sdk/mcp`, with `transport: { type: 'http',
  url, headers }` against the server's HTTP transport, or any MCP transport object. The
  tests pass an `InMemoryTransport` of `@modelcontextprotocol/client` (it has the
  `start`/`send`/`close`/`onmessage` shape `MCPTransport` expects). `tools()` gives each
  tool's description, its JSON input schema and an `execute` function.
- **Model**: `createOpenAICompatible({ name: 'tamiz', baseURL: '<gateway>/v1', apiKey })`
  with the model id from `TAMIZ_AGENT_MODEL` (default `tamiz-local`).
- **Model calls**: `generateText({ model, messages, temperature: 0, maxRetries: 0 })`. The
  gateway owns retries and fallbacks; retrying in the agent would double them.
- **Request ids**: the agent reads `x-request-id` from each response (`response.headers`)
  for its run record.
- **The loop**: the agent's own tool loop (R-10), not `ToolLoopAgent`.

**Rationale**: the stack's choice (foundational document §3: AI SDK agents plus MCP client),
with the gateway as just another OpenAI-compatible endpoint: this is the dogfooding.

**Risk, checked in `T-009-04`**: the provider must send only fields the gateway's strict
request contract accepts (`model`, `messages`, `temperature`, `max_tokens`, `stream`,
`stream_options`, `user`). The fake gateway parses every body with
`ChatCompletionRequestSchema`, so an extra field fails US5-2. If it does, the agent calls
the gateway with `fetch` and the contract, as `packages/evals` does, and the MCP client
stays on AI SDK.

## R-10 The agent's tool protocol is text **(review)**

> **Superseded as the default by `T-009-05`** (`specs/009-mcp-agent/tool-calling/`, research
> T-R14): the gateway now carries OpenAI function tools, and the agent uses them natively by
> default. This text protocol stays available with `TAMIZ_AGENT_TOOL_PROTOCOL=text`.

**Decision**: the gateway's chat completion contract rejects `tools`, `tool_choice`, tool
messages and `response_format` (`packages/contracts/src/chat-completion.ts`). So the agent
uses a prompted protocol:

- **The system prompt** lists each tool: name, description and JSON input schema, from the
  MCP tool list.
- **The model's answer** is exactly one JSON object:
  - `{"tool": "<name>", "arguments": {…}}` to call a tool;
  - `{"answer": "<text>"}` to finish.
- **Reading the answer.** The agent takes the first JSON object in the text (inside a code
  fence or not) and parses it with `AgentActionSchema`. Then:
  - a tool not in the list, a parse failure or a tool error becomes an observation;
  - arguments are validated by the MCP server, whose invalid-input error becomes an
    observation.
- **Observations** go back as user messages, prefixed `Observation (<tool>):`, since there
  is no tool role. They are truncated at 8 000 characters, with a note.
- **Step limit.** 6 model calls; then the run stops with `stopReason: "step_limit"`.

**Rationale**: it works with the gateway as it is and with small local models (Qwen 2.5 and
Llama 3.1 follow a one-object JSON format reliably at temperature 0). Every byte the model
sees still goes through the gateway's inspection.

**Alternatives**:
- **native tool calling through the gateway**: the right long-term answer, but it changes
  the chat contract, the provider port and four adapters, and needs the privacy inspection
  and anonymization of tool calls and results. Proposed as a separate backlog task
  (`T-009-05`, optional), not part of this feature;
- **calling the admin API directly and asking the model only to summarize**: simpler, but
  then the agent chooses nothing and the MCP tools are not exercised.

## R-11 Versioned prompt and an injectable clock

**Decision**:
- **The prompt file.** `apps/mcp-server/src/agent/prompts/system.v1.md` has two
  placeholders, `{{today}}` (UTC date, `YYYY-MM-DD`) and `{{tools}}`. Its version is its
  file name (`system.v1`), recorded in each run. The build copies `prompts/` to `dist/`.
- **What the prompt says.**
  - Answer only from tool results.
  - For "why did spend change", compare `get_cost_report` by day for the two days, then
    group by route or model for each day, then name the largest difference with both
    amounts.
  - Dates are UTC days, `from` inclusive and `to` exclusive.
- **The clock.** `runAgent` takes `now: () => Date`. The demo uses the system clock; tests
  use a fixed date.

**Rationale**: `CLAUDE.md` §8 ("system prompts are versioned files"); a fixed clock makes
"yesterday" deterministic in tests (constitution VIII).

## R-12 Testing: in-process MCP client, a fake gateway as a Hono app

**Decision** (Vitest, no network except where a transport needs a socket):
- **Fake gateway.** `test/support/fake-gateway.ts` is a Hono app with the four admin and
  simulate routes and `POST /v1/chat/completions`. It:
  - checks the bearer key and parses queries and bodies with the real contracts;
  - records each request;
  - answers from scripted fixtures that are themselves parsed with the response contracts.
- **In-process server tests.** `InMemoryTransport.createLinkedPair()` from
  `@modelcontextprotocol/client`, a `Client` and the server from `createMcpServer`, with the
  gateway client's `fetch` set to the fake's `app.fetch` (US1, US2, US3).
- **HTTP transport.** The Hono app is called in process: `StreamableHTTPClientTransport`
  with a custom `fetch` that calls `app.fetch`, so bearer, Host and Origin checks run with no
  socket (US4-2 … US4-5).
- **stdio.** One test spawns the built `dist/main.js` with `StdioClientTransport`, and the
  fake gateway runs on `@hono/node-server` on port 0 (US4-1). It runs after `turbo build`, as
  the root `pnpm test` already does.
- **README.** A test extracts the fenced snippets between
  `<!-- mcp-config:start -->` / `<!-- mcp-config:end -->` and checks them (US4-6).
- **Agent.** The same in-process MCP pair, and the fake gateway scripting the model's
  answers per step (US5-1 … US5-5).
- **Key leak check.** A shared helper collects the tool lists, results, errors and the
  captured log stream, and asserts the test key is absent (US2-4, SC-003).

**Rationale**: it is the backlog's definition of done ("an in-process MCP client and a
fake gateway"). Using the real contracts on both sides of the fake makes it a contract test
too.

**Alternatives**: MSW for the gateway. It works, but a Hono fake can serve the stdio test
over a real port with the same code, and the gateway already uses Hono.

## R-13 Architecture limits

**Decision**: no dependency-cruiser rules for this app. Its `package.json` lists only
`@tamiz/contracts` among workspace packages, so pnpm will not resolve an import of gateway
code. A one-line rule keeps `src/agent/` out of the server side: nothing outside
`src/agent/` imports from it. It is added to `.dependency-cruiser.cjs`, and the `arch`
script cruises `apps/mcp-server/src` too.

**Rationale**: the server must run without the agent's dependencies in the picture (the
agent is a client of the server, not part of it). The rest is enforced by the package
manager.

## R-14 What the demo proves, and how it is recorded

**Decision**: `pnpm --filter @tamiz/mcp-server agent:demo -- "why did spend rise
yesterday?"` runs against a gateway with the default policy, the Postgres audit log, the
privacy service, and Ollama with `llama3.1:8b` (the `ollama-llama` target).

**Seeding.** The gateway cannot backdate traffic, so the demo history is a SQL fixture,
`apps/mcp-server/demo/seed-audit.sql`. It inserts synthetic, content-free audit entries for
the day before yesterday and yesterday, relative to `now()`, with yesterday's spend on one
route about twice the day before's. It is applied with `psql` to the gateway's Postgres
(`docker compose up postgres`). The agent's own calls then add today's entries with rule
`pinned-local`.

The `T-009-04` record holds:
- the transcript;
- the run record;
- `GET /v1/admin/audit?rule=pinned-local` showing the agent's calls.

**Rationale**: SC-004 needs a real run; the audit entries are the proof that the agent's
calls went through Tamiz on the local route.
