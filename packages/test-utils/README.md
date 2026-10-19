# packages/test-utils

In-memory fakes and builders so that use cases are tested without network, database or
the real clock (constitution VIII, spec 001 US7).

| Export | What it does |
|---|---|
| `createFakeClock(start = 2026-01-01T00:00:00Z)` | Returns `{ now, advance, set }`; time only moves when the test says so. Satisfies the gateway's `ClockPort` (`{ now(): Date }`) structurally; this package never imports from an app (research R-09). |
| `chatCompletionRequest(overrides?)` | A valid `ChatCompletionRequest` with per-field overrides, parsed with the contract schema so a bad override throws. |
| `chatCompletionResponse(overrides?)` | Same for `ChatCompletionResponse`. |
| `healthResponse(overrides?)` | Same for `HealthResponse` (`uptimeMs` may be given as a plain number; the schema brands it). |

The other fakes (`FakeLlmProvider`, `FakePiiDetector`, `InMemoryAuditLog`,
`InMemoryCircuitState`, `InMemoryPolicyRepository`) arrive with their ports in later
features. If a second port needs sharing between an app and this package, move the port
*types* into a `@tamiz/ports` package instead of importing the app here.

Tests run from the root (`pnpm test`, Vitest `projects`) or per package:
`pnpm --filter @tamiz/test-utils typecheck | test | build`.
