# apps/mcp-server

The Tamiz MCP server (`@tamiz/mcp-server`). It exposes the gateway's simulation and admin
reads as MCP tools, so an operator can ask an AI assistant (Claude Desktop, Claude Code, any
MCP host) what Tamiz would do, what happened, what it cost and how providers are doing.

- **Read-only.** No tool changes anything in the gateway.
- **Permissions per tool.** An allowlist decides which tools are exposed.
- **The key stays with the server.** It never reaches the assistant or its model.

The server is built on the official MCP TypeScript SDK v2 (`@modelcontextprotocol/server`
2.4.0) and runs over stdio or stateless streamable HTTP. Feature `009-mcp-agent`. A small
dogfooding agent ships with it (see [Agent](#agent)).

## Tools

Every tool is annotated `readOnlyHint`, `idempotentHint`, `destructiveHint: false` and
`openWorldHint: false`, and makes exactly one gateway call. Inputs and outputs are the
shared contracts (`packages/contracts/src/mcp.ts` and the admin and simulate schemas).

| Tool | Gateway call | Key | What it returns |
|---|---|---|---|
| `simulate_routing` | `POST /v1/simulate` | client or admin | What a request would do: detected kinds and positions (never values), rule, privacy action, chain. No model is called. Give `text` or `messages`, and optionally `model`. |
| `query_audit_log` | `GET /v1/admin/audit` | admin | Routing decisions, newest first, filtered by `from`/`to`, `route`, `rule`, `sensitivity`, `action`, `entity`, `outcome`. Pages of 1–50 entries (default 20); pass `nextCursor` back as `cursor` for the next page. Metadata only. |
| `get_cost_report` | `GET /v1/admin/cost` | admin | Spend in `[from, to)` grouped by UTC `day`, `route` or `model`, with the "everything to the most expensive target" baseline, blocked and failed counts, and totals. |
| `get_provider_health` | `GET /v1/admin/providers` | admin | Circuit state of every target, with requests, error rate and p50/p95 latency over `windowMinutes` (1–1440, default 15). |

When the gateway fails, the tool result has `isError: true`, and its text is
`{"error":{"code","message"}}` with one of these codes:

- `gateway_unreachable`;
- `gateway_timeout`;
- `gateway_unauthorized` (401);
- `gateway_forbidden` (403, a client key on an admin tool);
- `gateway_rejected` (other 4xx, with the gateway's message);
- `gateway_error` (5xx);
- `gateway_contract` (an answer outside the contract).

## Environment

| Variable | Default | Rule |
|---|---|---|
| `TAMIZ_MCP_GATEWAY_URL` | `http://localhost:3000` | The gateway's base URL. |
| `TAMIZ_MCP_GATEWAY_KEY` | — | Required on stdio, where it is the Tamiz key for every tool call. Ignored on HTTP, with a warning. |
| `TAMIZ_MCP_TOOLS` | all four | A comma-separated allowlist. An unknown name stops the server, which names it. |
| `TAMIZ_MCP_TIMEOUT_MS` | `10000` | The gateway call timeout (100 … 120 000). |
| `TAMIZ_MCP_SIMULATE_MODEL` | `auto` | The model `simulate_routing` sends when none is given. |
| `TAMIZ_MCP_TRANSPORT` | `stdio` | `stdio` or `http`. The `--transport` flag wins. |
| `TAMIZ_MCP_HTTP_HOST` | `127.0.0.1` | The HTTP bind address. |
| `TAMIZ_MCP_HTTP_PORT` | `3100` | The HTTP port. |
| `TAMIZ_MCP_ALLOWED_HOSTS` | — | Comma-separated host names for `Host` and `Origin` validation. Required when the bind address is not local. |
| `LOG_LEVEL` | `info` | pino levels. Logs are JSON lines, always on stderr. |

The server exits with status 1 and the reason on stderr when the configuration is invalid.
It does not call the gateway at start, so a host can launch it while the gateway is down.

## Connect a host

Build once: `pnpm --filter @tamiz/mcp-server build`. Use an **admin** key for the admin
tools; create one with `pnpm --filter @tamiz/gateway api-key:add <client> --admin`, or with
`generate-api-key` and `TAMIZ_ADMIN_API_KEYS`. Replace `/path/to/tamiz` with your checkout.

<!-- mcp-config:start -->

**Claude Desktop**: add this to `claude_desktop_config.json`.

```json
{
  "mcpServers": {
    "tamiz": {
      "command": "node",
      "args": ["/path/to/tamiz/apps/mcp-server/dist/main.js"],
      "env": {
        "TAMIZ_MCP_GATEWAY_URL": "http://localhost:3000",
        "TAMIZ_MCP_GATEWAY_KEY": "tamiz_admin_key_here",
        "TAMIZ_MCP_TOOLS": "simulate_routing,query_audit_log,get_cost_report,get_provider_health"
      }
    }
  }
}
```

**Claude Code**, local process (stdio):

```bash
claude mcp add tamiz -e TAMIZ_MCP_GATEWAY_URL=http://localhost:3000 -e TAMIZ_MCP_GATEWAY_KEY=tamiz_admin_key_here -- node /path/to/tamiz/apps/mcp-server/dist/main.js
```

**Claude Code**, shared server over HTTP (started with
`pnpm --filter @tamiz/mcp-server start:http`). Each user sends their own key:

```bash
claude mcp add --transport http tamiz http://127.0.0.1:3100/mcp --header "Authorization: Bearer tamiz_admin_key_here"
```

<!-- mcp-config:end -->

On Windows, write the JSON path with escaped backslashes:
`"C:\\path\\to\\tamiz\\apps\\mcp-server\\dist\\main.js"`. Forward slashes also work for
`node`.

Then ask the assistant, for example, "is any Tamiz provider failing?". The host asks for
permission before it calls `get_provider_health`.

## HTTP transport

```bash
pnpm --filter @tamiz/mcp-server start:http      # POST http://127.0.0.1:3100/mcp
```

- **Stateless.** There is no `Mcp-Session-Id`, and `GET` and `DELETE` answer `405`.
- **A bearer key on every request.** `Authorization: Bearer <Tamiz key>` is required; a
  request without it gets `401` with `WWW-Authenticate: Bearer` before any tool runs. The
  key is forwarded to the gateway for that request only and never stored, so the gateway
  decides what each caller may read.
- **`Host` and `Origin` are validated** (DNS rebinding protection). Local names are allowed
  by default; set `TAMIZ_MCP_ALLOWED_HOSTS` when you bind elsewhere. A mismatch gets `403`.

## Choosing the tools

- With a **client** key, expose only the simulation:
  `TAMIZ_MCP_TOOLS=simulate_routing`. The admin tools would answer `gateway_forbidden` on
  every call.
- To keep the audit log away from assistant users, leave it out of the allowlist:
  `TAMIZ_MCP_TOOLS=simulate_routing,get_cost_report,get_provider_health`.

A disabled tool is not listed, and calling it is an unknown-tool error.

## Caveat: simulation text in a cloud-hosted assistant

Text you give `simulate_routing` from a cloud-hosted assistant has already reached that
assistant's model before the tool runs, and Tamiz cannot prevent that. Simulate with
synthetic text (for example a made-up DNI), or from a local host. The other tools return
metadata only: kinds, counts, costs and targets, never message text or detected values.

## Agent

`src/agent/` is a small agent built with AI SDK 6 and the `@ai-sdk/mcp` client. It
answers operational questions with the tools. Its own model calls go **through Tamiz**:
every call is a normal `POST /v1/chat/completions` with the agent's client key and the
model `tamiz-local`, which the default policy pins to the local route (`pinned-local`). The
gateway inspects, routes and audits it like any request, and the agent holds no provider
key.

```bash
pnpm --filter @tamiz/mcp-server start:http      # the server, in another terminal
TAMIZ_AGENT_API_KEY=<client key> TAMIZ_AGENT_MCP_KEY=<admin key>   pnpm --filter @tamiz/mcp-server agent:demo -- "why did spend rise yesterday?"
```

| Agent variable | Default | |
|---|---|---|
| `TAMIZ_AGENT_GATEWAY_URL` | `http://localhost:3000` | Where the model calls go. |
| `TAMIZ_AGENT_API_KEY` | — | Required: a client key for the model calls. |
| `TAMIZ_AGENT_MODEL` | `tamiz-local` | The requested model. |
| `TAMIZ_AGENT_TOOL_PROTOCOL` | `native` | `native` tool calls, or `text` for models without tool support. |
| `TAMIZ_AGENT_MCP_URL` | `http://127.0.0.1:3100/mcp` | The server's HTTP transport. |
| `TAMIZ_AGENT_MCP_KEY` | — | Required: an admin key, sent as the bearer to the MCP server. |

**Tool protocol.** Two protocols, chosen by `TAMIZ_AGENT_TOOL_PROTOCOL`; in both a run stops
after at most 6 model calls:

- `native` (default, `T-009-05`, `specs/009-mcp-agent/tool-calling/`): the MCP tools are
  declared as OpenAI `tools`, the model answers with `tool_calls`, every call of an answer
  runs in order and goes back as a `tool` message, and a reply without tool calls is the
  answer. The gateway inspects the tool results like any other text.
- `text` (spec 009 R-10, `specs/009-mcp-agent/contracts/agent-protocol.md`): each model
  reply is one JSON object, either `{"tool", "arguments"}` or `{"answer"}`; tool results
  and errors go back as `Observation …` messages. Use it for models without tool support.

The demo prints the answer and a run record with:

- the protocol and the prompt version (`prompts/system.v2.md` native, `system.v1.md` text);
- the UTC date;
- the tools called, with their arguments;
- the gateway request id of every model call.

The record never holds the tool results.

**Demo data.** `demo/seed-audit.sql` inserts synthetic, content-free audit rows for the
two days before today, in which yesterday's spend doubles on `anthropic-sonnet`. Load it
with `psql "$DATABASE_URL" -f apps/mcp-server/demo/seed-audit.sql` into the gateway's
Postgres. The demo needs Ollama with `llama3.1:8b` for the `ollama-llama` target.

## Development

```bash
pnpm --filter @tamiz/mcp-server test     # in-process MCP client against a fake gateway
npx @modelcontextprotocol/inspector node apps/mcp-server/dist/main.js
```

The stdio test spawns the built `dist/main.js`; the root `pnpm test` builds first.
Architecture: `pnpm arch` checks that nothing outside `src/agent/` imports the agent.
