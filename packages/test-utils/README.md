# packages/test-utils

In-memory fakes and builders so that use cases are tested without network, database or
the real clock (constitution VIII, spec 001 US7).

| Export | What it does |
|---|---|
| `createFakeClock(start = 2026-01-01T00:00:00Z)` | Returns `{ now, advance, set }`; time only moves when the test says so. Satisfies the gateway's `ClockPort` (`{ now(): Date }`) structurally; this package never imports from an app (research R-09). |
| `createScriptedPort(script)` | Generic port double: `script(input, callIndex)` returns the output or a promise of it; `{ fn, calls }` records every input in order. The gateway types the script (e.g. as `LlmProviderPort["complete"]`), so this package holds no gateway types (spec 002 R-14). |
| `createInMemoryPolicyRepository(initial)` | `{ getActive, set }` over a policy of any type; satisfies the gateway's `PolicyRepositoryPort` structurally. |
| `chatCompletionRequest(overrides?)` | A valid `ChatCompletionRequest` with per-field overrides, parsed with the contract schema so a bad override throws. |
| `chatCompletionResponse(overrides?)` | Same for `ChatCompletionResponse`. |
| `healthResponse(overrides?)` | Same for `HealthResponse` (`uptimeMs` may be given as a plain number; the schema brands it). |

The other fakes (`FakePiiDetector`, `InMemoryAuditLog`, `InMemoryCircuitState`) arrive
with their ports in later features; a fake LLM provider is `createScriptedPort` with a
handler typed in the gateway test. Fakes here stay generic over the port's types. Only if
a fake ever needs a gateway type to work, move the port *types* into a `@tamiz/ports`
package instead of importing the app here.

Tests run from the root (`pnpm test`, Vitest `projects`) or per package:
`pnpm --filter @tamiz/test-utils typecheck | test | build`.
