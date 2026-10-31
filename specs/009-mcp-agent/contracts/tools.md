# Contract: the four MCP tools

**Feature**: `009-mcp-agent`. Schemas: `packages/contracts/src/mcp.ts` (inputs, error) and
the existing admin and simulate modules (outputs). See `data-model.md` section 1.

Every tool:
- is registered only when it is in `TAMIZ_MCP_TOOLS`;
- has the annotations `readOnlyHint: true`, `destructiveHint: false`,
  `idempotentHint: true`, `openWorldHint: false`;
- makes exactly one gateway call, with `Authorization: Bearer <key>` and an `x-request-id`
  of the form `mcp-<uuid>`;
- returns `structuredContent` plus compact JSON text, or a tool error (below).

## `simulate_routing`

| | |
|---|---|
| Title | Simulate routing |
| Description | "Dry-run the Tamiz routing and privacy policy on a text or a list of chat messages. Returns what would be detected (kinds and positions, never values), the matched rule, the privacy action and the target chain. No model is called. Give exactly one of `text` or `messages`." |
| Input | `SimulateRoutingInputSchema` |
| Gateway call | `POST /v1/simulate`, body `{ model, messages }`: a `text` becomes `[{ role: "user", content: text }]`; `model` defaults to `TAMIZ_MCP_SIMULATE_MODEL` |
| Output | `SimulateResponseSchema` |

Example input: `{ "text": "Resume el expediente del paciente con DNI 12345678Z" }`.

## `get_provider_health`

| | |
|---|---|
| Title | Provider health |
| Description | "Circuit breaker state of every configured target, plus requests, error rate and p50/p95 latency over the last `windowMinutes` (default 15)." |
| Input | `GetProviderHealthInputSchema` |
| Gateway call | `GET /v1/admin/providers?windowMinutes=<n>` (admin key) |
| Output | `ProvidersReportSchema` |

## `query_audit_log`

| | |
|---|---|
| Title | Query audit log |
| Description | "Search Tamiz routing decisions, newest first. Filters: from/to (ISO date-time), route (target id), rule, sensitivity, action, entity (kind, e.g. DNI), outcome. Entries hold metadata only: kinds and counts, never message text. Use `nextCursor` as `cursor` for the next page. Page size 1–50, default 20." |
| Input | `QueryAuditLogInputSchema` |
| Gateway call | `GET /v1/admin/audit?<filters>&limit=<n>[&cursor=…]`; `undefined` fields are omitted (admin key) |
| Output | `AuditPageSchema` |

## `get_cost_report`

| | |
|---|---|
| Title | Cost report |
| Description | "Spend of served requests in [from, to), grouped by UTC day, route or model, with the 'everything to the most expensive target' baseline, blocked and failed counts, and totals." |
| Input | `GetCostReportInputSchema` |
| Gateway call | `GET /v1/admin/cost?from=…&to=…&groupBy=…` (admin key) |
| Output | `CostReportSchema` |

## Errors

| Situation | Where it is handled | What the client sees |
|---|---|---|
| Disabled or unknown tool | SDK (not registered) | protocol error: unknown tool |
| Input fails the input schema | SDK | protocol error: invalid params; no gateway call |
| `fetch` rejects | gateway client | tool error `gateway_unreachable` |
| No answer within `TAMIZ_MCP_TIMEOUT_MS` | gateway client | `gateway_timeout` |
| 401 | gateway client | `gateway_unauthorized` ("the gateway key is missing or invalid") |
| 403 | gateway client | `gateway_forbidden` ("the gateway key lacks the admin role") |
| Other 4xx | gateway client | `gateway_rejected` with the gateway's `error.message` |
| 5xx | gateway client | `gateway_error` with the status |
| Body fails the output contract | gateway client | `gateway_contract` with the first failing path |

Tool error result (see `tool-result.example.json` for both shapes):

```json
{
  "isError": true,
  "content": [{ "type": "text", "text": "{\"error\":{\"code\":\"gateway_forbidden\",\"message\":\"the gateway key lacks the admin role\"}}" }]
}
```
