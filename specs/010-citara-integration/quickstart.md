# Quickstart: Citara Integration

Validation guide for `T-010-02` and `T-010-03`. Variables and output fields:
`data-model.md`; headers, errors and aliases: `contracts/integration-contract.md`.

## 1. Automated (no Docker, no provider keys)

```bash
pnpm install
pnpm build
pnpm --filter @tamiz/example-citara-client test
```

The suite starts the gateway E2E harness with scripted providers on free ports and runs
every scenario of US1-US4 against it. Expected: all green.

## 2. By hand against the harness

Terminal 1:

```bash
TAMIZ_E2E_PROVIDERS=scripted pnpm --filter @tamiz/gateway e2e-gateway
```

Terminal 2 (the harness's test keys are printed in `apps/gateway/scripts/e2e-gateway.ts`;
they are fixtures, not secrets):

```bash
TAMIZ_BASE_URL=http://127.0.0.1:3210/v1 TAMIZ_API_KEY=<harness citara key> \
TAMIZ_ADMIN_KEY=<harness admin key> \
pnpm --filter @tamiz/example-citara-client start -- "Summarise the case of the customer with DNI 12345678Z"
```

Expected: `status: 200`, `sensitivity: critical`, `privacy: restrict_to_local`,
`route: ollama-llama`, an `audit:` line whose `requestId` equals `request_id`, exit 0.

Other checks:

- `TAMIZ_MODEL=tamiz-frontier` and the prompt `Call Ana García back` → `status: 451`,
  `error_type: policy_blocked`, `retryable: false`, `attempts: 1`, exit 1.
- `TAMIZ_STREAM=true` → same headers, the answer printed after the deltas.
- A wrong `TAMIZ_API_KEY` → `error_type: unauthorized`, exit 1, the key absent from output.

## 3. Full stack (`T-010-03`, needs `T-OPS-01`)

```bash
docker compose up -d
pnpm --filter @tamiz/gateway api-key:add citara
pnpm --filter @tamiz/gateway api-key:add ops --admin
TAMIZ_BASE_URL=http://localhost:3000/v1 TAMIZ_API_KEY=<citara key> TAMIZ_ADMIN_KEY=<ops key> \
pnpm --filter @tamiz/example-citara-client start -- "Summarise the case of the customer with DNI 12345678Z"
```

Expected: the answer comes from `ollama-llama` (a real local model), the audit line shows
`clientId: "citara"`; record the output (keys redacted) in the `T-010-03` task record.
