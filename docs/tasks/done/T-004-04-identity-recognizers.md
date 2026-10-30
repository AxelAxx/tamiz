# T-004-04 — Spanish recognizers: DNI, NIE, CIF with check characters

| Field | Value |
|---|---|
| Task | `T-004-04` (see `docs/tasks/BACKLOG.md`) |
| Feature | `004-privacy-service` |
| Spec | `specs/004-privacy-service/spec.md` (FR-009, FR-013; US2-1 … US2-5; US1-2, US1-4 end to end); `tasks.md` Phase 3 (T036–T043); `research.md` R-12, R-13 |
| Branch / PR | `T-004-04-identity-recognizers` / PR opened after this commit |
| Date | 2026-10-30 |
| Session | Claude Code (Claude Opus 5.5), side session (merge authority delegated by Alex) |
| Status | done |

## What was done

`/analyze` now reports DNI, NIE and CIF only when their check character is valid
(FR-009).

- **Rules:** the check-character rules are pure domain functions in
  `domain/checksums.py`:
  - DNI: mod 23;
  - NIE: X/Y/Z → 0/1/2, then the DNI rule;
  - CIF: control digit or letter by organisation type.
- **Candidates:** case-insensitive patterns tolerant to the usual separators find
  candidates.
- **Scoring:** a `ValidatedPatternRecognizer` passes each candidate to the domain
  validator. A valid one scores 1.0; an invalid one is dropped.
- **Look-arounds** keep a candidate from starting or ending inside a longer token. Plain
  eight-digit numbers, dates, postcodes, phones and longer references are never reported
  (FR-013, US2-3).

## Files touched

- `services/privacy/src/privacy/domain/checksums.py`: `compact`, `is_valid_dni`, `is_valid_nie`, `is_valid_cif` (T039).
- `src/privacy/infrastructure/recognizers/{__init__,validated,identity}.py`: `ValidatedPatternRecognizer` and the three recognizers (T040, T041).
- `src/privacy/infrastructure/presidio_analyzer.py`: registers them (T042).
- Tests:
  - `tests/unit/test_checksums_identity.py` (T036);
  - `tests/recognizers/test_identity_recognizers.py` (T037);
  - `tests/support/recognizers.py` (shared `found()` helper);
  - `tests/nlp/test_analyze_nlp.py`: DNI → `critical`, CIF alone → `low`, NIE next to a
    wrong DNI (T038).
- `services/privacy/README.md` (recognizers table), `specs/004-privacy-service/tasks.md` (T036–T043 ticked), `docs/tasks/BACKLOG.md`.

## Decisions

- **The CIF rule is stricter than `python-stdnum`.** stdnum accepts the digit or the
  letter for every organisation type. We follow R-13:
  - A, B, E and H need the digit;
  - P, Q, R, S, N and W need the letter;
  - the others accept either.

  The oracle test therefore asserts `ours == stdnum.is_valid(x) and form allowed for the
  type`. K, L and M are not company prefixes (they are personal NIFs) and are rejected.
- **`compact` removes spaces, dots, dashes and slashes, and upper-cases.** The patterns
  allow at most one separator between groups, plus the dotted DNI form
  `12.345.678-Z`.
- **Context words** (`dni`, `nie`, `cif`, …) are registered but cannot raise a validated
  score above 1.0. They are kept for Presidio's explanations and for future unvalidated
  patterns.
- **The base pattern score (0.5) is irrelevant** for validated recognizers, because
  validation sets 1.0 or drops the candidate.

## How it was verified

```bash
cd services/privacy
uv run ruff check . && uv run ruff format --check .   # clean
uv run mypy                                           # Success: no issues found in 47 source files
uv run lint-imports                                   # Contracts: 2 kept, 0 broken.
uv run pytest                                         # 141 passed (hypothesis oracles vs stdnum included)
uv run python scripts/export_openapi.py --check       # up to date (no contract change)
```

CI on the PR runs the same suite on Linux, plus the Docker build.

## Pending / follow-ups

- `T-004-05`: IBAN (mod-97 plus Spanish account control digits), phone and NSS. Reuse
  `ValidatedPatternRecognizer` and `tests/support/recognizers.py`.
- No new backlog rows.

## Pitfalls for the next session

- **Pattern recognizers can be unit-tested without the model.** Pass
  `cast("NlpArtifacts", None)` (see `tests/support/recognizers.py`); mypy rejects a bare
  `None`.
- **Presidio compiles patterns with `regex` and flags `I | M | S`.** Patterns are already
  case-insensitive; write them in upper case for readability.
- **`stdnum.es.cif.calc_check_digits` returns two characters** (digit and letter); index
  `[0]` for the digit.

## Links

- Spec / plan / tasks: `specs/004-privacy-service/`
- ADRs: none added
- Related task records: `docs/tasks/done/T-004-03-analyzer-analyze-endpoint.md`
