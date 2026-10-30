# T-003-05 — Streaming with fallback before the first token

| Field | Value |
|---|---|
| Task | `T-003-05` (see `docs/tasks/BACKLOG.md`) |
| Feature | `003-resilience` |
| Spec | `specs/003-resilience/spec.md` (US6-1 … US6-7, FR-021 … FR-028, SC-007); `tasks.md` Phase 4 (T041–T053); `research.md` R-03, R-08 … R-10 |
| Branch / PR | `T-003-05-streaming` / PR opened after this commit |
| Date | 2026-10-30 |
| Session | Claude Code (Claude Opus 5.5), side session (merge authority delegated by Alex for the session) |
| Status | done |

## What was done

`POST /v1/chat/completions` now accepts `stream: true` and answers with OpenAI-compatible
server-sent events (FR-021):

- the first chunk carries the assistant role;
- then content deltas, a chunk with `finish_reason`, a usage chunk (`choices: []` with
  `cost_usd` and `estimated`), and `[DONE]`.

The response starts only when the answering target's first token is available, so
`x-tamiz-route`, `x-tamiz-rule`, `x-request-id` and `x-tamiz-fallback` are final (FR-022).

- **Before the first token** the T-003-04 executor applies unchanged: residency,
  breaker, retry, fallback, and the JSON error response when the chain is exhausted
  (FR-023, US6-3, US6-7).
- **After the first token** a failure becomes one `data: {"error": …}` event with the
  contract's error envelope, no `[DONE]` and no fallback. It is emitted as
  `stream.failed` and counted by the target's circuit (FR-024, US6-4).
- **Client disconnect** aborts the upstream call (FR-027, US6-6).

The provider port gains `stream()`, which resolves at the first token (R-09).
`ai-sdk-provider.ts` implements it with `streamText` for the four providers (FR-028):

- `timeoutMs` bounds the wait for the first token and every gap between parts (FR-025);
- the request signal ends the call;
- `retry-after` is read into `retryAfterMs`, for `complete` too.

`application/use-cases/stream-inference.ts` runs the stream on the shared executor and
prices the finish, estimating usage from the streamed text when the provider reports
none (FR-026).

## Files touched

- `packages/contracts/src/{chat-completion,index}.ts`: `stream: boolean`, `stream_options`, `ChatCompletionChunkSchema`, `StreamErrorEventSchema` (T046).
- `packages/contracts/test/{chat-completion-request.test,chat-completion-chunk.test}.ts`, `test/fixtures/chat-completion.ts` (T041).
- `apps/gateway/src/application/ports/llm-provider.port.ts`: `stream`, `StartedStream`, `StreamPart` (T047).
- `apps/gateway/src/infrastructure/llm/ai-sdk-provider.ts`: `stream`, a shared call signal (timer + request signal), `retryAfterMs` (T048). `provider-registry.ts`: the "not configured" adapter also streams.
- `apps/gateway/src/application/use-cases/stream-inference.ts` (T049).
- `apps/gateway/src/application/resilience/timeout.ts`: the attempt's signal is aborted only when the timer or the outer signal won (see Decisions).
- `apps/gateway/src/presentation/mappers/chat-completion-chunk.ts` (T050).
- `apps/gateway/src/presentation/routes/chat-completions.ts`, `openapi-schemas.ts`, `app.ts`: the streaming branch, the `ChatCompletionChunk` component and `text/event-stream` in OpenAPI (T051).
- `apps/gateway/src/main.ts` (T052).
- Tests:
  - `apps/gateway/test/llm/stream-scenarios.ts` and the four `*.adapter.test.ts` (T042);
  - `test/application/stream-inference.test.ts` (T043);
  - `test/chat-completions-stream.test.ts` (T044);
  - `test/openapi.test.ts` (T045);
  - `test/resilience/timeout.test.ts`;
  - `test/helpers/app.ts` (`streamScript`, `streamInference` wiring);
  - `test/chat-completions.test.ts` and `test/application/route-inference.test.ts` (fakes with `stream`, the `stream: true` → 400 case now `stream: "yes"`).
- `docs/tasks/BACKLOG.md`: `T-003-05` → `done` (that row only).

## Decisions

- **Chunks carry the target's configured model name.** The SDK only exposes the served
  model id in `finish-step`, after the first token, and every chunk must carry the same
  `model`. Non-streaming responses keep reporting the provider's own model name.
- **A latent bug fixed in `withTimeout` (T-003-02).** Its `finally` aborted the attempt's
  signal even when the attempt won. That is harmless for `complete`, which has already
  finished, but it would cut a stream off right after its first token. It now aborts
  only when the timer or the outer signal won; a test pins it.
- **The adapter never trusts the transport to end a read on abort.** Over MSW (and with a
  real stalled body), aborting `fetch` does not end `fullStream` iteration, so every
  read races the call's own signal (`nextPart`). Without this the timeout scenarios hung
  until the 5 s test timeout.
- **One call signal per call**: our timer, re-armed after every stream part, and the
  request signal (deadline or disconnect), with a record of which fired. A timeout is
  `timeout` (retryable) and the request signal is `aborted`, however the SDK or fetch
  wraps the abort. `complete` uses the same helper, which also settles T-003-04's
  pending item: the adapter now honours `ProviderCompletionInput.signal`.
- **A stream that ends without a raw finish reason is `malformed_response`** (the SDK
  fills in `other`), never a successful completion (spec edge case). An empty answer
  (finish with no text) is a success whose `first` is `""`.
- **A 2xx body cut off mid-stream** (`APICallError` status 200, `TypeError` cause) is
  `network`, not `malformed_response`: it is a transport failure.
- **The client's signal reaches the provider through `AbortSignal.any([attempt,
  client])`**, so a disconnect after the first token still ends the upstream call. A
  consumer that stops reading early also cancels it (adapter `finally`).
- **A mid-stream `aborted` is not a provider failure:** no `stream.failed` event and no
  breaker count.
- **The SSE branch returns `streamSSE(...) as never`** in the `@hono/zod-openapi` handler,
  whose typed responses only know JSON. The OpenAPI document declares
  `text/event-stream` with `ChatCompletionChunk` (named with `.meta({ id })`, per the
  T-002-06 pitfall).
- **The usage chunk is always sent**, whatever `stream_options.include_usage` says
  (research R-10: cost visibility is a product promise).

## How it was verified

```bash
pnpm --filter @tamiz/contracts exec vitest run       # Tests 141 passed (after T041/T046)
pnpm --filter @tamiz/gateway exec vitest run test/llm  # Tests 122 passed | 1 skipped (4 providers × streaming)
pnpm lint          # Checked 174 files. No fixes applied.
pnpm typecheck     # Tasks: 5 successful, 5 total
pnpm arch          # ✔ no dependency violations found (74 modules, 234 dependencies cruised)
pnpm test --coverage   # Test Files 59 passed (59)   Tests 690 passed | 1 skipped (691)   Type Errors no errors
pnpm build         # Tasks: 3 successful, 3 total
```

- The skipped test is the "finish without usage" streaming scenario for Anthropic,
  whose API always reports usage.
- The streaming scenarios use MSW `text/event-stream` bodies in the OpenAI chunk dialect
  (OpenAI, Mistral, Ollama) and the Anthropic event dialect. They cover: success, an
  error before the first token, `retry-after`, a failure after two chunks, first-token
  and idle timeouts (200 ms), a stream without a finish, no usage, an empty answer, a
  consumer stopping early, and an aborted request signal.
- SC-007 (first chunk forwarded under 20 ms p95 over 100 streams) runs in
  `chat-completions-stream.test.ts`.

Manual check against the real process: `local-only.yaml` with Ollama pointed at an
unreachable port, `stream: true`. The result is `HTTP/1.1 502 Bad Gateway`,
`content-type: application/json`, `x-tamiz-route: ollama-llama`, and the
`provider_error` envelope; no event stream is started.

**Not verified:** a real streamed answer from a live model, since no provider is
reachable from this machine. Quickstart §5 needs Ollama with `llama3.1:8b`.

## Pending / follow-ups

- `T-003-06`: Redis/Valkey circuit state.
- Polish T063–T066 (README, gateway README behaviour table, architecture doc, CLAUDE.md
  tips) go with the last PR of the feature (`T-003-06`).
- Feature 005 `T-005-05` builds streaming de-anonymization on `StreamInference`.
- No new backlog rows.

## Pitfalls for the next session

- **`withTimeout` must not abort a winning run.** Anything that keeps using the attempt's
  signal after it resolves (streams) depends on that.
- **Do not rely on `fetch` abort to end a body read.** Race reads against your own signal
  (`nextPart` in the adapter); MSW bodies and stalled servers never end on their own.
- **In MSW `ReadableStream` bodies, `controller.error()` discards queued chunks.** Error
  later (`setTimeout`) when a test needs chunks first and then a failure.
- **Every `LlmProviderPort` fake now needs `stream`.** Use `streamScript` in
  `createTestApp`.

## Links

- Spec / plan / tasks: `specs/003-resilience/{spec,plan,tasks}.md` (Phase 4), `research.md` R-03, R-08 … R-10, `contracts/http.md`
- ADRs: none added
- Related task records: `docs/tasks/done/T-003-04-fallback-chain.md`, `docs/tasks/done/T-003-02-timeout-and-retry.md`, `docs/tasks/done/T-002-04-llm-adapters.md`
