# presentation

HTTP only: the Hono app, its routes, middlewares and the mappers between HTTP shapes and
domain types. This layer may import `presentation/`, `application/`, `domain/` and
`@tamiz/contracts` (rule `presentation-allowed-imports`); never `infrastructure/` or
`main.ts`. Adapters reach it through the `deps` object of `createApp`, which `main.ts`
builds.

Current modules: `app.ts` (`createApp(deps)` on `OpenAPIHono`: body limit, validation
hook, `/openapi.json`), `openapi-schemas.ts` (the contract schemas as named OpenAPI
components), `routes/health.ts`, `routes/chat-completions.ts`,
`middlewares/request-id.ts`, `middlewares/api-key-auth.ts` (verification is injected as
`deps.authenticate`), `mappers/error-envelope.ts` (with `fromZodIssues`),
`mappers/inference-request.ts` and `mappers/chat-completion-response.ts`.
