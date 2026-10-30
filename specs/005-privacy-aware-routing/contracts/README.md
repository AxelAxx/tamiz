# Contracts (review projection)

The source of truth will be the Zod schemas in `packages/contracts`, with the gateway's
`GET /openapi.json` derived from them. The files here are design-time projections for
reviewing this feature before the code exists, except `placeholder-vectors.json`, which is
real test data that both implementations read.

- `http.md`: what `POST /v1/chat/completions` adds (the `x-tamiz-sensitivity` and
  `x-tamiz-privacy` headers, the `451` and `503 privacy_unavailable` cases), and the new
  `POST /v1/simulate`.
- `policy.example.yaml`: the default policy after this feature (version 3, `privacy`
  section). It becomes `apps/gateway/policies/default.yaml` in `T-005-02`.
- `simulate.example.json`: one simulator request and response pair.
- `placeholder-vectors.json`: shared placeholder test vectors, generated from the Python
  reference implementation (`services/privacy/src/privacy/domain/placeholders.py`). The
  gateway's TypeScript port must reproduce every `expected` value (research R-01).

All personal data in these files is invented.
