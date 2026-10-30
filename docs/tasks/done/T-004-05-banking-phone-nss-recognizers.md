# T-004-05 — Spanish recognizers: IBAN, phone numbers, social security number (NSS)

| Field | Value |
|---|---|
| Task | `T-004-05` (see `docs/tasks/BACKLOG.md`) |
| Feature | `004-privacy-service` |
| Spec | `specs/004-privacy-service/spec.md` (FR-010 … FR-013; US2-6 … US2-8; US1-1 phone part; overlap edge cases); `tasks.md` Phase 4 (T044–T053); `research.md` R-08, R-12, R-13 |
| Branch / PR | `T-004-05-banking-phone-nss` / PR opened after this commit |
| Date | 2026-10-30 |
| Session | Claude Code (Claude Opus 5.5), side session (merge authority delegated by Alex) |
| Status | done |

## What was done

Three more recognizers are registered:

| Recognizer | Accepted when |
|---|---|
| `IBAN` | the length matches a SEPA country, mod-97 = 1, and for `ES` the two old CCC account control digits are right (FR-010) |
| `NSS` | province 01–53 or 66, and the TGSS control `base mod 97` matches (FR-011) |
| `PHONE` | nine digits starting 6, 71–74, 8 or 9, with optional `+34`/`0034`, grouped 3-3-3 or 3-2-2-2 (FR-012) |

The phone has no checksum, so it keeps a base score of 0.6. Presidio's context enhancer
raises it when a phone word is nearby. `ValidatedPatternRecognizer` gained
`confirms=False` for that case: a passing candidate keeps its pattern score instead of
jumping to 1.0.

With these, US1-1 is complete end to end: name, email and phone → `high`. Overlaps
resolve to one finding per span.

## Files touched

- `services/privacy/src/privacy/domain/checksums.py`: `IBAN_LENGTHS`, `is_valid_iban`, `is_valid_nss`, `is_spanish_phone` (T050).
- `src/privacy/infrastructure/recognizers/{banking,social_security,phone}.py` (T051).
- `src/privacy/infrastructure/recognizers/validated.py`: `confirms` keyword.
- `src/privacy/infrastructure/presidio_analyzer.py`: registers the three (T052).
- Tests:
  - `tests/unit/test_checksums_banking.py` (T044);
  - `tests/recognizers/test_banking_recognizers.py` (T045–T047: IBAN, NSS, phone);
  - `tests/nlp/test_analyze_nlp.py`: US1-1 with the phone, the context score, IBAN and
    NSS → `critical` (T048);
  - `tests/nlp/test_overlaps_nlp.py` (T049).
- `services/privacy/README.md` (recognizers table), `specs/004-privacy-service/tasks.md` (T044–T053 ticked), `docs/tasks/BACKLOG.md`.

## Decisions

- **IBAN countries are limited to SEPA.** A candidate from an unlisted country is
  rejected even if mod-97 passes, which keeps precision high. Non-SEPA IBANs are out of
  scope for a Spanish-market service.
- **After the first BBAN group, the IBAN pattern accepts digit groups only.** Otherwise
  a trailing four-letter word ("para") is swallowed into the candidate, which then fails
  validation and loses the whole IBAN; Presidio does not retry shorter matches. The cost
  is that IBANs with letters later in the BBAN (some FR and IT accounts) are missed. That
  miss is documented in the module and the corpus will measure it.
- **Phones preceded by another country code are excluded.** A variable-length negative
  lookbehind (supported by the `regex` module Presidio uses) rejects `+33 612 345 678`.
  Amounts such as `612.345.678,50` are rejected by the trailing look-ahead.
- **A bare phone scores 0.6.** That is above the default minimum (0.5), so short prompts
  with only a number are still caught. Callers that want fewer false positives can raise
  `min_score` to 0.7 (R-12).
- **NSS is not compared against `python-stdnum`,** which has no Spanish NSS module. It is
  tested with computed examples and the control-mutation property.

## How it was verified

```bash
cd services/privacy
uv run ruff check . && uv run ruff format --check .   # clean
uv run mypy                                           # Success: no issues found in 53 source files
uv run lint-imports                                   # Contracts: 2 kept, 0 broken.
uv run pytest                                         # 216 passed (17 nlp)
uv run python scripts/export_openapi.py --check       # up to date
```

The hypothesis properties check that:
- generated Spanish IBANs are valid and agree with `stdnum.iban`;
- any account control agrees with stdnum;
- changing one digit invalidates the IBAN;
- changing the NSS control invalidates it.

## Pending / follow-ups

- `T-004-06` (`/anonymize`) and `T-004-07` (corpus and metrics) are both unblocked.
- No new backlog rows.

## Pitfalls for the next session

- **spaCy can tag a capitalised verb at the start of a sentence as `LOCATION`.** For
  example, "Domicilien el recibo…". It is model noise, not a recognizer bug. Keep `nlp`
  test sentences natural and avoid such openings. The corpus (T-004-07) measures
  `LOCATION` precision honestly; do not tune tests around it.
- **Presidio pattern matches are greedy and never retried shorter after a failed
  validation.** Design patterns so that a valid identifier is the whole match.
- **Use `confirms=False`** for any future unvalidated structure check (no checksum).
  Otherwise validation forces the score to 1.0 and context words stop mattering.

## Links

- Spec / plan / tasks: `specs/004-privacy-service/`
- ADRs: none added
- Related task records: `docs/tasks/done/T-004-04-identity-recognizers.md`
