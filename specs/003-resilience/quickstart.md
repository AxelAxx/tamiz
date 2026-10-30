# Quickstart: verifying Resilience

**Feature**: `003-resilience` · **Date**: 2026-10-30

How a reviewer proves the feature works once `T-003-02` … `T-003-06` are merged. Each
step names the spec scenarios it demonstrates. The quickstart of feature 002 (key
generation, local-only run) is a prerequisite.

## Prerequisites

- Feature 002 merged and its quickstart working (`TAMIZ_API_KEYS` exported).
- For sections 4 and 6: [Ollama](https://ollama.com) with `ollama pull llama3.1:8b`.
- For section 7: Docker (Testcontainers starts Valkey; `docker compose up valkey` for
  the manual run).

## 1. Unit, property and scenario suites (US1–US5, SC-001 … SC-006)

```bash
pnpm --filter @tamiz/gateway test -- resilience execute-chain circuit route-inference
```

Expected: the timeout, retry, breaker and executor suites pass with no real waiting
(fake clock), including the property tests over ≥ 1 000 generated chains (no call
outside the allowed residencies, no retry of a non-retryable failure, attempts ≤
maximum, waits within bounds).

## 2. Fallback visible in the response (US1-1, US5-2)

With the default policy, start the gateway with an unreachable Mistral endpoint so the
first target of the default chain fails fast:

```bash
MISTRAL_BASE_URL=http://127.0.0.1:9/v1 pnpm --filter @tamiz/gateway dev
curl -s -i http://localhost:3000/v1/chat/completions \
  -H "authorization: Bearer tmz_<your key>" -H "content-type: application/json" \
  -d '{"model":"tamiz-auto","messages":[{"role":"user","content":"What is the capital of Portugal?"}]}'
```

Expected: `200` from `openai-mini` (with a real `OPENAI_API_KEY`) or from `ollama-llama`,
`x-tamiz-fallback: mistral-small:network` (plus `openai-mini:…` if it also failed), and
one `fallback` event per abandoned target in the gateway log, without message content.

## 3. Circuit opening and 503 (US4-1, US4-2, US4-7)

Keep the broken Mistral endpoint and use `TAMIZ_POLICY_FILE` pointing at a copy of
`local-only.yaml` whose single target points at a stopped Ollama. Send 6 requests:

Expected: the first requests return 502 after their attempts; once the threshold is
reached the log shows `circuit.changed` `closed → open`, and the next request returns
`503 provider_unavailable` with `retry-after: 30` (or less) without any call to the
target. After the cool-down, one trial is let through (`half_open`).

## 4. Residency block (US2-1, US2-3)

```bash
pnpm --filter @tamiz/gateway test -- residency
```

Expected: the executor scenario where `long-documents-eu` would reach a US target
returns 451 `policy_blocked` and no call reaches that target. Then start the gateway
with a copy of `default.yaml` in which `long-documents-eu` lists `openai-mini` again:
the process exits 1 naming `rules.2.route.1` and the residency.

## 5. Streaming (US6-1 … US6-4)

```bash
curl -N http://localhost:3000/v1/chat/completions \
  -H "authorization: Bearer tmz_<your key>" -H "content-type: application/json" \
  -d '{"model":"tamiz-local","stream":true,"messages":[{"role":"user","content":"Cuenta hasta cinco."}]}'
```

Expected: `data:` lines with `chat.completion.chunk` objects, a usage chunk with
`cost_usd: 0`, then `data: [DONE]`; response headers include `x-tamiz-route:
ollama-llama`. Stopping Ollama in the middle of an answer ends the stream with one
`data: {"error":…}` line and no `[DONE]`. Mid-stream behaviour is also covered by
`pnpm --filter @tamiz/gateway test -- stream`.

## 6. Shared circuit state (US7, SC-008)

```bash
pnpm --filter @tamiz/gateway test -- redis-circuit-state
```

Expected: the Testcontainers suite starts Valkey, opens a circuit through one adapter
and observes it from a second one within 1 s; stopping the container switches both to
in-memory state with one warning each and requests keep being served. Without Docker
the suite is reported as skipped with the reason.

## 7. OpenAPI (FR-019, contracts/http.md)

```bash
curl -s http://localhost:3000/openapi.json | grep -o '"provider_unavailable"\|"text/event-stream"\|"ChatCompletionChunk"' | sort -u
```

Expected: the three strings are present.
