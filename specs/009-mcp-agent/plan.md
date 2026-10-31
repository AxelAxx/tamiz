# Implementation Plan: MCP Server and Agent

**Branch**: `009-mcp-agent` | **Date**: 2026-10-31 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/009-mcp-agent/spec.md`

## Summary

`apps/mcp-server` becomes the `@tamiz/mcp-server` workspace app. It has:

- **The server.** It is built on the official MCP SDK v2 (`@modelcontextprotocol/server`
  2.4.0) and exposes four read-only tools:
  - `simulate_routing` → `POST /v1/simulate`;
  - `query_audit_log` → `GET /v1/admin/audit`;
  - `get_cost_report` → `GET /v1/admin/cost`;
  - `get_provider_health` → `GET /v1/admin/providers`.

  Their input schemas and error shape are new Zod schemas in
  `packages/contracts/src/mcp.ts`; their output schemas are the existing admin and simulate
  contracts.
- **Permissions.** An allowlist (`TAMIZ_MCP_TOOLS`), with every tool annotated read-only.
- **Transports.**
  - stdio, with the key from the environment;
  - stateless streamable HTTP on Hono, where each request's bearer key is forwarded to the
    gateway and never stored.
- **The agent.** It uses AI SDK 6, the `@ai-sdk/mcp` client and the gateway as an
  OpenAI-compatible provider (model `tamiz-local`, the local-only rule). It answers "why did
  spend rise yesterday?" with a text-based tool protocol, because the gateway's chat
  contract carries no tools.

Tests use an in-process MCP client and a fake gateway (a Hono app speaking the real
contracts). The gateway does not change.

## Technical Context

**Language/Version**: TypeScript 5.x strict, ESM, Node.js 22 LTS.

**Primary Dependencies** (versions in research R-01):
- `@modelcontextprotocol/server` 2.4.0;
- `@modelcontextprotocol/hono` 2.0.2;
- `hono` and `@hono/node-server`, `pino`, `zod` (catalog), `@tamiz/contracts`;
- agent: `ai` 6.0.x, `@ai-sdk/mcp` 1.0.x and `@ai-sdk/openai-compatible` 2.x.

Dev: `vitest`, `@modelcontextprotocol/client` 2.4.0.

**Storage**: none. The demo's SQL fixture writes to the gateway's Postgres, outside the
app.

**Testing**:
- Vitest;
- in-process MCP client over `InMemoryTransport`, against a fake gateway Hono app injected
  as `fetch`;
- the HTTP transport called in process; one stdio test spawns the built binary;
- a README snippet test;
- the agent with scripted model answers;
- the demo run against the real stack, recorded.

**Target Platform**:
- the operator's machine, launched by Claude Desktop or Claude Code (stdio);
- next to the gateway (HTTP);
- Windows, macOS and Linux (stdio paths in the README for each).

**Project Type**: monorepo. One app gains code, one contract module is added, and
`.dependency-cruiser.cjs` gains one rule.

**Performance Goals**: a tool adds under 100 ms to the gateway's response (SC-005); the
demo answers in at most 6 model calls (SC-004).

**Constraints**:
- no gateway change;
- the key never in tool data or logs;
- standard output reserved for the protocol on stdio;
- every gateway body parsed with its contract;
- the agent's model calls only through the gateway.

**Scale/Scope**:
- 3 backlog tasks;
- 4 tools, 2 transports, 1 contract module, 1 agent, 1 demo script;
- 18 FRs, 5 stories, 30 scenarios.

## Constitution Check

| # | Principle | How this plan complies | Status |
|---|---|---|---|
| I | Strict Clean Architecture | The gateway is untouched. The app depends only on `@tamiz/contracts` among workspace packages; a dependency-cruiser rule keeps the server side from importing `src/agent/` (R-13). The app is a thin adapter, so it has flat modules rather than layers (X). | PASS |
| II | Contract-first | Tool inputs and the tool error shape are Zod schemas in `packages/contracts/src/mcp.ts`; outputs are the existing admin and simulate schemas. The JSON Schemas hosts see derive from them. | PASS |
| III | Spec before code | This spec, plan and tasks; each scenario maps to a test (`tasks.md` table); `US5-6` is the recorded demo. | PASS |
| IV | Evals are executable spec | The agent is an AI behaviour, but a demo of operator tooling, not a product decision: no dataset or threshold. Its scripted tests pin the loop, and the demo run is recorded. Flagged for review. | PASS (justified) |
| V | Privacy by default | Tool outputs carry only contract metadata (no content); the agent's prompts and the tool results go through the gateway on the local route; the key is never in tool data or logs (SC-003); the README warns about simulation text in cloud hosts. | PASS |
| VI | Fail fast, never silently | Missing key or unknown tool stops the server at start; gateway failures are coded tool errors; the agent stops on gateway errors and at the step limit with an explicit reason. | PASS |
| VII | Strict TypeScript | Same shared configs; `Result<T, ToolError>` in the gateway client. | PASS |
| VIII | Testability | The gateway behind an injectable `fetch`, the clock injectable in the agent, the in-process MCP transport; no network in unit tests. | PASS |
| IX | Composition over inheritance | A tool is a record (name, schemas, annotations, gateway call); the server registers a list; the agent loop is a function over a model call and a tool set. | PASS |
| X | Simplicity | No ports, no sessions, no permission file, no OAuth; one allowlist variable; one tool loop. | PASS |

Re-check after Phase 1: unchanged, PASS.

## Project Structure

### Documentation (this feature)

```text
specs/009-mcp-agent/
├── spec.md              # Draft spec
├── plan.md              # This file
├── research.md          # R-01 … R-14
├── data-model.md        # Tools, inputs, errors, config, agent action and run record
├── quickstart.md        # How a reviewer checks the feature
├── contracts/
│   ├── tools.md         # The four tools: schemas, gateway calls, annotations, errors
│   ├── configuration.md # Environment, CLI, transports, host configuration snippets
│   ├── agent-protocol.md # The text tool protocol and the run record
│   └── tool-result.example.json
├── checklists/requirements.md
└── tasks.md             # /speckit-tasks output
```

### Source Code (repository root)

```text
packages/contracts/src/mcp.ts             # tool names, input schemas, tool error (+ index export)
apps/mcp-server/
├── package.json  tsconfig*.json  vitest.config.ts  README.md
├── demo/seed-audit.sql                   # synthetic audit history for the demo (T-009-04)
├── src/
│   ├── main.ts               # composition root: config → logger → transport
│   ├── config.ts             # env (Zod): gateway URL, key, tools, timeout, transport, HTTP host/port
│   ├── logger.ts             # pino to stderr, redaction
│   ├── gateway-client.ts     # fetch + timeout + contract parsing → Result<T, ToolError>
│   ├── tools/
│   │   ├── definition.ts     # ToolDefinition type, toToolResult / toToolError
│   │   ├── simulate-routing.ts  get-provider-health.ts        (T-009-02)
│   │   ├── query-audit-log.ts   get-cost-report.ts            (T-009-03)
│   │   └── registry.ts       # ALL_TOOLS, selectTools(allowlist)
│   ├── server.ts             # createMcpServer({ tools, gateway }) → McpServer
│   ├── transports/{stdio,http}.ts
│   └── agent/
│       ├── action.ts         # AgentActionSchema, extractAction
│       ├── gateway-model.ts  # the gateway as an OpenAI-compatible model
│       ├── run-agent.ts      # the tool loop, the run record
│       ├── prompts/system.v1.md
│       └── demo.ts           # CLI
└── test/
    ├── support/{fake-gateway,fixtures,mcp-harness,no-key}.ts
    ├── tools-*.test.ts  permissions.test.ts  errors.test.ts
    ├── transport-http.test.ts  transport-stdio.test.ts  readme.test.ts
    └── agent.test.ts
packages/contracts/test/mcp.test.ts
.dependency-cruiser.cjs, package.json     # agent-isolation rule; `arch` cruises apps/mcp-server/src
vitest.config.ts (root), turbo.json        # register the app
```

**Structure Decision**: one app holds the server and the agent, as the foundational
document places them (`apps/mcp-server`). The agent sits in `src/agent/` and reaches the
server only through MCP.

## Requirement → task mapping

| Backlog task | Requirements | Stories |
|---|---|---|
| `T-009-02` App skeleton, contracts module, gateway client, error mapping, allowlist, annotations, stdio and HTTP transports, `simulate_routing`, `get_provider_health` | FR-001 … FR-009 | US1, US2, US4-1 … US4-5 |
| `T-009-03` `query_audit_log`, `get_cost_report`, README with host configuration | FR-010 … FR-012 | US3, US4-6 |
| `T-009-04` Agent: action protocol, gateway model, loop, prompt, run record, demo CLI, seed fixture, recorded demo | FR-013 … FR-018 | US5 |

Order: `T-009-02` → `T-009-03` → `T-009-04`.

The contracts module ships whole in `T-009-02`, with all four input schemas, so
`T-009-03` adds no contract changes.

## Complexity Tracking

No violations. For review:
- **R-04:** stdio holds the operator's key from the host configuration; HTTP forwards each
  caller's bearer key and stores none; no probe at start.
- **R-06:** permission per tool is an allowlist; read-only by construction.
- **R-10:** the agent's text-based tool protocol, because the gateway rejects `tools`;
  native tool calling proposed as optional `T-009-05`.
- **Principle IV:** no eval dataset for the agent; flagged.
