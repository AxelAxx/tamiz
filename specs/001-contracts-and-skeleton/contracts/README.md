# Contracts (review projection)

The source of truth for every Tamiz contract is the Zod schema in `packages/contracts`
(constitution principle II). The OpenAPI document is derived from those schemas with
`@hono/zod-openapi` starting in feature 002, when the first business endpoint exists.

`openapi.yaml` in this folder is a **design-time projection written for review** of
`spec.md` and `data-model.md`: it lets a reviewer see the shapes in a familiar format
before the code exists. It is not shipped, not served and not imported by any package.
When the generated document exists (feature 002), this file is deleted and the
generated one becomes the reference; a contract test then asserts the generated
document matches the Zod schemas.

Covered here: `GET /health`, the `ErrorEnvelope` used by every endpoint, and the
non-streaming subset of `POST /v1/chat/completions` request and response (the endpoint
itself is implemented in feature 002; only its schemas belong to this feature).
