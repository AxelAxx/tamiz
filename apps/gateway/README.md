# apps/gateway

The Tamiz gateway: a Hono v4 HTTP API on Node.js 22 that receives OpenAI-compatible chat
completion requests, inspects them for personal data through the privacy service, decides
a route with a declarative policy, executes it with its own resilience layer (timeout,
retry, circuit breaker, fallback chain) and audits every decision without storing content.
Strict Clean Architecture (`domain` / `application` / `infrastructure` / `presentation`,
only `main.ts` wires adapters), enforced by dependency-cruiser. Created in feature
`001-contracts-and-skeleton` (task `T-001-04`). See `docs/architecture.md` and ADR-0001.
