# Quickstart: verifying the MCP Server and Agent

**Feature**: `009-mcp-agent` · **Date**: 2026-10-31

How a reviewer proves the feature works once `T-009-02` … `T-009-04` are merged.

## Prerequisites

- Features 005 and 006 merged; the gateway runs with `tsx src/main.ts` or `docker compose`.
- An admin key and a client key:
  `pnpm --filter @tamiz/gateway generate-api-key <client>` (or `api-key:add <client> --admin`
  with Postgres).
- For the agent demo: Postgres (`docker compose up postgres`), the privacy service, and
  Ollama with `llama3.1:8b`.

## 1. Suites (no services)

```bash
pnpm --filter @tamiz/contracts test
pnpm --filter @tamiz/mcp-server test
```

Expected:
- every scenario test (`US1-1` … `US5-5`) is green: tools, permissions, errors, both
  transports, the README snippets, the agent loop;
- the key-leak helper finds no key in any output.

## 2. Gates

```bash
pnpm lint && pnpm typecheck && pnpm arch && pnpm test && pnpm build
```

`pnpm arch` now also cruises `apps/mcp-server/src`: nothing outside `src/agent/` imports
from it.

## 3. stdio by hand

```bash
pnpm --filter @tamiz/mcp-server build
npx @modelcontextprotocol/inspector node apps/mcp-server/dist/main.js
```

Set `TAMIZ_MCP_GATEWAY_URL` and `TAMIZ_MCP_GATEWAY_KEY` in the inspector's environment
panel. Then:
- list the tools (4, read-only);
- call `get_provider_health`;
- call `simulate_routing` with a synthetic DNI text: `critical`, `restrict_to_local`,
  chain `[ollama-llama]`.

## 4. Permissions

Restart with `TAMIZ_MCP_TOOLS=simulate_routing,get_provider_health`:
- only those two are listed;
- `TAMIZ_MCP_TOOLS=nope` exits 1 naming `nope`;
- with a client key, `query_audit_log` returns `gateway_forbidden`.

## 5. HTTP

```bash
pnpm --filter @tamiz/mcp-server start:http
curl -i -X POST http://127.0.0.1:3100/mcp -H "content-type: application/json" \
  -H "accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

Expected:
- `401` without a bearer token;
- with `-H "Authorization: Bearer <admin key>"`, the four tools;
- with `-H "Host: evil.example"`, `403`.

## 6. Claude Desktop or Claude Code

Use the README snippet (`apps/mcp-server/README.md`) and ask "is any Tamiz provider
failing?". The host asks permission for `get_provider_health` and shows the answer
(SC-001).

## 7. The agent demo (US5-6, SC-004)

```bash
psql "$DATABASE_URL" -f apps/mcp-server/demo/seed-audit.sql
pnpm --filter @tamiz/mcp-server start:http   # in another terminal
pnpm --filter @tamiz/mcp-server agent:demo -- "why did spend rise yesterday?"
curl -H "Authorization: Bearer <admin key>" "http://localhost:3000/v1/admin/audit?rule=pinned-local&limit=10"
```

Expected:
- the answer names the route that grew, with both daily amounts;
- `stopReason: "answered"` in at most 6 steps;
- the audit query shows one entry per model call, rule `pinned-local`, target
  `ollama-llama`, with the run record's request ids.

Record the transcript in the `T-009-04` task record.
