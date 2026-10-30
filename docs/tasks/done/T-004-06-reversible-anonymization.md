# T-004-06 — Reversible anonymization: `POST /anonymize` with placeholder map

| Field | Value |
|---|---|
| Task | `T-004-06` (see `docs/tasks/BACKLOG.md`) |
| Feature | `004-privacy-service` |
| Spec | `specs/004-privacy-service/spec.md` (FR-014 … FR-016; US3-1 … US3-7, US5-2); `tasks.md` Phase 5 (T054–T063); `research.md` R-07 |
| Branch / PR | `T-004-06-reversible-anonymization` / PR opened after this commit |
| Date | 2026-10-30 |
| Session | Claude Code (Claude Opus 5.5), side session (merge authority delegated by Alex) |
| Status | done |

## What was done

`POST /anonymize` returns three things:
- the request text with every reported finding replaced by `<KIND_n>`;
- the mapping from placeholder to kind and original value;
- the analysis of the original text (US3-7).

How placeholders are assigned:
- numbered per kind, from 1, in order of first appearance;
- one placeholder per distinct `(kind, value)` (US3-1, US3-2);
- numbering starts after the highest `n` already present in the text for that kind, so
  restoring is exact even when the input contains placeholder-shaped strings (US3-6,
  FR-015).

The logic is a pure domain function, `domain/placeholders.py::anonymize`, as R-07
decided. `presidio-anonymizer` is not used.

Two guarantees are tested:
- **Round trip.** `tests/support/restore.py` is the reference restore for the gateway
  (`T-005-04`): one regex pass, replacing only the placeholders that are in the mapping.
  A hypothesis property checks the round trip for arbitrary texts and findings,
  including placeholder-like noise (US3-3).
- **Nothing stored.** A Python audit hook records file writes, `sqlite3.connect` and
  `socket.connect` while `/analyze` and `/anonymize` serve requests, and asserts none
  happen (US3-5, US5-2, FR-016). Log capture asserts that no value and no placeholder
  reach the logs.

## Files touched

- `services/privacy/src/privacy/domain/placeholders.py`: `PLACEHOLDER_PATTERN`, `PlaceholderEntry`, `Anonymized`, `anonymize` (T059).
- `src/privacy/application/anonymize_text.py` (T060).
- `src/privacy/api/{schemas,mappers,app}.py`: `AnonymizeRequest`, `PlaceholderOut`, `AnonymizeResponse`, the route (T062).
- `services/privacy/openapi.json`: re-exported (T062).
- Tests:
  - `tests/support/restore.py` (T061);
  - `tests/unit/test_placeholders.py` (T054);
  - `tests/unit/test_anonymize_text.py` (T055);
  - `tests/api/test_anonymize.py`, against `contracts/anonymize.example.json` (T056);
  - `tests/api/test_no_writes.py` (T057);
  - `tests/nlp/test_anonymize_nlp.py` (T058);
  - `tests/api/test_openapi.py`: `/anonymize` documented.
- `services/privacy/README.md`, `specs/004-privacy-service/tasks.md` (T054–T063 ticked), `docs/tasks/BACKLOG.md`.

## Decisions

- **The same value of two kinds gets two placeholders.** The key is `(kind, value)`, so
  a surname "Valencia" and the city "Valencia" stay distinguishable to the model.
- **The mapping is an ordered list, not an object** (`{placeholder, kind, value}` in
  order of first appearance). This matches `contracts/http.md` and mirrors cleanly in
  Zod.
- **`AnonymizeRequest` is a subclass of `AnalyzeRequest`.** It has the same fields but
  its own OpenAPI component, so the two can evolve apart without breaking the gateway's
  mirror.
- **The no-writes test uses `sys.addaudithook`.** Hooks cannot be removed, so one hook is
  installed per process with a recording flag. It runs inside `with TestClient(...)`:
  without one event loop for the whole test, the client builds a loop per request, and
  on Windows that loop's self-pipe shows up as a `socket.connect`. A companion test
  proves that the hook does record a real write.
- **The service still has no restore endpoint** (spec assumption). The reference restore
  lives in the tests and documents what the gateway must do.

## How it was verified

```bash
cd services/privacy
uv run ruff check . && uv run ruff format --check .   # clean
uv run mypy                                           # Success: no issues found in 61 source files
uv run lint-imports                                   # Contracts: 2 kept, 0 broken.
uv run pytest                                         # 237 passed
uv run python scripts/export_openapi.py --check       # up to date
```

The `nlp` test anonymizes the contract example with the real engine. The result is
exactly `contracts/anonymize.example.json`'s text, and restore gives back the original.

## Pending / follow-ups

- `T-004-07`: corpus and metrics, including the corpus-wide round trip of SC-003. It
  closes feature 004, together with the polish tasks T073–T076.
- `T-005-03` / `T-005-04` consume `openapi.json` and reimplement `restore` in the gateway
  (in TypeScript, the offsets of `analysis` are code points; see `contracts/http.md`).

## Pitfalls for the next session

- **Restoring with chained `str.replace` calls is wrong.** A value may itself look like a
  placeholder. Use one regex pass restricted to the mapping, as in `restore.py`.
- **On Windows, `TestClient` without `with` creates an event loop per request.** That
  shows up in audit hooks as socket connects.

## Links

- Spec / plan / tasks: `specs/004-privacy-service/`
- ADRs: none added
- Related task records: `docs/tasks/done/T-004-05-banking-phone-nss-recognizers.md`
