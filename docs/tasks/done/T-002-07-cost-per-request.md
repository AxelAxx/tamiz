# T-002-07 — Cost per request

| Field | Value |
|---|---|
| Task | `T-002-07` (see `docs/tasks/BACKLOG.md`) |
| Feature | `002-provider-routing` |
| Spec | `specs/002-provider-routing/spec.md` (US7-1 … US7-5, FR-033 … FR-035, SC-008); `tasks.md` Phase 6 (T064–T070); `data-model.md` §3.6 |
| Branch / PR | `T-002-07-cost-per-request` / PR opened after this commit |
| Date | 2026-10-30 |
| Session | Claude Code (Claude Opus 5.5), side session (Alex away; merge authority delegated for the session) |
| Status | done |

## What was done

Every successful response now carries `usage.cost_usd` and `usage.estimated` (FR-035).
`domain/model/cost.ts` computes `prompt × input / 1e6 + completion × output / 1e6` as
`Usd`, without rounding (FR-033). `routeInference` resolves usage: the provider's counts
when it reports them, otherwise the classifier's `estimateTokens` over the request
messages and over the generated text, flagged `estimated: true` (FR-034, US7-4). It then
prices that usage with the target's pricing. `RoutedCompletion.usage` is now required and
`cost` was added. The contract's `ChatCompletionUsageSchema` gains the two optional
fields, and unknown `usage` keys are still rejected.

## Files touched

- `apps/gateway/src/domain/model/cost.ts`: `Usage`, `computeCost` (T067).
- `packages/contracts/src/chat-completion.ts`: `cost_usd: UsdSchema.optional()`, `estimated: z.boolean().optional()` (T068).
- `apps/gateway/src/application/use-cases/route-inference.ts`: `resolveUsage`, `usage` and `cost` on `RoutedCompletion` (T069).
- `apps/gateway/src/presentation/mappers/chat-completion-response.ts`: `usage.cost_usd`, `usage.estimated`; the T-002-06 zero fallback is gone (T069).
- Tests:
  - `apps/gateway/test/domain/cost.test.ts`: US7-1 … US7-3, plus a 10-row hand-computed corpus (T064).
  - `packages/contracts/test/chat-completion-response.test.ts`: T065.
  - `apps/gateway/test/application/route-inference.test.ts` (T066) and `test/chat-completions.test.ts`: a priced target, a zero-priced target via `tamiz-local`, and an estimated usage (T069).
- `apps/gateway/src/domain/README.md`, `packages/contracts/README.md`: module lists.
- `docs/tasks/BACKLOG.md`: `T-002-07` row set to `done` (that row only).

## Decisions

- **The prompt estimate is `estimateTokens` over all message contents joined.** That
  equals the classifier's size estimate (`ceil(total characters / 4)`), as FR-034 asks
  ("the same estimator the classifier uses"). A per-message sum would round each
  message up separately.
- **Partial usage does not occur.** The adapters (T-002-04) report usage only when both
  counts are present, so `estimated` applies to both counts or to neither.
- **`computeCost` brands its result without re-validating.** The token counts are
  non-negative integers and the prices are validated `Usd`, so the sum is a finite
  value ≥ 0. A comment in the code states this.
- **I kept `cost_usd` optional in the contract**, as FR-035 says, so 001-shaped bodies
  still validate. The gateway always sets it, and the mapper's output is validated
  against the schema before it is sent.
- I wrote the tests first: they failed on the missing module and on the absent fields,
  and the corpus caught a wrong hand-computed value (0.0266666 → 0.0266672), which was
  then fixed in the test.

## How it was verified

```bash
pnpm --filter @tamiz/gateway exec vitest run test/domain/cost.test.ts test/application test/chat-completions.test.ts
#  Test Files 5 passed   Tests 54 passed
pnpm --filter @tamiz/contracts exec vitest run test/chat-completion-response.test.ts   # Tests 15 passed
pnpm lint          # Checked 143 files. No fixes applied.
pnpm typecheck     # Tasks: 5 successful, 5 total
pnpm arch          # ✔ no dependency violations found (61 modules, 158 dependencies cruised)
pnpm test --coverage   # Test Files 44 passed (44)   Tests 489 passed (489)   Type Errors no errors
pnpm build         # Tasks: 3 successful, 3 total
```

## Pending / follow-ups

- `T-002-08`: routing dataset v1 and the ≥ 95 % gate test.
- Feature 006 audits `cost` from `RoutedCompletion`.
- No new backlog rows.

## Pitfalls for the next session

- `RoutedCompletion.usage` is **required** now (`Usage` with `estimated`). Code that
  built one by hand must add `usage` and `cost`.
- Assert costs with `toBeCloseTo(x, 9)` or tighter, never `toBe`: they are IEEE doubles
  (for example, 12 × 0.1 / 1e6 + 3 × 0.3 / 1e6 = 2.1000000000000002e-6).

## Links

- Spec / plan / tasks: `specs/002-provider-routing/{spec,tasks}.md` (Phase 6), `data-model.md` §3.6
- ADRs: none added
- Related task records: `docs/tasks/done/T-002-06-chat-completions-endpoint.md`, `docs/tasks/done/T-002-04-llm-adapters.md`
