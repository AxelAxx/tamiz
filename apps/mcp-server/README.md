# apps/mcp-server

The Tamiz MCP server (`@tamiz/mcp-server`): the gateway's simulation and admin reads as
read-only MCP tools, with an allowlist per tool, over stdio or stateless streamable HTTP.
Built on the official MCP TypeScript SDK v2 (`@modelcontextprotocol/server` 2.4.0).
Feature `009-mcp-agent`.

**Status (`T-009-02`):** `simulate_routing` and `get_provider_health`, both transports, the
`TAMIZ_MCP_TOOLS` allowlist and the coded tool errors. `query_audit_log`,
`get_cost_report` and the host configuration snippets arrive with `T-009-03`; the
dogfooding agent with `T-009-04`.

## Run

```bash
pnpm --filter @tamiz/mcp-server build
TAMIZ_MCP_GATEWAY_URL=http://localhost:3000 TAMIZ_MCP_GATEWAY_KEY=tamiz_admin_key_here \
  node apps/mcp-server/dist/main.js              # stdio (what an MCP host launches)
pnpm --filter @tamiz/mcp-server start:http      # http://127.0.0.1:3100/mcp, bearer key per request
```

On stdio the key comes from `TAMIZ_MCP_GATEWAY_KEY` (required). On HTTP the server holds
no key: each request's `Authorization: Bearer <Tamiz key>` is forwarded to the gateway for
that request only. Logs are JSON lines on stderr; stdout carries only MCP messages.

Variables (defaults in brackets): `TAMIZ_MCP_GATEWAY_URL` [`http://localhost:3000`],
`TAMIZ_MCP_GATEWAY_KEY`, `TAMIZ_MCP_TOOLS` [all], `TAMIZ_MCP_TIMEOUT_MS` [`10000`],
`TAMIZ_MCP_SIMULATE_MODEL` [`auto`], `TAMIZ_MCP_TRANSPORT` [`stdio`, or `--transport`],
`TAMIZ_MCP_HTTP_HOST` [`127.0.0.1`], `TAMIZ_MCP_HTTP_PORT` [`3100`],
`TAMIZ_MCP_ALLOWED_HOSTS` (required off localhost), `LOG_LEVEL` [`info`]. See
`specs/009-mcp-agent/contracts/configuration.md`.

The admin tools need an admin key; with a client key set
`TAMIZ_MCP_TOOLS=simulate_routing`.
