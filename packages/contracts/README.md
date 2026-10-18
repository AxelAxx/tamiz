# packages/contracts

Zod schemas that are the single source of truth for every public contract: the
OpenAI-compatible chat completions API, health and error envelopes, the routing policy
document, the admin API (audit, cost, providers, policy), the simulator, the mirrored
privacy-service contract and the MCP tool schemas. TypeScript types and OpenAPI are
derived from here, never hand-written. Branded types for identifiers (`RequestId`,
`PolicyId`) and units (`Usd`, `Milliseconds`) live here too. Created in task `T-001-03`.
