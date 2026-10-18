# apps/mcp-server

The Tamiz MCP server and dogfooding agent. Exposes the gateway's admin capabilities as
MCP tools (`simulate_routing`, `query_audit_log`, `get_cost_report`,
`get_provider_health`) with per-tool permissions and read-only defaults, using the
official `@modelcontextprotocol/sdk`. The bundled AI SDK 6 agent answers operational
questions and makes its own LLM calls **through Tamiz**. Created in feature
`009-mcp-agent` (task `T-009-02`).
