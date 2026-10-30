# T-005-05 — Streaming de-anonymization with placeholder-safe buffering

| Field | Value |
|---|---|
| Task | `T-005-05` (see `docs/tasks/BACKLOG.md`) |
| Feature | `005-privacy-aware-routing` |
| Spec | `specs/005-privacy-aware-routing/spec.md` (FR-016, FR-017; US4-1 … US4-5; SC-003); `tasks.md` Phase 4 (T038–T043); `research.md` R-07 |
| Branch / PR | `T-005-05-streaming-restoration` / PR opened after this commit |
| Date | 2026-10-30 |
| Session | Claude Code (Claude Opus 5.5), side session (merge authority delegated by Alex) |
| Status | done |

## What was done

Anonymized streams are now restored correctly when the provider splits a placeholder
across chunks.

**The restorer.** `domain/model/restore-stream.ts` exports `createStreamRestorer(mapping)`.
`push(text)`:
- restores every complete placeholder;
- holds back only the trailing text that could still become one, which is the text from
  the last `<` when it is a prefix of `<KIND_n>`, at most `MAX_HELD` = 22 characters;
- releases everything else at once (US4-2, US4-3).

`flush()` releases the rest.

**In `StreamInference`.** Each stream gets its own restorer (`protectMessages().streamRestorer()`;
pass-through when not anonymized). The first token and every delta go through `push`.
Held text is flushed as a delta before the finish (usage chunk) and before an error event
(US4-4). Empty deltas produced while holding are not sent.

## Files touched

- `apps/gateway/src/domain/model/restore-stream.ts` (new): `createStreamRestorer`, `isPlaceholderPrefix`, `MAX_HELD` (T041).
- `apps/gateway/src/application/use-cases/protect-messages.ts`: `streamRestorer()`.
- `apps/gateway/src/application/use-cases/stream-inference.ts`: the restorer for `first` and the deltas; flush before finish and error (T042).
- Tests:
  - `test/domain/restore-stream.test.ts` (T038): examples, a property with 5 000 runs and up to 3 cuts, and every pair of split points of a fixed answer;
  - `test/chat-completions-stream-privacy.test.ts` (T039, T040): a split placeholder over HTTP SSE, the flush before the usage chunk, and the flush before the error event.
- `specs/005-privacy-aware-routing/tasks.md` (T038–T043 ticked), `docs/tasks/BACKLOG.md`.

## Decisions

- **`MAX_HELD` = `"<CREDIT_CARD_".length + 9`.** This covers the longest kind with up to
  nine digits. A longer "prefix" is released as it is; it cannot be a placeholder the
  gateway produced, because numbers never reach that size.
- **Only the text from the last `<` can be held.** Placeholders contain no `<`, so an
  incomplete one always starts at the last `<`. This keeps `push` O(chunk) and makes the
  equivalence property hold.
- **Empty deltas are dropped.** While a prefix is held, `push` can return `""`, and an
  empty SSE content chunk would be noise. The provider's own empty deltas are dropped
  too, which no client relies on.
- **The application tests are the HTTP SSE scenarios** (as in `T-005-04`). They cover the
  use case and the chunk mapping together.

## How it was verified

```bash
pnpm lint        # clean
pnpm typecheck   # 0 errors
pnpm arch        # ✔ no dependency violations found
pnpm test        # Test Files 77 passed (77); Tests 831 passed | 12 skipped (843)
pnpm build       # pass
```

SC-003 is checked two ways:
- **Property** (5 000 runs): random answers built from mapped and unmapped
  placeholders, partial prefixes, `<`, `>`, plain text and emoji, split by up to 3 random
  cuts.
- **Exhaustive:** every `(i, j)` split of a fixed answer.

In both, the streamed output equals the non-streaming `restore`.

## Pending / follow-ups

- `T-005-06`: `POST /v1/simulate` and the feature polish (T051–T054), which closes feature
  005.
- No new backlog rows.

## Pitfalls for the next session

- **A placeholder is only restored once it is complete.** A stream that ends mid-
  placeholder shows the raw prefix (`<PERSON_`), by design.
- **The first token can come back empty from `push`** when it ends with a held prefix.
  The first SSE chunk then carries `role` with empty content, which is valid in
  OpenAI's format.

## Links

- Spec / plan / tasks: `specs/005-privacy-aware-routing/`
- ADRs: none added
- Related task records: `docs/tasks/done/T-005-04-privacy-in-route-inference.md`, `docs/tasks/done/T-003-05-streaming.md`
