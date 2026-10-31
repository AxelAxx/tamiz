# T-009-01 — Spec, plan and tasks for `009-mcp-agent`

| Field | Value |
|---|---|
| Task | `T-009-01` (see `docs/tasks/BACKLOG.md`) |
| Feature | `009-mcp-agent` |
| Spec | `specs/009-mcp-agent/spec.md` |
| Branch / PR | `009-mcp-agent` (Spec Kit naming), cut from `main` at dc07462 / draft PR opened after this commit |
| Date | 2026-10-31 |
| Session | Claude Code (Claude Opus 5.5), side session |
| Status | done; spec reviewed and approved by Alex on 2026-10-31 without changes (`spec.md` flipped to `Approved` in the same PR) |

## What was done

The Spec Kit set for feature 009, written with `/speckit-specify`, `/speckit-plan` and
`/speckit-tasks`:

- **`spec.md`**: 5 stories, 30 scenarios, FR-001 … FR-018, SC-001 … SC-006, edge cases and
  assumptions. Every scenario maps to one automated test, except `US5-6`, the recorded demo
  run.
- **`checklists/requirements.md`**: all items pass.
- **`plan.md`**: no constitution violations; principle IV is justified for the agent (see
  Decisions); the requirement → backlog mapping.
- **`research.md`**: R-01 … R-14, including the checked library versions.
- **`data-model.md`**: tool inputs, outputs and errors, the tool definition, the
  configuration, the agent's action, run record and loop.
- **`contracts/`**:
  - `tools.md`: the four tools, their gateway calls, annotations and the error table;
  - `configuration.md`: transports, variables, and the Claude Desktop and Claude Code
    snippets;
  - `agent-protocol.md`: the agent's text tool protocol and run record;
  - `tool-result.example.json`.
- **`quickstart.md`**.
- **`tasks.md`**: 31 tasks in 3 phases, one per backlog task, with the scenario coverage
  table.

## Versions checked (2026-10-31, Context7 and `npm view`)

- `@modelcontextprotocol/server` and `@modelcontextprotocol/client` 2.4.0 (the v2 split
  packages, `latest`).
- `@modelcontextprotocol/hono` 2.0.2.
- `@modelcontextprotocol/sdk` 1.32.2: v1, still `latest` of the old package; not used.
- `ai` 6.0.320 (`ai-v6`; `latest` is 7.0.x).
- `@ai-sdk/mcp` 1.0.100 (`ai-v6`; `latest` 2.0.x needs AI SDK 7).
- `@ai-sdk/openai-compatible` 2.x, as the gateway.

The type declarations of `@ai-sdk/mcp@1.0.100` and `ai@6.0.320` were read from the
published tarballs: `createMCPClient`, `tools()`, the `{ type: 'http', url, headers }`
transport config, `stepCountIs`, `ToolLoopAgent`.

## Decisions (flagged for Alex's review)

- **The agent's tool protocol is text, not native tool calling (R-10).** The gateway's
  chat completion contract rejects `tools`, `tool_choice`, tool messages and
  `response_format`, so AI SDK tool calling through Tamiz is impossible today.
  - The model answers one JSON object (`{"tool", "arguments"}` or `{"answer"}`), and the
    agent validates it and sends errors back as observations.
  - The step limit is 6 model calls.
  - Native tool calling in the gateway would touch the contracts, the provider port, four
    adapters and the privacy inspection of tool messages. It is proposed as a new optional
    backlog row, `T-009-05`, not part of this feature.
- **Who holds the key (R-04).**
  - On stdio, one admin key comes from the server's environment (the host's config `env`
    block); `/v1/simulate` accepts admin keys, so it serves all four tools.
  - On HTTP, the server holds no key: each request's bearer key is forwarded to the gateway
    for that request only.
  - There is no key probe at start, because hosts launch servers eagerly. A client key with
    admin tools enabled gets `gateway_forbidden` per call.
- **Permission per tool is an allowlist (`TAMIZ_MCP_TOOLS`, default all four) (R-06).**
  - Every tool is read-only by construction and annotated `readOnlyHint`.
  - A disabled tool is never registered.
  - A future write tool needs its own spec and defaults to disabled.
- **Audit page size for the tool: default 20, max 50 (FR-010)**, smaller than the admin
  API's 50/200, so a page fits an assistant's context.
- **The agent runs on `tamiz-local`** (the existing `pinned-local` rule): its prompts and
  the tool results it sends never leave the machine, and the audit log shows its calls on
  `ollama-llama`.
- **Principle IV and the agent.** No eval dataset or threshold: the agent is a demo of
  operator tooling, not a routing or privacy decision. Scripted tests pin the loop, and the
  demo run is recorded. If Alex wants an eval, a small "operator questions" dataset can be a
  follow-up.
- **No gateway change; flat modules in `apps/mcp-server` (R-03).** One dependency-cruiser
  rule keeps the server side from importing `src/agent/` (R-13).
- **The demo history is a SQL fixture (R-14).** The gateway cannot backdate traffic, so the
  fixture inserts synthetic, content-free audit rows for the two previous days into
  Postgres.
- **MCP SDK v2 rather than v1 (R-01).** v2 takes Zod v4 schemas directly and has a
  web-standard HTTP transport that fits Hono.

## How it was verified

- Documentation only.
- `tool-result.example.json` is valid JSON, and its error rate is 5/7. It is parsed against
  the contracts in `T-009-02` (T001).
- Scenario coverage: every scenario of the spec maps to a task in the `tasks.md` table.
- The gateway facts the spec relies on were read from the code:
  - the strict chat request contract, which has no `tools`;
  - `pinned-local` in `apps/gateway/policies/default.yaml`;
  - admin keys pass the `/v1/*` key middleware;
  - `policy_blocked` answers 451.
- `pnpm lint` green.

## Pending / follow-ups

- New backlog row `T-009-05` (optional): native OpenAI tool calling through the gateway
  (`tools`, `tool_calls` and tool messages in the contract, the provider port and the
  adapters, privacy inspection and anonymization of tool calls and results). Not needed by
  this feature.
- `T-OPS-01` may add the MCP server's HTTP transport to the compose stack; optional.

## Pitfalls for the next session

- **v2 MCP packages bundle private copies.** Both halves of an `InMemoryTransport` pair must
  come from the same package (`@modelcontextprotocol/client` in the tests).
- **AI SDK 7 is `latest`.** Install the `ai-v6` releases (`@ai-sdk/mcp@1`,
  `@ai-sdk/openai-compatible@2`), or the workspace gets two provider layers.
- **Standard output is the stdio protocol channel.** Any `console.log` in the server breaks
  hosts; logs go to stderr.
- **`exactOptionalPropertyTypes`.** Drop `undefined` filters before building query strings,
  as the gateway's audit route does (`T-006-04`).

## Links

- Spec / plan / tasks: `specs/009-mcp-agent/`
- ADRs: none added
- Related task records: `docs/tasks/done/T-005-06-simulate-endpoint.md`, `docs/tasks/done/T-006-04-audit-query-api.md`, `docs/tasks/done/T-006-06-cost-and-providers.md`, `docs/tasks/done/T-003-05-streaming.md`
