# Quickstart: verifying Privacy-Aware Routing

**Feature**: `005-privacy-aware-routing` · **Date**: 2026-10-30

This is how a reviewer proves the feature works once `T-005-02` … `T-005-06` are merged.
Each step names the spec scenarios it demonstrates.

## Prerequisites

- **Earlier features:** features 002–004 merged and their quickstarts working
  (`TAMIZ_API_KEYS` exported; the privacy service runnable with uv or Docker).
- **For sections 3–5:** the privacy service running on `http://localhost:8001`
  (`cd services/privacy && uv run python -m privacy.main`), plus
  `TAMIZ_PRIVACY_URL=http://localhost:8001` for the gateway.
- **For section 4:** [Ollama](https://ollama.com), with `ollama pull llama3.1:8b`.

## 1. Domain and application suites (US1–US7, SC-001 … SC-003, SC-006)

```bash
pnpm --filter @tamiz/gateway test -- privacy placeholders restore-stream simulate inspect-sensitivity
```

Expected:
- the property tests pass over at least 10 000 generated decisions (critical never in
  clear outside `local`/`eu`; `block` has no target);
- the streaming restoration equals the non-streaming one for every chunking;
- the shared placeholder vectors pass;
- the capture test finds no test value in logs, events, errors, headers or the cache.

## 2. Contract with the privacy service (FR-007, FR-010)

```bash
pnpm --filter @tamiz/gateway test -- privacy-service-drift http-pii-detector
```

Expected:
- the Zod mirror agrees with `services/privacy/openapi.json`;
- the MSW tests show that a 5xx, a timeout or a malformed body is a detector failure,
  never "no data".

## 3. Simulate before sending anything (US5)

Start the privacy service and the gateway (default policy). Then:

```bash
curl -s localhost:3000/v1/simulate -H "authorization: Bearer $TAMIZ_KEY" -H 'content-type: application/json' -d '{"model":"auto","messages":[{"role":"user","content":"Resume el informe de Lucía Fernández (lucia@example.com)."}]}'
```

Expected:
- `sensitivity: high`, action `anonymize`, a chain of EU or local targets;
- `providerMessages` with `<PERSON_1>` and `<EMAIL_1>`;
- no provider was called (the gateway log shows no `routing event` attempts).

With a DNI in the text, expect `critical`, `restrict_to_local` and a chain with
`ollama-llama` only.

## 4. A critical request stays local (US1-1, US1-6)

```bash
curl -si localhost:3000/v1/chat/completions -H "authorization: Bearer $TAMIZ_KEY" -H 'content-type: application/json' -d '{"model":"auto","messages":[{"role":"user","content":"Mi DNI es 12345678Z, ¿qué trámites necesito?"}]}'
```

Expected:
- `x-tamiz-route: ollama-llama`, `x-tamiz-sensitivity: critical`,
  `x-tamiz-privacy: restrict_to_local`;
- stop Ollama and repeat: `503 provider_unavailable`, never a non-local fallback.

## 5. Fail closed (US3)

Stop the privacy service and repeat the request from section 4 with a text that has no
personal data. Expected:
- `x-tamiz-sensitivity: unknown` and `x-tamiz-privacy: restrict_to_local`;
- the request goes to the local model;
- one `privacy.detector_failed` event in the log.

With `onDetectorError: block` in the policy, expect `503 privacy_unavailable`.

## 6. Boot checks (US6, US3-5)

- Start the gateway without `TAMIZ_PRIVACY_URL`: exit 1, naming the variable.
- Start with a policy where `critical: { action: allow }`: exit 1, naming
  `privacy.levels.critical`.

## 7. OpenAPI (FR-019)

```bash
curl -s localhost:3000/openapi.json | grep -c '"/v1/simulate"'
```

Expected: `1`, and the `SimulateResponse` component is present.
