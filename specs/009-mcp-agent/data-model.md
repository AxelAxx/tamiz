# Data Model: MCP Server and Agent

**Feature**: `009-mcp-agent` · **Date**: 2026-10-31

No persistent data. This file fixes the shapes the server and the agent exchange. Shared
shapes (section 1) are Zod schemas in `packages/contracts/src/mcp.ts`; app-internal ones
(sections 2–4) live in `apps/mcp-server`.

## 1. Contracts (`@tamiz/contracts`, module `mcp.ts`)

### 1.1 Tool names

`McpToolNameSchema = z.enum(["simulate_routing", "query_audit_log", "get_cost_report",
"get_provider_health"])`, exported with `MCP_TOOL_NAMES`.

### 1.2 Tool inputs

| Schema | Fields | Rules |
|---|---|---|
| `SimulateRoutingInputSchema` | `text?: string`, `messages?: ChatMessage[]`, `model?: string` | `text` 1 … 32 000 chars; `messages` ≥ 1 (`ChatMessageSchema`); exactly one of `text` / `messages` (refinement); `model` 1 … 200 chars |
| `QueryAuditLogInputSchema` | `from?`, `to?` (ISO date-time with offset), `route?`, `rule?`, `sensitivity?`, `action?`, `entity?`, `outcome?`, `cursor?`, `limit` | Field types from `AuditQuerySchema.shape`; `limit` is `z.int().min(1).max(50).default(20)` (no coercion) |
| `GetCostReportInputSchema` | `from`, `to`, `groupBy` | `CostQuerySchema` (`groupBy` default `day`) |
| `GetProviderHealthInputSchema` | `windowMinutes` | `z.int().min(1).max(1440).default(15)` |

All four are strict objects. The `from < to` rule stays with the gateway (`400` →
`gateway_rejected`), as in the admin API.

### 1.3 Tool outputs (existing, unchanged)

| Tool | Output schema | Source |
|---|---|---|
| `simulate_routing` | `SimulateResponseSchema` | `simulate.ts` (feature 005) |
| `query_audit_log` | `AuditPageSchema` | `admin.ts` (feature 006) |
| `get_cost_report` | `CostReportSchema` | `admin.ts` |
| `get_provider_health` | `ProvidersReportSchema` | `admin.ts` |

### 1.4 Tool error

```ts
McpToolErrorCodeSchema = z.enum([
  "gateway_unreachable", "gateway_timeout", "gateway_unauthorized",
  "gateway_forbidden", "gateway_rejected", "gateway_error", "gateway_contract",
]);
McpToolErrorSchema = z.strictObject({
  error: z.strictObject({ code: McpToolErrorCodeSchema, message: z.string().max(500) }),
});
```

The message never contains the key or request headers. For `gateway_rejected` it is the
gateway's error envelope message; for `gateway_contract` it names the first failing path,
never the value.

## 2. Tool definition (`src/tools/definition.ts`)

```ts
type GatewayCall = { method: "GET" | "POST"; path: "/v1/simulate" | `/v1/admin/${string}` };

interface ToolDefinition<I, O> {
  name: McpToolName;
  title: string;
  description: string;             // shown to hosts and models; states rules (e.g. text XOR messages)
  inputSchema: z.ZodType<I>;       // from 1.2
  outputSchema: z.ZodType<O>;      // from 1.3
  gatewayCall: GatewayCall;        // the one call it makes (US2-3)
  run(input: I, gateway: GatewayClient): Promise<Result<O, ToolError>>;
}
```

Annotations are the same for every tool (`readOnlyHint: true`, `destructiveHint: false`,
`idempotentHint: true`, `openWorldHint: false`), so they are set by `createMcpServer`, not by
each definition.

Results:
- **success** → `{ content: [{ type: "text", text: JSON }], structuredContent: value }`;
- **failure** → `{ content: [{ type: "text", text: JSON of McpToolError }], isError: true }`.

## 3. Configuration (`src/config.ts`, Zod, at start)

| Variable | Default | Rule |
|---|---|---|
| `TAMIZ_MCP_GATEWAY_URL` | `http://localhost:3000` | URL |
| `TAMIZ_MCP_GATEWAY_KEY` | — | required when the transport is `stdio`; ignored (and warned) on `http` |
| `TAMIZ_MCP_TOOLS` | all four | comma-separated `McpToolName`s, at least one; unknown name → exit 1 naming it |
| `TAMIZ_MCP_TIMEOUT_MS` | `10000` | 100 … 120 000 |
| `TAMIZ_MCP_SIMULATE_MODEL` | `auto` | model sent by `simulate_routing` when none is given; a name no rule pins, so routing follows task type and size |
| `TAMIZ_MCP_TRANSPORT` | `stdio` | `stdio` \| `http`; the `--transport` flag wins |
| `TAMIZ_MCP_HTTP_HOST` | `127.0.0.1` | bind address |
| `TAMIZ_MCP_HTTP_PORT` | `3100` | 1 … 65 535 |
| `TAMIZ_MCP_ALLOWED_HOSTS` | — | comma-separated host names; required when the host is not local |
| `LOG_LEVEL` | `info` | pino levels; logs always to stderr |

Agent (only read by `agent/demo.ts`):

| Variable | Default | Rule |
|---|---|---|
| `TAMIZ_AGENT_GATEWAY_URL` | `http://localhost:3000` | where the agent's model calls go (`/v1/chat/completions`) |
| `TAMIZ_AGENT_API_KEY` | — | required; a client key for the model calls |
| `TAMIZ_AGENT_MODEL` | `tamiz-local` | requested model |
| `TAMIZ_AGENT_MCP_URL` | `http://127.0.0.1:3100/mcp` | the server's HTTP transport |
| `TAMIZ_AGENT_MCP_KEY` | — | required; an admin key, sent as the bearer to the MCP server |

## 4. Agent (`src/agent/`)

### 4.1 Action (model answer)

```ts
AgentActionSchema = z.union([
  z.strictObject({ tool: z.string().min(1), arguments: z.record(z.string(), z.unknown()).default({}) }),
  z.strictObject({ answer: z.string().min(1) }),
]);
```

`extractAction(text)` returns the first balanced JSON object in the text (code fences
allowed) parsed with this schema, or a format error.

### 4.2 Step and run record

```ts
type AgentStep =
  | { kind: "tool"; tool: string; arguments: unknown; requestId: string; ok: boolean; errorCode?: string }
  | { kind: "observation_error"; reason: "format" | "unknown_tool"; requestId: string }
  | { kind: "answer"; requestId: string };

interface AgentRun {
  question: string;
  promptVersion: "system.v1";
  model: string;                     // requested model, e.g. tamiz-local
  today: string;                     // YYYY-MM-DD (UTC) given to the prompt
  steps: AgentStep[];                // one per model call
  requestIds: string[];              // x-request-id of every model call, in order
  stopReason: "answered" | "step_limit" | "gateway_error";
  answer?: string;                   // when answered
  gatewayError?: { type: string; requestId?: string };
}
```

`requestId` is the gateway's `x-request-id` of the model call that produced the step. The
run record holds tool arguments (dates, filters) and the final answer, never the tool
results, so printing it is safe to share.

### 4.3 Loop states

```text
start ─▶ model call ─┬─ gateway error ──────────────▶ stop(gateway_error)
                     ├─ {answer} ───────────────────▶ stop(answered)
                     ├─ {tool} listed ─▶ execute ─▶ observation ─┐
                     ├─ {tool} unlisted / bad format ─▶ observation ─┤
                     │                                               ▼
                     └──────────── steps < 6 ? model call : stop(step_limit)
```
