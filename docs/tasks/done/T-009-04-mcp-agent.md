# T-009-04 — Dogfooding agent (AI SDK 6 + MCP client) calling the LLM through Tamiz

| Field | Value |
|---|---|
| Task | `T-009-04` (see `docs/tasks/BACKLOG.md`) |
| Feature | `009-mcp-agent` |
| Spec | `specs/009-mcp-agent/spec.md` |
| Branch / PR | `T-009-04-mcp-agent`, cut from `main` at 0d98df2, rebased onto 1699850 (#50) / PR opened after this commit |
| Date | 2026-10-31 |
| Session | Claude Code (Claude Opus 5.5), side session |
| Status | done, except T030: this machine has no Ollama, no Docker daemon and no `psql`, so the full answered demo (US5-6, SC-004) was not recorded. What was recorded is below. |

## What was done

The agent of US5 is built and tested (`tasks.md` T022–T029, T031). It is the agent's own
text tool loop (FR-013, FR-015):

- it connects as an MCP client (`@ai-sdk/mcp` 1.0.100) and lists the tools;
- it asks its model for one JSON action per reply, `{"tool", "arguments"}` or
  `{"answer"}`;
- it runs tool calls over MCP and sends results, unknown tools, bad formats and tool
  errors back as observations;
- it stops on an answer, on a gateway error (FR-017), or after 6 model calls
  (`step_limit`).

Every model call goes to the gateway (FR-014):
- the AI SDK 6 OpenAI-compatible provider, pointed at `<gateway>/v1`;
- the agent's client key and `tamiz-local`;
- `temperature: 0`, `maxRetries: 0`.

The rest:
- **Prompt and clock (FR-016).** The system prompt is the versioned file
  `prompts/system.v1.md`, given today's UTC date by an injectable clock.
- **Run record.** It holds the prompt version, the date, the steps with their arguments,
  the gateway request id of every model call, and the answer.
- **Demo (FR-018).** `agent:demo` connects to the server's HTTP transport, prints the
  answer and the run record, and exits 0 only when answered.
- **Seed (T029).** `demo/seed-audit.sql` holds the synthetic audit history.

## Files touched

- `apps/mcp-server/src/agent/`:
  - `action.ts`: `AgentActionSchema`, `extractAction`;
  - `gateway-model.ts`;
  - `run-agent.ts`: the loop and the run record;
  - `demo.ts`: the CLI.
- `apps/mcp-server/prompts/system.v1.md`: the versioned system prompt.
- `apps/mcp-server/demo/seed-audit.sql`: synthetic, content-free audit rows for the two
  days before today.
- `apps/mcp-server/package.json`:
  - `ai ^6.0.319`, `@ai-sdk/mcp 1.0.100`, `@ai-sdk/openai-compatible ^2.0.88` (all `ai-v6`);
  - the `agent:demo` script.
- `apps/mcp-server/test/agent-action.test.ts` (T022) and `agent.test.ts` (T023: US5-1 …
  US5-5).
- `apps/mcp-server/test/support/fake-gateway.ts`:
  - `POST /v1/chat/completions` with scripted replies, a contract check on the body and
    `x-request-id`s;
  - a `cost` override for the spend scenario.
- `apps/mcp-server/README.md` (the Agent section), `README.md` (the 009 status entry),
  `docs/architecture.md` (the MCP host, server and agent edges), `CLAUDE.md` §12
  (`agent:demo`).

## Decisions

- **The AI SDK provider is kept (R-09 risk resolved).**
  `@ai-sdk/openai-compatible` 2.0.88 sends a body that the strict
  `ChatCompletionRequestSchema` accepts:
  - `model`, `messages`, `temperature`;
  - `system` arrives as the first message.

  The fake gateway parses every body with that contract and would answer `400` otherwise.
  US5-2 is green, so the `fetch` fallback of R-09 was not needed.
- **`system` option, not a system message.** AI SDK 6 warns about system messages inside
  `messages` (a prompt-injection risk). The prompt goes in `generateText({ system })`; the
  provider still sends it as the first message, which US5-5 checks.
- **Tool calls go through `toolsFromDefinitions(listTools())`.** `MCPClient` 1.0.100 has no
  public `callTool`; each tool's `execute` returns the raw MCP result, including
  `isError` results, which become error observations. Error codes in the run record:
  - the tool error code, when the text parses with `McpToolErrorSchema`;
  - `invalid_arguments`, for the SDK's input validation errors;
  - `mcp_error`, when the MCP call itself fails.
- **The prompt lives at `apps/mcp-server/prompts/`, not `src/agent/prompts/`.** This
  deviates from `tasks.md` T026. It follows the repository's convention
  (`apps/gateway/prompts`, `packages/evals/prompts`). The path is `../../prompts` from
  both `src/agent/` and `dist/agent/`, so the build needs no copy step.
- **Gateway errors are read loosely.** The envelope is parsed only for `error.type` and
  `error.requestId`; the request id prefers the `x-request-id` header. A network failure
  is `gateway_unreachable`. The failing call's request id is also in `requestIds`.
- **At the step limit, the answer is "I could not answer within 6 steps"**, as
  `contracts/agent-protocol.md` says, with `stopReason: "step_limit"`.
- **The seed's numbers are fixed in the file.**
  - The day before yesterday: `anthropic-sonnet` $0.31 and `mistral-small` $0.11, total
    $0.42.
  - Yesterday: `anthropic-sonnet` 24 × $0.0305 = $0.732 and `mistral-small` $0.11, total
    $0.842.
  - It uses fixed UUIDs (`…-8000-00000000NNNN`), a fixed hex `request_hash` and
    `on conflict (id) do nothing`.

## How it was verified

```bash
pnpm lint        # exit 0
pnpm typecheck   # 7 packages green
pnpm arch        # ✔ no dependency violations found (146 modules, 503 dependencies cruised)
pnpm test        # Test Files 116 passed; Tests 1154 passed | 27 skipped (after rebase on #50)
                 # (@tamiz/mcp-server: 73 tests in 9 files)
```

**Seed fixture.** There is no Postgres on this machine, so the fixture ran in PGlite
(`@electric-sql/pglite` 0.3.15, in the scratchpad, not a repository dependency):
1. the gateway's `apps/gateway/drizzle/0000_init.sql` was applied first;
2. the seed ran twice: 114 rows both times;
3. sums by UTC day were 2026-10-29 $0.4200 and 2026-10-30 $0.8420;
4. by day and target: `anthropic-sonnet` $0.3100 and $0.7320, `mistral-small` $0.1100 and
   $0.1100, `ollama-llama` $0.

**Demo against the real stack (T030, partial).**

Setup:
- the gateway: `tsx src/main.ts`, `policies/default.yaml`, port 3300;
- placeholder provider keys, so the policy loads; `tamiz-local` pins the route to
  `ollama-llama`, so they are never used;
- no privacy service, no Postgres (the in-memory audit log), and no Ollama;
- the MCP server: `dist/main.js --transport http`, port 3101;
- `agent:demo` with a client key and an admin key.

Run record:

```json
{
  "question": "why did spend rise yesterday?",
  "promptVersion": "system.v1",
  "model": "tamiz-local",
  "today": "2026-10-31",
  "steps": [],
  "requestIds": ["65c27a3c-f833-424f-87c6-a3f49dde8f63"],
  "stopReason": "gateway_error",
  "gatewayError": { "type": "provider_error", "requestId": "65c27a3c-f833-424f-87c6-a3f49dde8f63" }
}
```

Exit code 1. Then
`GET /v1/admin/audit?rule=pinned-local` with the admin key returned:

```text
65c27a3c-f833-424f-87c6-a3f49dde8f63 demo pinned-local ollama-llama local failed provider_error
c55cc3ba-cc61-4363-9263-e61e068c5748 demo pinned-local ollama-llama local failed provider_error
```

(`c55cc3ba…` is a first run that had a `--` left in the question. That was a demo bug,
fixed before the second run.)

This proves, on the real stack, that the agent's model call is a normal gateway request:
- client id `demo`, rule `pinned-local`, target `ollama-llama`, residency `local`;
- audited with the request id the agent recorded;
- with no Ollama, the gateway fails the call and the agent stops with the gateway's error
  type and request id (US5-4 behaviour).

It does not prove the answered run of US5-6. The full demo was not run:
- no Ollama with `llama3.1:8b`;
- no Postgres to hold the seed;
- no Docker daemon to start either.

`@ai-sdk/mcp` was also checked over the real HTTP transport: `listTools` returned the four
tools, and `get_cost_report` returned a contract-valid report.

## Pending / follow-ups

- **T030 / US5-6 / SC-004, the answered demo, is not recorded.** On a machine with Docker:
  1. `docker compose up postgres privacy`, and Ollama with `llama3.1:8b`;
  2. `psql "$DATABASE_URL" -f apps/mcp-server/demo/seed-audit.sql`;
  3. `pnpm --filter @tamiz/mcp-server start:http`, then `agent:demo -- "why did spend
     rise yesterday?"`;
  4. record the transcript, the run record, and
     `GET /v1/admin/audit?rule=pinned-local` showing one `ollama-llama` entry per request
     id.

  If `llama3.1:8b` cannot follow the format within 6 steps, record that and try
  `qwen2.5:3b` with a policy override; do not raise the step limit. This is new backlog row
  `T-009-06`, which depends on `T-OPS-01` (the compose stack).
- `contracts/tools.md`, error table: the input-validation row (see `T-009-02`).
- `T-009-05` (optional, already in the backlog): native tool calling through the gateway.

## Pitfalls for the next session

- **`pnpm <script> -- "<question>"` passes the `--` through** to `process.argv`.
  `demo.ts` drops a leading `--`.
- **The real gateway refuses `default.yaml` without the three provider keys**, even when
  every request is pinned local. Placeholders are enough for local-only checks.
- **`tsx` children survive stopping their background wrapper.** Free the ports (3300,
  3101) by PID before restarting.
- **The run record is safe to share; the observations are not printed.** It holds tool
  arguments and the answer, never tool results. Keep it that way: tool results go only to
  the model, through the gateway.

## Links

- Spec / plan / tasks: `specs/009-mcp-agent/`
- ADRs: none added
- Related task records: `docs/tasks/done/T-009-02-mcp-server.md`, `docs/tasks/done/T-009-03-audit-cost-tools.md`, `docs/tasks/done/T-003-05-streaming.md`
