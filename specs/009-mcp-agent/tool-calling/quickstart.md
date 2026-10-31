# Quickstart: validating native tool calling

**Addendum**: `specs/009-mcp-agent/tool-calling/`. Contracts: `contracts/`.

## 1. Without services (every machine)

```bash
pnpm install
pnpm test -- apps/gateway/test/contracts apps/gateway/test/llm apps/gateway/test/domain
pnpm test -- apps/gateway/test/chat-completions-tools.test.ts apps/gateway/test/chat-completions-tools-stream.test.ts
pnpm test -- apps/mcp-server/test/agent-native.test.ts
pnpm lint && pnpm typecheck && pnpm arch && pnpm build
```

Expected: the US1-US8 scenario tests pass; every pre-existing test passes unchanged
(SC-005).

## 2. Simulator with the real privacy service

```bash
docker compose up privacy
pnpm --filter @tamiz/gateway dev
```

POST the request of `contracts/chat-completion-tools.md` to `/v1/simulate` with a client
key. Expected: an entity `DNI` with `location.kind: "content"`, `messageIndex: 2`;
`sensitivity: "critical"`, `privacyAction: "restrict_to_local"`, chain `[ollama-llama]`
(backlog acceptance, US2-1).

Replace the DNI by a name only: `privacyAction: "anonymize"`, `providerMessages[2]` holds
`<PERSON_1>` and `notice` is the v2 text.

## 3. A real two-turn exchange (needs Ollama)

```bash
ollama pull qwen2.5:1.5b
```

Send the request with `tools` and only the user message to `/v1/chat/completions`
(`model: "tamiz-local"`). Expected: `finish_reason: "tool_calls"` and a `get_patient` call.
Append the call and a `tool` message; expected: a text answer and, in
`GET /v1/admin/audit`, an entry with `tools: {declared: 1, toolMessages: 1, called: []}`.

## 4. Leak eval

```bash
pnpm --filter @tamiz/evals generate:datasets -- --check
pnpm evals
```

Expected in the report: `values.tool_messages ≥ 40`, `leak_rate.DNI = 0` and the other
bounds of `contracts/leak-eval-tools.md`. CI's `evals` job runs the same.

## 5. Agent in native mode

```bash
pnpm --filter @tamiz/mcp-server start:http
TAMIZ_AGENT_TOOL_PROTOCOL=native pnpm --filter @tamiz/mcp-server agent:demo -- "why did spend rise yesterday?"
```

Expected: the run record shows `protocol: "native"` and tool steps with call ids; the
gateway's audit has the agent's requests with `tools.called` naming the MCP tools.
