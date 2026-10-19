# presentation

HTTP only: the Hono app, its routes, middlewares and the mappers between HTTP shapes and
domain types. This layer may import `presentation/`, `application/`, `domain/` and
`@tamiz/contracts` (rule `presentation-allowed-imports`); never `infrastructure/` or
`main.ts`. Adapters reach it through the `deps` object of `createApp`, which `main.ts`
builds.

Current modules: `app.ts` (`createApp(deps)`), `routes/health.ts`,
`middlewares/request-id.ts`, `mappers/error-envelope.ts`. Feature 002 adds
`routes/chat-completions.ts`, the API-key middleware and the DTO mappers.
