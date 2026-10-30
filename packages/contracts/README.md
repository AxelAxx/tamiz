# packages/contracts

Zod 4 schemas that are the single source of truth for every public contract (constitution
II). TypeScript types and OpenAPI are derived from here, never hand-written. Only runtime
dependency allowed: `zod`.

Contents since `T-001-03` (feature 001, `specs/001-contracts-and-skeleton/data-model.md`
sections 1–5):

| Module | Exports |
|---|---|
| `src/branded.ts` | `RequestIdSchema`, `PolicyIdSchema`, `UsdSchema`, `MillisecondsSchema`; types `RequestId`, `PolicyId`, `Usd`, `Milliseconds`; constructors `requestId`, `policyId`, `usd`, `milliseconds` (parse and throw) and `safeRequestId`, `safePolicyId`, `safeUsd`, `safeMilliseconds` (return a Zod safe-parse result) |
| `src/chat-completion.ts` | OpenAI-compatible non-streaming subset: `ChatMessageSchema`, `ChatCompletionRequestSchema` (`stream` accepts only `false` until feature 003), `ChatCompletionChoiceSchema`, `ChatCompletionUsageSchema`, `ChatCompletionResponseSchema` and their types |
| `src/health.ts` | `HealthCheckSchema`, `HealthResponseSchema` (`checks` required when `status` is `degraded`) and their types |
| `src/error.ts` | `ErrorTypeSchema` (seven closed values), `ErrorEnvelopeSchema`, `errorTypeToHttpStatus` and their types |
| `src/routing-policy.ts` (feature 002, `T-002-05`) | `RoutingPolicySchema` (the policy file's shape; cross-field rules live in the gateway domain), `ModelTargetSchema`, `RoutingRuleSchema`, `RuleConditionSchema`, `PricingSchema`, `TargetIdSchema`, `RuleIdSchema`, the closed lists `ProviderNameSchema`, `ResidencySchema`, `TaskTypeSchema`, `TaskSizeSchema`, and their `*Dto` types |

Every object schema is a `z.strictObject`: unknown keys are rejected with an
`unrecognized_keys` issue that names them. Later features add the admin API (audit, cost, providers, policy), the simulator, the mirrored
privacy-service contract and the MCP tool schemas.

Scripts: `pnpm --filter @tamiz/contracts typecheck | test | build` (`tsc --noEmit`,
`vitest run` with type tests in `test/*.test-d.ts`, `tsc -p tsconfig.build.json` → `dist/`).
