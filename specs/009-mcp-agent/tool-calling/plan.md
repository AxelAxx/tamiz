# Implementation Plan: Native Tool Calling Through the Gateway

**Branch**: `T-009-05-native-tool-calling` | **Date**: 2026-10-31 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/009-mcp-agent/tool-calling/spec.md` (addendum
to feature 009, research T-R01).

## Summary

The gateway's chat contract gains OpenAI's function-calling subset (`tools`,
`tool_choice`, assistant `tool_calls`, `tool` messages, `finish_reason: "tool_calls"`,
streamed tool-call deltas). The domain `Message` becomes a union and the request carries
tool definitions; the provider port and the single AI SDK adapter pass them as tools
without `execute`. Privacy works on a list of *inspected texts* (contents, arguments, tool
results, tool definitions): one inspection, one placeholder mapping, JSON-safe replacement
in arguments, and a fail-closed downgrade to the local route when a value cannot be
replaced safely. Answers are restored in text and in every tool call's arguments, also when
streamed (one restorer per call). Audit and spans record tool counts and called names only.
The leak dataset goes to v2 with tool cases and a gate on their number. The MCP agent gains
a native protocol, on by default.

## Technical Context

**Language/Version**: TypeScript 5.x strict, ESM, Node.js 22 LTS.

**Primary Dependencies**: `ai` 6 (`tool`, `jsonSchema`, `generateText`, `streamText`),
`@ai-sdk/openai`, `@ai-sdk/anthropic`, `@ai-sdk/mistral`, `@ai-sdk/openai-compatible` (all
already pinned, no new dependency); Zod 4 in `packages/contracts`; Drizzle for one
migration.

**Storage**: PostgreSQL 17, `audit_entries.tools jsonb` nullable (migration `0002_*`).

**Testing**: Vitest; MSW for adapter upstream shapes (four providers, completion and
stream); in-process `app.request()` with fakes; property tests (fast-check, already used
for `decide`) for `placeJsonSpan` and restore-in-JSON; eval unit tests for the scorer and
the generator; the `evals` CI job for the gate.

**Target Platform**: the gateway container and local dev (Windows without Docker/Ollama:
everything but the evals job runs locally).

**Project Type**: monorepo web service + packages.

**Performance Goals**: no added provider latency; inspection sends more texts in the same
single call to the privacy service; restoration stays O(text).

**Constraints**: content never reaches logs, spans or DB (V); residency violations block
(VI); requests without tool fields unchanged (FR-005).

**Scale/Scope**: 30 tasks; touches contracts, gateway domain/application/infrastructure/
presentation, evals, mcp-server agent.

## Constitution Check

| # | Principle | How this plan complies |
|---|---|---|
| I | Clean Architecture | Inspected texts, JSON span placement, restoration and the downgrade rule are pure domain; the AI SDK mapping stays in `infrastructure/llm/ai-sdk-provider.ts`; presentation maps DTO ↔ domain. dependency-cruiser unchanged. |
| II | Contract-first | All wire changes start in `packages/contracts` (chat completion, simulate, audit, leak case); OpenAPI derives from them. |
| III | Spec before code | This spec, plan and tasks; GWT scenarios map 1:1 to tests (tasks.md). Implementation waits for Alex's approval. |
| IV | Evals | Leak dataset v2 with ≥ 40 tool cases, unchanged per-kind thresholds plus `values.tool_messages ≥ 40`. |
| V | Privacy by default | Every text the provider reads is inspected; arguments/results/definitions never logged, traced or stored; the mapping lives only in closures; GenAI content attributes never set; SC-004 marker test. |
| VI | Fail fast | Unsafe anonymization downgrades to local with an event, never sends unprotected; malformed tool messages are 400; tool rejection by a provider is a typed provider error. |
| VII | Strict TS | Discriminated unions for messages and parts; no `any` (JSON Schema typed as `Record<string, unknown>`). |
| VIII | Testability | Fakes extended in `packages/test-utils` (scripted provider emits tool calls and tool-call stream parts; scripted detector over texts). |
| IX | Composition | No new middleware; the routed stream composes per-call restorers. |
| X | Simplicity | No capability flag, no policy section for tools, no new eval id; the agent keeps its own loop. |

Gate: pass. Post-design re-check: pass (no new port, no new package).

## Project Structure

### Documentation (this addendum)

```text
specs/009-mcp-agent/tool-calling/
├── spec.md
├── plan.md               # this file
├── research.md           # T-R01 … T-R15 (decisions D1-D8 flagged for review)
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── chat-completion-tools.md
│   └── leak-eval-tools.md
├── checklists/requirements.md
└── tasks.md
```

### Source Code (files touched)

```text
packages/contracts/src/
├── chat-completion.ts      # tools, tool_choice, message union, tool_calls, chunk deltas
├── simulate.ts             # entity location, notAnonymizable, message union
└── audit.ts                # tools summary
packages/test-utils/src/    # scripted provider/detector support for tool calls
apps/gateway/
├── src/domain/model/
│   ├── inference-request.ts   # Message union, ToolDefinition, ToolCall, ToolChoice
│   ├── inspected-text.ts      # new
│   ├── json-spans.ts          # new
│   ├── placeholders.ts        # anonymizeTexts, restoreJson
│   ├── restore-stream.ts      # escape option
│   ├── routing-decision.ts    # anonymizable → restrict_to_local downgrade
│   ├── task-classifier.ts     # classify over inspected texts
│   └── audit-entry.ts         # tools summary
├── src/application/
│   ├── ports/llm-provider.port.ts          # tools, toolChoice, toolCalls, content parts
│   ├── use-cases/inspect-sensitivity.ts    # texts, analyze-v2
│   ├── use-cases/protect-messages.ts       # → protectRequest
│   ├── use-cases/route-inference.ts        # pass tools, restore calls
│   ├── use-cases/stream-inference.ts       # per-call restorers, first content part
│   ├── use-cases/simulate-policy.ts        # locations
│   ├── audit/with-audit.ts, tracing/with-tracing.ts
├── src/infrastructure/
│   ├── llm/ai-sdk-provider.ts   # tools, history parts, stream tool parts
│   ├── llm/mistral.ts           # id aliasing
│   └── persistence/schema.ts, audit-log-repository.ts
├── src/presentation/mappers/    # request, response, chunk, simulate
├── prompts/anonymization-notice.v2.md
└── drizzle/0002_*.sql
packages/evals/src/
├── datasets.ts, synthetic/generate.ts   # v2 cases with tools
├── evals/leak.ts                        # texts sent, tool metric
└── thresholds.ts                        # values.tool_messages ≥ 40
apps/mcp-server/src/
├── config.ts                 # TAMIZ_AGENT_TOOL_PROTOCOL
└── agent/run-agent.ts, native-protocol.ts (new), prompts/system.v2.md
```

**Structure Decision**: no new package or app; the change follows the existing layers.

## Requirement → task mapping

| Requirements | Tasks (tasks.md) |
|---|---|
| FR-001 … FR-005 | T002 – T005, T009, T012 |
| FR-006, FR-016, FR-017 | T010, T011, T015, T016, T018 – T020 |
| FR-007 … FR-014 | T006 – T008, T013, T014, T017 |
| FR-015 | T024 |
| FR-018 … FR-020 | T021 – T023 |
| FR-021 … FR-024 | T025, T026 |
| FR-025 | T027, T028 |

## Complexity Tracking

| Addition | Why needed | Simpler alternative rejected because |
|---|---|---|
| JSON span placement in the domain | Anonymized arguments must stay valid JSON (FR-010) | Leaf-by-leaf inspection loses NER context; dropping arguments breaks the conversation |
| Anonymize → restrict_to_local downgrade | A value that cannot be replaced must not leave unprotected (V, VI) | Sending broken JSON, or the value, is worse |
| Mistral id aliasing | The Mistral API rejects non-9-char ids (FR-016) | Normalizing all ids changes what the client must match |
