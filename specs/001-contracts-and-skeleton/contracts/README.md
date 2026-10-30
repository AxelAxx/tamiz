# Contracts (review projection)

The source of truth for every Tamiz contract is the Zod schema in `packages/contracts`
(constitution principle II). The OpenAPI document is derived from those schemas with
`@hono/zod-openapi` and served by the gateway at `GET /openapi.json` (OpenAPI 3.1) since
feature 002 (`T-002-06`); `apps/gateway/test/openapi.test.ts` asserts its content.

The hand-written `openapi.yaml` that used to live here was a design-time projection for
the review of `spec.md` and `data-model.md`. It was deleted when the generated
document replaced it (001 tasks T076, spec 002 FR-031). To read the current document,
start the gateway and fetch `/openapi.json`.
