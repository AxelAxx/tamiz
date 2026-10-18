# packages/contracts

Zod schemas that are the single source of truth for every public contract: the
OpenAI-compatible chat completions API, health and error envelopes, the routing policy
document, the admin API (audit, cost, providers, policy), the simulator, the mirrored
privacy-service contract and the MCP tool schemas. TypeScript types and OpenAPI are
derived from here, never hand-written. Branded types for identifiers (`RequestId`,
`PolicyId`) and units (`Usd`, `Milliseconds`) live here too. Package scaffold created in
`T-001-02`; schemas arrive in `T-001-03`.

Scripts: `pnpm --filter @tamiz/contracts typecheck | test | build` (`tsc --noEmit`,
`vitest run`, `tsc -p tsconfig.build.json` → `dist/`). Only runtime dependency allowed:
`zod`.
