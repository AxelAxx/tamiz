# Contract: configuration, transports and host setup

**Feature**: `009-mcp-agent`. Variables and defaults: `data-model.md` section 3.

## Binary and scripts

| Command | What it does |
|---|---|
| `node apps/mcp-server/dist/main.js` (bin `tamiz-mcp`) | Starts the server; transport from `--transport stdio\|http` or `TAMIZ_MCP_TRANSPORT` (default `stdio`) |
| `pnpm --filter @tamiz/mcp-server start:http` | Same with `--transport http` |
| `pnpm --filter @tamiz/mcp-server agent:demo -- "<question>"` | Runs the agent once and prints the answer and the run record (JSON) |

Exit codes at start: `0` normal shutdown, `1` invalid configuration (missing key on stdio,
unknown tool, bad URL), with the reason on stderr.

## stdio

- Standard input and output carry MCP messages only; logs are JSON lines on stderr.
- The key is `TAMIZ_MCP_GATEWAY_KEY`, an **admin** key for the admin tools. With a client
  key, set `TAMIZ_MCP_TOOLS=simulate_routing`.

## Streamable HTTP

- Endpoint `POST http://127.0.0.1:3100/mcp`, stateless (no `Mcp-Session-Id`); `GET` and
  `DELETE` answer `405`.
- `Authorization: Bearer <Tamiz key>` is required (`401` with `WWW-Authenticate: Bearer`
  otherwise). The key is forwarded to the gateway for that request only.
- `Host` and `Origin` are validated: local names by default, `TAMIZ_MCP_ALLOWED_HOSTS` when
  bound elsewhere; a mismatch answers `403`.
- `TAMIZ_MCP_GATEWAY_KEY` is ignored on HTTP and a warning is logged if it is set.

## Host configuration (README snippets)

The README holds these between `<!-- mcp-config:start -->` and `<!-- mcp-config:end -->`;
`test/readme.test.ts` checks that the JSON parses, the command points at
`apps/mcp-server/dist/main.js`, every variable is documented, and the keys are
placeholders (`tamiz_admin_key_here`).

**Claude Desktop** (`claude_desktop_config.json`; on Windows use a path like
`C:\\path\\to\\tamiz\\apps\\mcp-server\\dist\\main.js`):

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

**Claude Code**, stdio:

```bash
claude mcp add tamiz -e TAMIZ_MCP_GATEWAY_URL=http://localhost:3000 -e TAMIZ_MCP_GATEWAY_KEY=tamiz_admin_key_here -- node /path/to/tamiz/apps/mcp-server/dist/main.js
```

**Claude Code**, HTTP (server started with `start:http`):

```bash
claude mcp add --transport http tamiz http://127.0.0.1:3100/mcp --header "Authorization: Bearer tamiz_admin_key_here"
```

The README also states the caveat of the spec's first edge case: text given to
`simulate_routing` from a cloud-hosted assistant has already reached that assistant's
model, so simulate with synthetic text.
