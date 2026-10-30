# Contracts (review projection)

The source of truth is the Zod schemas in `packages/contracts` and the OpenAPI document
the gateway serves at `GET /openapi.json` (feature 002). The files here are design-time
projections for reviewing this feature before the code exists; they are not shipped or
imported.

- `http.md` — what `POST /v1/chat/completions` adds: the `x-tamiz-fallback` and
  `retry-after` headers, the 451/503/504 cases, and the streaming (server-sent events)
  response with its chunk, usage and error events.
- `policy.example.yaml` — the default policy after this feature: the optional
  `resilience` section and the `residency` statements (→ `apps/gateway/policies/default.yaml`
  in `T-003-04`).
