# Quickstart: verifying Provider Routing

**Feature**: `002-provider-routing` · **Date**: 2026-10-18

How a reviewer proves the feature works once `T-002-02` … `T-002-08` are merged. Each
step names the spec scenario it demonstrates. Feature 001's quickstart (install, gates)
is a prerequisite.

## Prerequisites

- Feature 001 merged: `pnpm install && pnpm lint && pnpm typecheck && pnpm arch && pnpm test` green.
- For the local-only path (SC-009): [Ollama](https://ollama.com) running with
  `ollama pull llama3.1:8b` (model download excluded from the 10-minute budget).
- For the full default policy: `MISTRAL_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`.

## 1. Generate an API key (US5)

```bash
pnpm --filter @tamiz/gateway generate-api-key demo
```

Expected: one line `key: tmz_…` (shown once) and one line
`TAMIZ_API_KEYS entry: demo:<64 hex chars>`. Export the entry:

```bash
export TAMIZ_API_KEYS="demo:<64 hex chars>"
```

## 2. Local-only run (US1, US2, US7, SC-009)

```bash
TAMIZ_POLICY_FILE=policies/local-only.yaml pnpm --filter @tamiz/gateway dev
```

In another terminal:

```bash
curl -s -i http://localhost:3000/v1/chat/completions \
  -H "authorization: Bearer tmz_<your key>" -H "content-type: application/json" \
  -d '{"model":"tamiz-auto","messages":[{"role":"user","content":"Resume en una frase: Tamiz es un gateway LLM consciente de la privacidad."}]}'
```

Expected: `200`, headers `x-tamiz-route: ollama-llama`, `x-tamiz-rule: default`,
`x-request-id`, body with `object: "chat.completion"`, `model: "llama3.1:8b"`, one
assistant choice, `usage.cost_usd: 0` (US1-1, US1-2, US7-2).

## 3. Authentication (US5)

```bash
curl -s -i http://localhost:3000/v1/chat/completions -H "content-type: application/json" -d '{"model":"x","messages":[{"role":"user","content":"hi"}]}'
```

Expected: `401`, `{"error":{"type":"unauthorized",…}}`, no `x-tamiz-route` (US5-1).
Repeat with `-H "authorization: Bearer tmz_wrong"` → `401` (US5-2). `GET /health`
without a key → `200` (US5-5). The request log line shows `clientId: "demo"` for the
valid key and never the key (US5-3).

## 4. Validation errors (US1-3)

```bash
curl -s -i http://localhost:3000/v1/chat/completions \
  -H "authorization: Bearer tmz_<your key>" -H "content-type: application/json" \
  -d '{"model":"x","messages":[],"stream":true,"extra":1}'
```

Expected: `400`, `error.type: "invalid_request"`, message listing `messages`, `stream`
and `extra` with expected formats and no values; no `x-tamiz-route`.

## 5. Policy rules and cost ordering (US2-4, US3-5, US4)

Start with the default policy (needs the three API keys):

```bash
pnpm --filter @tamiz/gateway dev
```

| Request content | Expected `x-tamiz-rule` | Expected `x-tamiz-route` | Expected `model` |
|---|---|---|---|
| "Escribe una función en Python que ordene una lista" | `code-to-frontier` | `anthropic-sonnet` | `claude-sonnet-4-5` |
| "Clasifica el sentimiento de: 'muy buen producto'" | `cheap-short-tasks` | `ollama-llama` | `llama3.1:8b` |
| "Summarize: <text of ~20 000 characters>" | `long-documents-eu` | `mistral-small` | `mistral-small-latest` |
| any text with `"model":"tamiz-local"` | `pinned-local` | `ollama-llama` | `llama3.1:8b` |
| "What is the capital of Portugal?" | `default` | `mistral-small` | `mistral-small-latest` |

`usage.cost_usd` on the Mistral answer equals
`prompt_tokens × 0.1 / 1e6 + completion_tokens × 0.3 / 1e6` (US7-1).

## 6. Invalid policy and missing provider settings (US2-1 … US2-3)

```bash
printf 'id: bad\nversion: 1\ntargets:\n  - {id: a, provider: ollama, model: m, region: local, residency: local, pricing: {inputUsdPerMillion: 0, outputUsdPerMillion: 0}}\nrules:\n  - {id: r, when: {}, route: [nope]}\ndefault: {route: [a]}\n' > /tmp/bad.yaml
TAMIZ_POLICY_FILE=/tmp/bad.yaml pnpm --filter @tamiz/gateway start; echo "exit: $?"
```

Expected: no port bound, stderr `rules.0.route.0: unknown target "nope"`, exit code 1.
Then, with the default policy and `MISTRAL_API_KEY` unset:

```bash
MISTRAL_API_KEY= pnpm --filter @tamiz/gateway start; echo "exit: $?"
```

Expected: stderr `target mistral-small: provider mistral needs MISTRAL_API_KEY`, exit 1,
no secret printed. Unit coverage: `apps/gateway/test/policy/file-policy-loader.test.ts`,
`apps/gateway/test/config/provider-settings.test.ts`; process coverage:
`apps/gateway/test/boot.integration.test.ts` (extended).

## 7. Provider failures (US1-6, US6)

`apps/gateway/test/llm/*.adapter.test.ts` run each adapter against MSW handlers for
success, 429, 500, 401, 400, malformed body and a stalled connection with a 200 ms
timeout, asserting the `ProviderError` cause, `retryable` flag and status, and that no
credential or body appears in the error. `apps/gateway/test/chat-completions.test.ts`
asserts the 502/504 envelopes keep `x-tamiz-route`.

## 8. Decision properties (US3)

```bash
pnpm --filter @tamiz/gateway test -- routing-decision
```

Expected: unit scenarios US3-1 … US3-5, US3-7 and the property test (US3-6, 1 000
runs) pass.

## 9. Routing dataset gate (US8, SC-001)

```bash
pnpm --filter @tamiz/gateway test -- routing-dataset
```

Expected: a table of mismatches (empty on `main`), `route accuracy: 100.0 % (N/N)`,
`task-type accuracy: …`, test passes. Edit one `expected.route` in
`packages/evals/datasets/routing.v1.jsonl` to a wrong target, re-run: the table lists
that id with expected and actual; the test still passes while accuracy ≥ 95 % and fails
once enough cases are wrong (US8-2). Revert the edit.

## 10. OpenAPI (US1-5)

```bash
curl -s http://localhost:3000/openapi.json | head -c 400
```

Expected: an OpenAPI 3.1 document with `/v1/chat/completions`, `/health`, the
`ErrorEnvelope` schema and the `x-tamiz-route` / `x-tamiz-rule` headers;
`specs/001-contracts-and-skeleton/contracts/openapi.yaml` no longer exists.

## Timing (SC-007, SC-009)

`apps/gateway/test/chat-completions.test.ts` measures the in-process round trip with a
fake provider that answers instantly: p95 under 20 ms. Section 2 end to end from a
fresh clone (model already pulled) should fit in 10 minutes; record the timing in the
`T-002-08` task record.
