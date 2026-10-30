# T-002-04 — AI SDK adapters and provider registry

| Field | Value |
|---|---|
| Task | `T-002-04` (see `docs/tasks/BACKLOG.md`) |
| Feature | `002-provider-routing` |
| Spec | `specs/002-provider-routing/spec.md` (US6-1 … US6-5, US6-7, edge cases "finish reason outside the list" and "two choices"; FR-014 … FR-018); `tasks.md` Phase 3 (T025–T035); `research.md` R-04, R-05, R-06, R-14 |
| Branch / PR | `T-002-04-llm-adapters` / PR opened after this commit |
| Date | 2026-10-30 |
| Session | Claude Code (Claude Opus 5.5), side session |
| Status | done |

## What was done

`infrastructure/llm/` implements `LlmProviderPort` once, in `ai-sdk-provider.ts`, over
Vercel AI SDK 6 `generateText` with `maxRetries: 0` and an `AbortSignal.timeout` built
from the input's `timeoutMs` (FR-015, US6-4). It maps the finish reason and usage (R-06)
and every failure to a typed `ProviderError` with a fixed message (R-05, FR-017). The four
adapters (`ollama.ts` through `@ai-sdk/openai-compatible`, `mistral.ts`, `anthropic.ts`,
`openai.ts` on the Chat Completions API) only supply the model factory from explicit
settings (FR-014). `createProviderRegistry(settings)` builds them once; an unconfigured
provider resolves to an adapter that returns `authentication` / not retryable /
`provider not configured` without a request (FR-018). The tests were written first, ran
against MSW and failed on the missing modules.

## Files touched

- `apps/gateway/package.json`, `pnpm-lock.yaml` — `ai` 6, `@ai-sdk/{openai-compatible,mistral,anthropic,openai}` on their `ai-v6` lines, devDependency `msw` 2 (T025).
- `apps/gateway/src/infrastructure/llm/ai-sdk-provider.ts` — `createAiSdkProvider`, the error, finish reason and usage mapping (T032).
- `apps/gateway/src/infrastructure/llm/{ollama,mistral,anthropic,openai}.ts` — `createXAdapter(settings)` (T033).
- `apps/gateway/src/infrastructure/llm/settings.ts` — `ProviderSettings`, `KeyedProviderSettings`, `OllamaSettings`, `sdkOptions`.
- `apps/gateway/src/infrastructure/llm/provider-registry.ts` — `createProviderRegistry` and the "not configured" adapter (T034).
- `apps/gateway/test/llm/msw.ts` — `useMswServer()`: `onUnhandledRequest: "error"` plus an `afterEach` assertion that no request went unhandled (T026).
- `apps/gateway/test/llm/fixtures/*-success.json` — one real-shaped success body per provider (T026).
- `apps/gateway/test/llm/adapter-scenarios.ts` — the shared US6 scenario list, `describeAdapterScenarios(config)`.
- `apps/gateway/test/llm/{openai,mistral,anthropic,ollama}.adapter.test.ts` — per-provider configuration of that list (T027–T030).
- `apps/gateway/test/llm/provider-registry.test.ts` — T031, plus base URL overrides for all four.
- `apps/gateway/test/llm/ai-sdk-provider.test.ts` — R-05/R-06 branches no real body reaches, through `MockLanguageModelV3`.
- `apps/gateway/src/infrastructure/README.md` — module list.
- `docs/tasks/BACKLOG.md` — `T-002-04` row set to `done` (that row only).

## AI SDK error classes observed per provider

Probed with MSW, `generateText({ maxRetries: 0, abortSignal: AbortSignal.timeout(200) })`,
`ai` 6.0.319, `@ai-sdk/provider` 3.0.19. **All four providers behave identically:**

| Upstream | Thrown | `statusCode` | `isRetryable` | `cause` | Mapped to |
|---|---|---|---|---|---|
| 429 | `AI_APICallError` | 429 | true | — | `rate_limited`, retryable, 429 |
| 500 | `AI_APICallError` | 500 | true | — | `http_error`, retryable, 500 |
| 401 | `AI_APICallError` | 401 | false | — | `authentication`, not retryable, 401 |
| 400 / 404 | `AI_APICallError` | n | false | — | `http_error`, not retryable, n |
| 200, wrong shape | `AI_APICallError` | **200** | false | `AI_TypeValidationError` | `malformed_response`, not retryable |
| 200, not JSON | `AI_APICallError` | **200** | false | `AI_JSONParseError` | `malformed_response`, not retryable |
| `HttpResponse.error()` | `AI_APICallError` | undefined | true | fetch `TypeError` | `network`, retryable |
| stalled past the deadline | `TimeoutError` (`DOMException`) | — | — | — | `timeout`, retryable |

With `maxRetries: 0` the original error is thrown, never wrapped in `RetryError`.

## Decisions

- **A 2xx `APICallError` is `malformed_response`.** R-05 expected `JSONParseError` /
  `TypeValidationError` to surface bare, but the provider response handlers wrap them in
  an `APICallError` that keeps the 2xx status (table above). R-05's "other status < 500 →
  `http_error`" would have misfiled them, so 200–299 is checked first. The bare classes
  are still handled for SDK paths that throw them directly. The `status` is left off,
  as in R-05.
- **A timeout is decided by our own signal (`signal.aborted`), not the error name.** Any
  wrapping of the abort by the SDK or fetch then still maps to `timeout`. The tests also
  check that the MSW request's signal aborted, so the connection is closed (US6-4).
- **Usage is copied only when both counts are present**, otherwise `usage` is absent, as
  `ProviderCompletion` says. R-06's estimation (`estimated: true`) is `T-002-07`'s, as
  the T-002-03 record already planned.
- **`modelName` is `response.modelId`**, which the SDK fills from the body's `model` and
  falls back to the requested model id.
- **Mistral has no "usage absent" or content-filter case.** Its non-streaming response
  schema requires `usage` (a body without it is malformed), and its finish reasons have
  no content filter. `model_length` maps to `length`.
- **OpenAI uses `.chat(model)`.** The SDK's default OpenAI model calls the Responses API;
  spec and tests use `/v1/chat/completions`.
- **Provider packages pinned to the `ai-v6` dist-tag lines**: `@ai-sdk/anthropic` 3.x,
  `mistral` 3.x, `openai` 3.x, `openai-compatible` 2.x. Their `latest` tags (4.x / 3.x)
  depend on `@ai-sdk/provider` 4 and belong to AI SDK 7, which the project does not use.
- **One shared scenario list, four thin test files.** The tasks ask for the same list per
  provider; `describeAdapterScenarios` keeps the list in one place and each file
  supplies only URL, fixture, body shape and the finish reasons it supports. Beyond the
  backlog's minimum it also covers 401/404, 400, network failure, non-JSON body, absent
  temperature, two choices and absent usage.
- **`ProviderSettings` lives in `infrastructure/llm/settings.ts`**, shaped as data-model
  §5's `providers.*`. `T-002-05` parses the env into it; nothing here reads
  `process.env`, and `main.ts` is untouched (wiring is `T-002-06`).

## How it was verified

```bash
pnpm --filter @tamiz/gateway exec vitest run test/llm     # before src existed
#  Test Files  6 failed (6)   (modules not found)
pnpm --filter @tamiz/gateway exec vitest run test/llm
#  Test Files  6 passed (6)   Tests  79 passed (79)

pnpm lint                 # Checked 119 files. No fixes applied.
pnpm typecheck            # Tasks: 5 successful, 5 total
pnpm arch                 # ✔ no dependency violations found (45 modules, 99 dependencies cruised)
pnpm test --coverage      # Test Files 34 passed (34)   Tests 381 passed (381)   Type Errors no errors
pnpm build                # Tasks: 3 successful, 3 total
```

The timeout tests use a real 200 ms wait and assert it ends between 150 ms and 1 s. No
test reaches the real network: unhandled requests fail the test.

## Pending / follow-ups

- `T-002-05`: env schema for `OLLAMA_BASE_URL`, `*_API_KEY`, `*_BASE_URL` producing
  `ProviderSettings`, and `checkProviderSettings`.
- `T-002-06`: `createProviderRegistry` in `main.ts`, the 504 `provider_timeout` mapping.
- `T-002-07`: usage estimation when `usage` is absent.
- No new backlog rows.

## Pitfalls for the next session

- **`pnpm add @ai-sdk/<x>` installs the AI SDK 7 line.** Use the `ai-v6` dist-tag
  versions (`npm view @ai-sdk/<x> dist-tags`). Check that every `@ai-sdk/*` depends on
  `@ai-sdk/provider` 3.x. Renovate may propose the 7 line; that is a migration, not a bump.
- **A fresh worktree needs `pnpm install` at the root and `pnpm build` before `pnpm
  arch`/`typecheck`**: `@tamiz/contracts` resolves through `dist`, and a filtered
  `pnpm --filter … add` does not install the other packages.
- **Vitest swallows `console.log` from a probe test when piped through `grep`**; write
  probe output to a file instead.
- `exactOptionalPropertyTypes`: SDK results type usage as `number | undefined`
  (required key), not `?: number`.

## Links

- Spec / plan / tasks: `specs/002-provider-routing/{spec,plan,tasks}.md` (Phase 3), `research.md` R-04, R-05, R-06, R-14, `data-model.md` §4.1, §5
- ADRs: none added
- Related task records: `docs/tasks/done/T-002-03-ports-and-use-cases.md`, `docs/tasks/done/T-002-02-domain-routing-model.md`, `docs/tasks/done/T-001-05-architecture-and-ci.md`, `docs/tasks/done/T-001-06-test-utils.md`
