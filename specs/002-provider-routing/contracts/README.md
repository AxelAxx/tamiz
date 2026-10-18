# Contracts (review projection)

The source of truth for every Tamiz contract is the Zod schema in `packages/contracts`
(constitution principle II). From this feature on, the OpenAPI document is **generated**
by the gateway (`GET /openapi.json`, research R-11) and the hand-written projection of
feature 001 (`specs/001-contracts-and-skeleton/contracts/openapi.yaml`) is deleted by
task `T-002-06`.

The files here are design-time projections written for review of `spec.md` and
`data-model.md`; none is shipped or imported:

| File | What it shows |
|---|---|
| `http.md` | The chat completion endpoint: request, response extension, headers, error mapping, API-key header, OpenAPI route |
| `policy.example.yaml` | The default routing policy that `T-002-05` ships as `apps/gateway/policies/default.yaml`; the shape of `RoutingPolicySchema` |
| `routing-dataset.example.jsonl` | The header line and five sample cases of `packages/evals/datasets/routing.v1.jsonl` |

Field rules: `data-model.md` sections 2 and 6.
