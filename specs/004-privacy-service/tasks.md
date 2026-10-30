---

description: "Task list for feature 004-privacy-service"
---

# Tasks: Privacy Service

**Input**: Design documents from `specs/004-privacy-service/`

**Prerequisites**: `plan.md`, `spec.md`, `research.md` (R-01 … R-15), `data-model.md`,
`contracts/{http.md,*.example.json,corpus.example.jsonl}`, `quickstart.md`; this spec
approved by Alex (`T-004-01`).

**Tests**: Mandatory. Constitution III requires every Given/When/Then of `spec.md` to map
one-to-one to a test; the "Scenario coverage" table below is that mapping. Write each
test before the code it covers and watch it fail first. Test function names start with
the scenario id (`test_us2_2_wrong_dni_letter_is_rejected`).

**Organization**: Phases are the backlog tasks `T-004-02` … `T-004-07` of
`docs/tasks/BACKLOG.md` (one session, one PR each), as in features 001–003. The `[USn]`
label keeps the mapping to the spec's user stories. Within a phase the order is tests →
implementation → verification → task record.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel with its neighbours (different files, no dependency on an
  unfinished task).
- **[Story]**: user story of `spec.md` (`US1` … `US6`).
- Paths are repository-relative. `privacy/` abbreviates `services/privacy/`, and
  `src/` abbreviates `services/privacy/src/privacy/`.

## Scenario coverage

| Spec scenario | Task | Spec scenario | Task |
|---|---|---|---|
| US1-1 name + email + phone → `high` | T022, T048 | US3-1 placeholders per kind, no value left | T054, T056 |
| US1-2 valid DNI → `critical` | T015, T038 | US3-2 same value, one placeholder | T054 |
| US1-3 no personal data → `none` | T015, T018 | US3-3 restore equals original | T054, T056 |
| US1-4 only city or CIF → `low` | T015, T038 | US3-4 nothing found → unchanged, empty map | T054 |
| US1-5 higher `min_score` drops findings | T017 | US3-5 map and values written nowhere | T057 |
| US1-6 response has no input substring | T018 | US3-6 no collision with existing placeholders | T054 |
| US2-1 valid DNI, with/without separator, score ≥ 0.9 | T037 | US3-7 response carries analysis of original | T055, T056 |
| US2-2 wrong DNI letter rejected | T036, T037 | US4-1 report and thresholds pass | T065 |
| US2-3 plain eight-digit numbers ignored | T037 | US4-2 broken recognizer fails naming kind and metric | T066 |
| US2-4 NIE valid / wrong letter | T036, T037 | US4-3 corpus version, synthetic, sizes, generator | T064 |
| US2-5 CIF valid / wrong control | T036, T037 | US4-4 `PERSON` / `LOCATION` reported, `PERSON` recall ≥ 0.80 | T065 |
| US2-6 IBAN mod-97 and account control digits | T044, T045 | US5-1 no input in logs over the suite | T004, T067 |
| US2-7 NSS control digits | T044, T046 | US5-2 no files, database or cache | T057 |
| US2-8 Spanish phone formats; non-phones ignored | T047 | US5-3 body > 1 MiB → 413 | T019 |
| | | US5-4 malformed request → 400 naming the field | T020 |
| | | US5-5 not ready until the model is loaded | T003 |
| | | US6-1 exported contract matches committed | T021 |
| | | US6-2 closed enums, unknown fields rejected | T021 |

Edge cases of the spec: overlaps and tie-breaks (T016, T049), lower-case DNI (T037),
empty text (T017, T018), English text (T022), concurrency (T018, stateless app factory).

---

## Phase 1: `T-004-02` — Python project skeleton (US5)

**Goal**: a uv project with the four layers, strict quality gates in CI, a non-root
image and `GET /health`. **Independent test**: `uv run ruff check . && uv run mypy . &&
uv run lint-imports && uv run pytest` exit 0; `docker build services/privacy` succeeds
in CI.

### Setup

- [x] T001 Create `privacy/pyproject.toml` (uv, `requires-python = ">=3.12,<3.13"`,
  runtime deps FastAPI, Uvicorn, pydantic-settings; dev deps Ruff, mypy, pytest,
  pytest-cov, import-linter, hypothesis, httpx), `privacy/.python-version` (3.12),
  `privacy/uv.lock`; tool sections: Ruff (line length 100, rule sets `E F I B UP SIM
  RUF S PT`), mypy (`strict = true`, `disallow_any_explicit` for `privacy.*`), pytest
  (`testpaths = ["tests"]`, markers `nlp` and `metrics`, `--strict-markers`),
  import-linter contracts of research R-05
- [x] T002 Create the package tree `src/{domain,application,infrastructure,api}/__init__.py`,
  `src/py.typed`, `src/main.py` (empty composition root), `privacy/tests/__init__.py`

### Tests first

- [x] T003 [P] [US5] `privacy/tests/api/test_health.py`: ready → 200
  `{"status": "ok", "ready": true, "version": …}`; readiness returning false → 503
  `not_ready` envelope (US5-5)
- [x] T004 [P] [US5] `privacy/tests/api/test_logging.py`: one JSON line per request with
  only the allow-listed fields of research R-09; an unexpected `extra` field is dropped;
  `x-request-id` is used and echoed, or generated (US5-1, infrastructure part)
- [x] T005 [P] `privacy/tests/unit/test_settings.py`: defaults; invalid
  `PRIVACY_PORT` / `PRIVACY_DEFAULT_MIN_SCORE` → exit with the variable named and the
  value absent from the message

### Implementation

- [x] T006 `src/infrastructure/settings.py`: `Settings` of data-model §3 and
  `load_settings()` that exits 1 on invalid values (variable names only)
- [x] T007 `src/api/logging.py`: JSON formatter with the allow-list, request-id
  middleware, one line per request; Uvicorn access log disabled
- [x] T008 `src/api/errors.py`: `ErrorEnvelope`, handlers for `HTTPException` and
  unexpected exceptions (500 `internal_error`, generic message, type logged, no message
  text)
- [x] T009 `src/api/app.py`: `create_app(readiness, settings) -> FastAPI` with
  `GET /health`; `src/main.py`: settings → app → `uvicorn.run` (`python -m privacy.main`)
- [x] T010 `privacy/tests/conftest.py`: `client` fixture over `create_app`, and the
  `log_capture` fixture that records every log line and exposes
  `assert_absent(*strings)`
- [x] T011 [P] `privacy/Dockerfile` (multi-stage: `uv sync --frozen --no-dev` in the
  builder, `python:3.12-slim` runtime, user `privacy` uid 10001, `EXPOSE 8001`,
  `HEALTHCHECK` with `python -c` and `urllib`) and `privacy/.dockerignore`
- [x] T012 [P] `.github/workflows/ci.yml`: the Python steps of research R-06 (setup-uv
  pinned by SHA with cache on `services/privacy/uv.lock`, sync, ruff check, ruff format
  check, mypy, lint-imports, pytest with coverage, docker build), `timeout-minutes: 25`;
  `biome.json` ignores `services/privacy/**`; `.gitignore` adds
  `services/privacy/reports/`
- [x] T013 [P] `privacy/README.md`: purpose, layers, commands (`uv sync`, gates, run),
  link to the spec

### Verification

- [x] T014 Run the gates of `quickstart.md` §1–§2 locally and the full `pnpm` gates;
  push, confirm the CI log shows every Python step and the Docker build; write
  `docs/tasks/done/T-004-02-privacy-skeleton.md`, flip the backlog row

---

## Phase 2: `T-004-03` — Analyzer and `POST /analyze` (US1, US5, US6)

**Goal**: Presidio with the Spanish model behind a port, the domain pipeline (kinds,
score, overlaps, level), `/analyze`, limits and validation errors, and the exported
OpenAPI document. **Independent test**: `uv run pytest` (fake analyzer) and
`uv run pytest -m nlp` (person, location and email in Spanish text) pass;
`scripts/export_openapi.py --check` exits 0.

### Tests first

- [x] T015 [P] [US1] `privacy/tests/unit/test_sensitivity.py`: `LEVEL_BY_KIND` is total
  over `EntityKind`; `level_of` gives `none` for no findings (US1-3), `critical` with a
  `DNI` finding (US1-2), `low` with only `LOCATION` or `CIF` (US1-4), `high` with
  person + email + phone (US1-1, domain part); `counts_of`
- [x] T016 [P] [US1] `privacy/tests/unit/test_overlap.py`: higher score wins; tie →
  `SPECIFICITY` order; tie → longer span; hypothesis: output sorted, non-overlapping,
  subset of input, idempotent (spec edge cases)
- [x] T017 [P] [US1] `privacy/tests/unit/test_analyze_text.py` with a fake
  `PiiAnalyzerPort`: `min_score` filter before the level (US1-5); `kinds` filter;
  empty text → no findings, `none`
- [x] T018 [P] [US1] `privacy/tests/api/test_analyze.py` with the fake analyzer:
  response shape of `contracts/http.md`; `counts` only for present kinds; no substring
  of the request text of length ≥ 3 appears anywhere in the response body (US1-6);
  `none` for a text without data (US1-3); 20 concurrent requests with different texts
  get their own results
- [x] T019 [P] [US5] `privacy/tests/api/test_limits.py`: body of 1 MiB + 1 byte → 413
  `payload_too_large`, with `content-length` and with a chunked body, analyzer never
  called; exactly 1 MiB accepted (US5-3)
- [x] T020 [P] [US5] `privacy/tests/api/test_errors.py`: non-JSON, missing `text`,
  `text` not a string, unknown field, `language: "en"`, `min_score: 2`, `entities: []`
  → 400 `invalid_request` with `field`; the offending value never appears in the body
  or the logs (US5-4)
- [x] T021 [P] [US6] `privacy/tests/api/test_openapi.py`: `app.openapi()` serialised
  equals `privacy/openapi.json` byte for byte (US6-1); `EntityKind` and
  `SensitivityLevel` are named components with closed `enum`s; request schemas have
  `additionalProperties: false` (US6-2)
- [x] T022 [P] [US1] `privacy/tests/nlp/test_analyze_nlp.py` (`@pytest.mark.nlp`, real
  engine): a Spanish sentence with a name and an email → `PERSON` and `EMAIL` with exact
  spans, level `high` (US1-1, phone added in T048); a location; an English sentence
  with an email still finds the email (edge case)
- [x] T023 [P] [US1] `privacy/tests/nlp/test_latency.py` (`nlp`): 20 warm-up and 100
  timed `/analyze` calls on a 2 000-character text, p95 < 200 ms, p95 printed (SC-004)

### Implementation

- [x] T024 `src/domain/entity_kind.py` and `src/domain/finding.py` (data-model §1.1,
  §1.2: `finding()` factory returns `None` for `start < 0`, `end <= start` or a score
  outside 0–1)
- [x] T025 `src/domain/sensitivity.py` (data-model §1.3)
- [x] T026 `src/domain/overlap.py` (data-model §1.4, research R-08)
- [x] T027 `src/application/ports.py` and `src/application/analyze_text.py`
  (data-model §2)
- [x] T028 Add the Spanish model as a locked wheel dependency (`[tool.uv.sources]`,
  research R-03) and `presidio-analyzer`; mypy overrides for untyped modules
  (research R-04)
- [x] T029 `src/infrastructure/presidio_analyzer.py`: `build_engine(settings)` with the
  explicit registry of research R-02 (spaCy `PER`/`LOC` only, `EmailRecognizer`,
  `CreditCardRecognizer`), `PRESIDIO_TO_KIND`, `PresidioAnalyzer` implementing the port
- [x] T030 `src/api/schemas.py` (data-model §4; `extra="forbid"`; `min_score`
  `ge=0, le=1`; `entities` `min_length=1` when present)
- [x] T031 `src/api/limits.py`: 1 MiB limit on `content-length` and while streaming the
  body; `src/api/errors.py`: `RequestValidationError` handler → 400 with the dotted
  `loc`, message from the error type only, never `input`
- [x] T032 `POST /analyze` in `src/api/app.py` (`create_app(analyzer, settings)`;
  readiness from `analyzer.is_ready`), request log fields `text_length`, `counts`,
  `level`; `src/main.py` builds the engine before serving (research R-11)
- [x] T033 `privacy/scripts/export_openapi.py` (writes `openapi.json` with two-space
  indentation and a trailing newline; `--check` exits 1 on drift); commit
  `privacy/openapi.json`

### Verification

- [x] T034 `quickstart.md` §1–§3 and §5 (`/health`, `/analyze`, the 400 example);
  confirm CI ran the `nlp` tests with the model from the uv cache and record the CI time
  of the Python steps
- [x] T035 Write `docs/tasks/done/T-004-03-analyzer-analyze-endpoint.md` (note: the
  backlog row's "phone detected" assertion lands in `T-004-05` with the Spanish phone
  recognizer, T048), flip the backlog row

---

## Phase 3: `T-004-04` — DNI, NIE and CIF with check digits (US2)

**Goal**: the three identity recognizers, validated by domain functions. **Independent
test**: `uv run pytest tests/unit/test_checksums_identity.py tests/recognizers` passes
without the model.

### Tests first

- [x] T036 [P] [US2] `privacy/tests/unit/test_checksums_identity.py`: published valid
  and invalid examples for DNI, NIE and CIF (digit-control, letter-control and either
  organisation letters); hypothesis: our functions agree with `stdnum.es.dni`, `nie`,
  `cif` on generated inputs; changing the control character of a valid identifier makes
  it invalid (US2-2, US2-4, US2-5); add `python-stdnum` as a dev dependency
- [x] T037 [P] [US2] `privacy/tests/recognizers/test_identity_recognizers.py` (the three
  recognizers run alone, no model): valid DNI as `12345678Z`, `12345678-Z`,
  `12.345.678-Z` and `12345678z` → `DNI`, score ≥ 0.9 (US2-1); wrong letter → nothing
  (US2-2); `Pedido 12345678`, `46001 12345678`, a date → nothing (US2-3); NIE valid /
  wrong letter (US2-4); CIF valid with digit and letter control / wrong control
  (US2-5)
- [x] T038 [P] [US1] Extend `privacy/tests/nlp/test_analyze_nlp.py`: a sentence with a
  valid DNI → level `critical` (US1-2); a sentence with only a CIF → `low` (US1-4)

### Implementation

- [x] T039 `src/domain/checksums.py`: `compact`, `is_valid_dni`, `is_valid_nie`,
  `is_valid_cif` (research R-13)
- [x] T040 `src/infrastructure/recognizers/validated.py`: `ValidatedPatternRecognizer`
- [x] T041 `src/infrastructure/recognizers/identity.py`: patterns with word boundaries,
  one separator kind, case-insensitive; context words (`dni`, `nif`, `nie`, `cif`,
  `documento`)
- [x] T042 Register the three in `build_engine`; README table of recognizers

### Verification

- [x] T043 Gates green locally and in CI; write
  `docs/tasks/done/T-004-04-identity-recognizers.md`, flip the backlog row

---

## Phase 4: `T-004-05` — IBAN, phone and NSS (US2)

**Goal**: the remaining Spanish recognizers. **Independent test**: recognizer suites pass
without the model; the `nlp` suite shows phones and overlaps resolved.

### Tests first

- [x] T044 [P] [US2] `privacy/tests/unit/test_checksums_banking.py`: IBAN mod-97 and
  Spanish account control digits (published examples; hypothesis against
  `stdnum.iban` and `stdnum.es.ccc`); NSS examples and the control-digit mutation
  property; `is_spanish_phone` structure table (US2-6, US2-7)
- [x] T045 [P] [US2] `privacy/tests/recognizers/test_banking_recognizers.py`: Spanish
  IBAN grouped and compact → `IBAN` (US2-6); one wrong check digit → nothing; valid
  mod-97 but wrong account control digits → nothing; a valid German or French IBAN →
  `IBAN`
- [x] T046 [P] [US2] `privacy/tests/recognizers/test_nss_recognizer.py`: NSS with `/`,
  space, dash or no separator → `NSS`; wrong control digits or province 00 → nothing
  (US2-7)
- [x] T047 [P] [US2] `privacy/tests/recognizers/test_phone_recognizer.py`: mobiles and
  landlines with `+34`, `0034`, none; spaces, dots, dashes; numbers starting with 1–5
  and ten-digit numbers → nothing; score 0.6 bare and higher with `teléfono` / `móvil`
  nearby (US2-8)
- [x] T048 [P] [US1] Extend `privacy/tests/nlp/test_analyze_nlp.py`: the US1-1 sentence
  with a phone → `PERSON`, `EMAIL`, `PHONE`, level `high` (US1-1 complete)
- [x] T049 [P] `privacy/tests/nlp/test_overlaps_nlp.py`: a phone-shaped run inside an
  IBAN → one `IBAN`; an NSS that is also phone-shaped → reported once (spec edge cases)

### Implementation

- [x] T050 `src/domain/checksums.py`: `is_valid_iban`, `is_valid_nss`,
  `is_spanish_phone` (research R-13)
- [x] T051 `src/infrastructure/recognizers/{banking,social_security,phone}.py`
  (research R-12 scores and context words)
- [x] T052 Register the three in `build_engine`; README recognizers table complete

### Verification

- [x] T053 Gates green locally and in CI; write
  `docs/tasks/done/T-004-05-banking-phone-nss-recognizers.md`, flip the backlog row

---

## Phase 5: `T-004-06` — Reversible anonymization (US3, US5)

**Goal**: `POST /anonymize` with `<KIND_n>` placeholders and the map, nothing stored.
**Independent test**: placeholder property tests and the API suite pass; the no-writes
test passes.

### Tests first

- [x] T054 [P] [US3] `privacy/tests/unit/test_placeholders.py`: two names, a DNI and an
  email → `<PERSON_1>`, `<PERSON_2>`, `<DNI_1>`, `<EMAIL_1>`, no original value left
  (US3-1); a name three times → one placeholder (US3-2); no findings → same text, empty
  mapping (US3-4); input already containing `<DNI_1>` and `<DNI_3>` → new DNI is
  `<DNI_4>` (US3-6); hypothesis over random texts and non-overlapping findings: restore
  equals original (US3-3)
- [x] T055 [P] [US3] `privacy/tests/unit/test_anonymize_text.py` with the fake analyzer:
  the result carries the analysis of the original text (US3-7)
- [x] T056 [P] [US3] `privacy/tests/api/test_anonymize.py`: response shape of
  `contracts/http.md` against `contracts/anonymize.example.json` through the fake
  analyzer; restore with the test helper equals the request text (US3-3); no mapped
  value appears in `text` (US3-1); `analysis` present (US3-7); log capture contains no
  value and no placeholder mapping
- [x] T057 [P] [US3] `privacy/tests/api/test_no_writes.py`: with a `sys.addaudithook`
  recorder active, run `/analyze` and `/anonymize` (real app, fake analyzer) and assert
  no `open` event in a write mode, no `sqlite3.connect` and no socket connect (US3-5,
  US5-2)
- [x] T058 [P] [US3] `privacy/tests/nlp/test_anonymize_nlp.py`: the contracts example
  text end to end with the real engine; restore exact

### Implementation

- [x] T059 `src/domain/placeholders.py` (data-model §1.5, research R-07)
- [x] T060 `src/application/anonymize_text.py`
- [x] T061 `privacy/tests/helpers/restore.py`: `restore(text, mapping)` (documents the
  gateway's future restore, `T-005-04`)
- [x] T062 `POST /anonymize` in `src/api/app.py` and its schemas; re-export
  `privacy/openapi.json`

### Verification

- [x] T063 `quickstart.md` §5 anonymize call; gates green; write
  `docs/tasks/done/T-004-06-reversible-anonymization.md`, flip the backlog row

---

## Phase 6: `T-004-07` — Synthetic corpus and detection metrics (US4, US5)

**Goal**: corpus v1, its generator, the metrics run with thresholds in CI. **Independent
test**: `uv run pytest -m metrics` passes and writes the report; breaking a recognizer
makes it fail.

### Tests first

- [x] T064 [P] [US4] `privacy/tests/metrics/test_corpus_format.py`: first line is the
  meta record with `synthetic: true` and a version; every case validates (data-model
  §5); sizes of research R-14; every positive structured span passes its domain check,
  every `negative`-tagged identifier fails it; `generate_corpus.py --check` reproduces
  the file (US4-3)
- [x] T065 [P] [US4] `privacy/tests/metrics/test_detection_metrics.py` (`metrics`):
  full pipeline over the corpus; writes `privacy/reports/detection-metrics.json`
  (data-model §6); asserts SC-001 for each structured kind and `PERSON` recall ≥ 0.80,
  reports `LOCATION` (US4-1, US4-4); anonymize → restore exact on every case and no
  reported value left in anonymized text (SC-003)
- [x] T066 [P] [US4] `privacy/tests/unit/test_metrics_scoring.py`: the scorer's matching
  rules (exact spans for structured kinds, overlap for `PERSON`/`LOCATION`) on
  hand-made predictions; a threshold failure message names the kind, the metric and the
  value (US4-2)
- [x] T067 [P] [US5] `privacy/tests/conftest.py`: session-wide autouse log capture that
  fails the session if any corpus case text, or any value of a span, appears in any
  captured log record (US5-1, SC-005)

### Implementation

- [x] T068 `privacy/scripts/generate_corpus.py` (Faker `es_ES`, seed 20261030, own
  identifier generators, templates per domain, hard negatives; `--check`); Faker as a
  dev dependency
- [x] T069 Generate and commit `privacy/tests/corpus/pii-es.v1.jsonl`
- [x] T070 `privacy/tests/metrics/scoring.py`: per-kind counts, precision, recall,
  thresholds table, report writer
- [x] T071 `.github/workflows/ci.yml`: upload `services/privacy/reports/` as an artifact
  (also on failure)

### Verification

- [x] T072 `quickstart.md` §4 including the deliberate break; record the metrics table
  in `docs/tasks/done/T-004-07-corpus-and-metrics.md`, flip the backlog row

---

## Phase 7: Polish and cross-cutting

- [x] T073 [P] `README.md` "Status": feature 004 done, the detection metrics table,
  link to `specs/004-privacy-service/quickstart.md`
- [x] T074 [P] `docs/architecture.md` (privacy service layers and endpoints) and
  `CLAUDE.md` section 12 (privacy commands, `-m nlp`, `-m metrics`)
- [x] T075 [P] `docker-compose.yml`: `privacy` service built from `services/privacy`,
  healthcheck, internal network only (no published port by default)
- [x] T076 Run `quickstart.md` end to end (including §6 Docker in CI or on a machine with
  Docker) and record the results in the last task record of the feature

Tasks T073–T076 belong to the last PR of the feature (`T-004-06` or `T-004-07`,
whichever merges second).

---

## Dependencies

```text
Phase 1 (T-004-02) ─▶ Phase 2 (T-004-03) ─▶ Phase 3 (T-004-04) ─▶ Phase 4 (T-004-05) ─┬─▶ Phase 5 (T-004-06) ─┐
                                                                                      └─▶ Phase 6 (T-004-07) ─┴─▶ Phase 7
```

- Phases 5 and 6 need only Phase 4 and touch disjoint files (except `conftest.py`, where
  T067 adds a fixture, and `README.md`); they can run as two sessions.
- Feature 005's `T-005-03` needs Phase 5 (the full contract); feature 007's `T-007-03`
  needs Phase 6 (the corpus).
- Within a phase, `[P]` tasks are independent files; unmarked tasks depend on the ones
  above them.

## Parallel execution examples

- Phase 1: T003 … T005 together; T011 … T013 together after T009.
- Phase 2: T015 … T023 together (nine test files); T024 … T026 together; T030 and T031
  in parallel with T029.
- Phase 3: T036 … T038 together.
- Phase 4: T044 … T049 together.
- Phase 5 ∥ Phase 6 as two sessions.

## Implementation strategy

1. **MVP** = Phases 1–4: `/analyze` with every Spanish recognizer. With it, feature 005
   can already route by sensitivity (`restrict_to_local`, `block`).
2. Phase 5 adds `anonymize`, the action that lets non-local providers serve sensitive
   requests.
3. Phase 6 turns detection quality into a CI gate and publishes the numbers; it can be
   developed alongside Phase 5.
4. Each phase is one PR, one backlog row flipped to `done`, one task record under
   `docs/tasks/done/`.

## Totals

| Phase | Backlog | Tasks | Stories |
|---|---|---|---|
| 1 | `T-004-02` | T001–T014 (14) | US5 |
| 2 | `T-004-03` | T015–T035 (21) | US1, US5, US6 |
| 3 | `T-004-04` | T036–T043 (8) | US2, US1 |
| 4 | `T-004-05` | T044–T053 (10) | US2, US1 |
| 5 | `T-004-06` | T054–T063 (10) | US3, US5 |
| 6 | `T-004-07` | T064–T072 (9) | US4, US5 |
| 7 | polish | T073–T076 (4) | — |
| **Total** | | **76** | |
