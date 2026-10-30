# Research: Privacy Service

**Feature**: `004-privacy-service` · **Date**: 2026-10-30 · **Spec**: [spec.md](spec.md)

Decisions taken while planning. Each names what was chosen, why, and what was rejected.
Library facts were checked against Context7 (Presidio, 2026-10-30). Exact versions are
pinned by `uv.lock` in `T-004-02`; where this page names a line (2.2, 3.8), the
implementing session confirms the newest release of that line before locking.

## R-01 Toolchain: a uv project outside the pnpm workspace

**Decision**: `services/privacy` is a standalone uv project (`pyproject.toml`,
`uv.lock`, `.python-version` = 3.12, `src/` layout, package `privacy`). It is not a
pnpm workspace member and Turborepo does not run it; its gates run as separate CI steps
(R-06). Commands: `uv sync`, `uv run ruff check .`, `uv run ruff format --check .`,
`uv run mypy .`, `uv run lint-imports`, `uv run pytest`.

**Rationale**: `CLAUDE.md` section 4 fixes Python 3.12, uv, Ruff, strict mypy and
pytest. Wrapping uv in a fake `package.json` so Turborepo can cache it would add a
layer for no gain (X).

**Alternatives**: Poetry or pip-tools (not the project's stack); a `package.json` shim
for Turborepo (indirection; Turborepo caching of a 1 GB model environment is not
useful).

## R-02 Presidio setup: Spanish NLP engine, own Spanish recognizers, two built-ins

**Decision**:

- `presidio-analyzer` 2.2 line (now published by the Data Privacy Stack organisation;
  same package name and API).
- NLP engine built with `NlpEngineProvider` and
  `{"nlp_engine_name": "spacy", "models": [{"lang_code": "es", "model_name": "es_core_news_lg"}]}`,
  passed to `AnalyzerEngine(nlp_engine=…, registry=…, supported_languages=["es"])`.
- An explicit `RecognizerRegistry(supported_languages=["es"])` with exactly:
  - `SpacyRecognizer` for Spanish, mapping spaCy `PER` → `PERSON` and `LOC` → `LOCATION`
    (`ORG` and `MISC` are not reported);
  - Presidio's `EmailRecognizer` and `CreditCardRecognizer` (Luhn-validated),
    instantiated with `supported_language="es"`;
  - our six recognizers (DNI, NIE, CIF, IBAN, NSS, PHONE), R-12 and R-13.
- Presidio entity names are mapped to `EntityKind` in one table in the adapter
  (`EMAIL_ADDRESS` → `EMAIL`, …); any result whose entity is not in the table is
  dropped, so the closed list of FR-005 holds whatever Presidio returns.

**Rationale**: `load_predefined_recognizers` would register US/UK recognizers, URL, IP
and date detectors we do not report, plus `ES_NIF`/`ES_NIE`, which overlap ours. One
explicit registry makes the set of recognizers visible and testable. The built-in
Spanish recognizers do not cover CIF, NSS, phones or the IBAN account control digits;
writing all six in one style keeps tests uniform.

**Alternatives**: predefined registry filtered by `countries=["es"]` plus custom
additions (still pulls generic recognizers and duplicates DNI/NIE); a pure-regex service
without Presidio (loses the NER and context machinery the project chose).

## R-03 The spaCy model is a locked dependency, baked into the image

**Decision**: `es_core_news_lg` 3.8 is declared as a dependency whose source is the
official wheel URL from the `explosion/spacy-models` releases (`[tool.uv.sources]`), so
`uv sync --frozen` installs it with a hash in `uv.lock`. The Docker build stage runs
`uv sync --frozen --no-dev`; the runtime stage copies the virtual environment. CI caches
uv's download cache keyed on `uv.lock`.

**Rationale**: reproducible installs, no `python -m spacy download` at run time (which
would need network in the container and is unpinned).

**Alternatives**: `spacy download` in the Dockerfile and in CI (unpinned, no hash);
`es_core_news_md` (smaller; kept as a measured option, not the default, because names
are the weakest kind and `lg` is what `CLAUDE.md` names).

## R-04 Strict typing with untyped libraries

**Decision**: mypy `strict = true` over `src`, `scripts` and `tests`, plus
`disallow_any_explicit` for `src`. Presidio and spaCy are imported only in
`infrastructure/`; where their stubs are missing, a `[[tool.mypy.overrides]]` with
`ignore_missing_imports = true` names those modules alone, and the adapter converts
their results to our frozen dataclasses immediately, so `Any` never crosses the
infrastructure boundary.

**Rationale**: constitution VII; the same "edges absorb untyped input" rule as Zod at
the gateway's edges.

**Alternatives**: writing full stubs for Presidio (large, out of scope); relaxing
strictness for the whole package (hides real errors).

## R-05 Layering is checked by import-linter

**Decision**: `import-linter` with two contracts in `pyproject.toml`:

1. *layers*: `privacy.api` → `privacy.application` → `privacy.domain`, with
   `privacy.infrastructure` allowed to import `application` and `domain` only, and
   `privacy.main` the only module importing `infrastructure`;
2. *forbidden*: `privacy.domain` and `privacy.application` may not import `fastapi`,
   `pydantic`, `presidio_analyzer`, `spacy` or `starlette`
   (`include_external_packages = true`).

`uv run lint-imports` is a CI step (R-06) and a pytest-independent gate.

**Rationale**: FR-002 and constitution I; the Python counterpart of dependency-cruiser.

**Alternatives**: a hand-written AST test (reinvents import-linter); review only (not
enforced).

## R-06 CI: Python steps inside the one required `ci` job

**Decision**: after the Node steps, the `ci` job gains:

1. `astral-sh/setup-uv` (pinned SHA, cache enabled, `cache-dependency-glob:
   services/privacy/uv.lock`);
2. `uv sync --frozen` (working directory `services/privacy`);
3. `ruff check .` and `ruff format --check .`;
4. `mypy .`;
5. `lint-imports`;
6. `pytest` with every marker (unit, recognizers, api, `nlp`, `metrics`) and coverage;
7. (from `T-004-02`) `docker build services/privacy` without push.

The job's `timeout-minutes` rises to 25. Biome ignores `services/privacy/**` (Python
tooling owns that tree; the exported `openapi.json` is written with two-space
indentation and a trailing newline anyway).

**Rationale**: `T-001-05` made `ci` the single required check of `main`; a second job
would need a branch-protection change and could be forgotten. Docker build in CI proves
the backlog's "`docker build` succeeds".

**Alternatives**: a separate `privacy` job with a path filter (faster on gateway-only
PRs, but a second required check, and path filters make required checks skip); running
the Python gates only locally (not enforced).

## R-07 Placeholders are a pure domain function, not `presidio-anonymizer`

**Decision**: `domain/placeholders.py` exports `anonymize(text, findings) ->
Anonymized(text, mapping)`:

1. scan the input for existing `<KIND_n>` strings and start each kind's counter after
   the highest `n` found (FR-015);
2. walk findings in order of `start`; the key is `(kind, exact value)`; a new key gets
   `<KIND_{next}>`, a repeated key reuses its placeholder (FR-014);
3. build the output left to right from the untouched slices and placeholders;
4. return `mapping` as a list ordered by first appearance: `placeholder`, `kind`,
   `value`.

A matching `restore(text, mapping)` lives in the test helpers (and documents what the
gateway will do in `T-005-04`); the service never restores.

**Rationale**: Presidio's anonymizer would need a custom operator holding the same
counter and map, and does not avoid collisions with pre-existing placeholder strings.
Our function is deterministic, has no dependency, and is property-tested (round trip
over arbitrary texts and findings).

**Alternatives**: `AnonymizerEngine` with a custom `entity_counter` operator and
`DeanonymizeEngine` (from the Presidio docs; more moving parts for the same result);
hashing values into placeholders (leaks equality across requests, and is not shorter).

## R-08 Overlaps and score filtering are domain rules

**Decision**: the use case pipeline is: adapter results → drop kinds not requested →
drop scores below `min_score` (default 0.5, request may raise or lower it within
[0, 1]) → `resolve_overlaps` → `level_of`. `resolve_overlaps` sorts by start and, when
two findings overlap, keeps the one with the higher score; on a tie it keeps the more
specific kind by the fixed order `DNI, NIE, CIF, IBAN, NSS, CREDIT_CARD, EMAIL, PHONE,
PERSON, LOCATION`; on a further tie, the longer span.

**Rationale**: the spec's edge cases; Presidio's own deduplication only removes exact
duplicates and contained results of the same entity type. Keeping the rule in the
domain makes it testable and stable across Presidio versions.

**Alternatives**: rely on Presidio's `remove_conflicts` (version-dependent behaviour);
report all overlaps and let the gateway decide (pushes ambiguity into placeholders).

## R-09 Logging: one JSON logger with an allow-list

**Decision**: stdlib `logging` with a small JSON formatter. Each request logs one line
with an allow-listed set of fields: `request_id` (from `x-request-id` or generated),
`endpoint`, `status`, `duration_ms`, `text_length`, `counts` (per kind), `level`,
`error_type`. The formatter drops any other `extra` field. Uvicorn's access log is
replaced by this line (`access_log=False`). Exceptions are logged with type and
traceback of our frames only, never `str(exc)` for validation errors.

**Rationale**: FR-021 and SC-005. Pydantic validation errors include the offending
`input` value; the default FastAPI 422 handler echoes it. An allow-list is safer than a
deny-list of field names (the gateway's pino redaction is a deny-list because it logs
arbitrary objects; here we control every log call).

**Alternatives**: `structlog` (another dependency for one line per request); keeping
uvicorn's access log (fine for paths, but it is a second format).

## R-10 Error envelope and statuses mirror the gateway

**Decision**: errors use `{"error": {"type": …, "message": …, "field": …?}}`:

| Situation | Status | `type` |
|---|---|---|
| Body not JSON, schema violation, unknown field, unsupported language | 400 | `invalid_request` (`field` = dotted path, message never contains the value) |
| Body over 1 MiB (by `content-length` or while reading) | 413 | `payload_too_large` |
| Model not loaded | 503 | `not_ready` |
| Anything else | 500 | `internal_error` (generic message) |

A custom `RequestValidationError` handler replaces FastAPI's 422.

**Rationale**: the gateway already maps 400 `invalid_request` with paths only (002);
using the same vocabulary keeps `T-005-03`'s mapping trivial. 422 vs 400 is cosmetic;
consistency wins.

**Alternatives**: FastAPI's default 422 body (echoes input: violates V).

## R-11 Readiness: the model loads before the server accepts traffic

**Decision**: `main.py` builds the analyzer (model load) before creating the app;
`create_app` receives the analyzer and a `readiness` callable. `GET /health` returns
200 `{"status": "ok", "ready": true, "version": …}` when ready, 503 `not_ready` when not.
Tests inject a not-ready state. The Docker `HEALTHCHECK` calls `/health` with the
standard library (no curl in the image).

**Rationale**: FR-001 and US5-5 with no background loading machinery: the process does
not listen until the model is loaded, and the readiness flag still exists for tests and
for a future reload.

**Alternatives**: background loading with a separate `/ready` (more states for no
current need); no readiness at all (US5-5 untestable).

## R-12 Scores and context

**Decision**:

- Validated recognizers (DNI, NIE, CIF, IBAN, NSS): a regex candidate whose check passes
  gets score 1.0 (Presidio's `validate_result → True` behaviour); a failing check removes
  the candidate (`False`). This satisfies "≥ 0.9 when valid" with margin.
- Phone: candidate score 0.6 without context; Presidio's context enhancer raises it with
  the words `teléfono`, `tel`, `tlf`, `móvil`, `movil`, `llamar`, `whatsapp`, `fijo`,
  `contacto`. Default `min_score` 0.5 reports both; a caller wanting fewer false
  positives raises `min_score` to 0.7.
- Email and card: Presidio defaults (email 1.0 after TLD validation, card 1.0 after
  Luhn).
- PERSON / LOCATION: spaCy recognizer default (0.85).

**Rationale**: the backlog's "score ≥ 0.9" for identifiers; phones are the kind where
context matters most and are measured by the corpus.

**Alternatives**: requiring context for phones (misses bare numbers in short prompts,
which are common); scoring by regex strictness only (no validation signal).

## R-13 Check-digit algorithms (domain/checksums.py)

All functions take the candidate string, normalise it (upper-case, remove one kind of
separator: space, dot or dash) and return `bool`.

- **DNI**: 8 digits + letter; letter = `"TRWAGMYFPDXBNJZSQVHLCKE"[number % 23]`.
- **NIE**: `X`/`Y`/`Z` + 7 digits + letter; replace the prefix by `0`/`1`/`2` and apply
  the DNI rule to the resulting 8 digits.
- **CIF**: organisation letter (`ABCDEFGHJNPQRSUVW`) + 7 digits + control. Sum of the
  digits in even positions (2, 4, 6) plus, for odd positions (1, 3, 5, 7), the sum of
  the digits of twice each digit; `d = (10 - sum % 10) % 10`. Letters `P Q R S N W`
  (and `K L M`, which are not CIF prefixes and are rejected) require the control letter
  `"JABCDEFGHI"[d]`; `A B E H` require the digit `d`; the others accept either.
- **IBAN**: 2 letters + 2 digits + up to 30 alphanumerics, length per country (24 for
  ES); move the first four characters to the end, letters to numbers (A = 10 … Z = 35),
  the number mod 97 must equal 1. For `ES`, also the account's own control digits: in
  `ES kk BBBB GGGG DD NNNNNNNNNN`, the first `D` is the weighted sum of `00BBBBGGGG`
  and the second of `NNNNNNNNNN`, weights `1 2 4 8 5 10 9 7 3 6`, `11 - sum % 11`,
  with 11 → 0 and 10 → 1.
- **NSS**: 12 digits `PP NNNNNNNN CC`; with `a = PP` and `b = NNNNNNNN`, the base is
  `b + a * 10_000_000` when `b < 10_000_000`, else the concatenation `PPNNNNNNNN` as a
  number; `CC = base % 97`. Province `PP` in 01–53 or 66.
- **Phone**: no checksum; structure only: optional `+34`/`0034`, then nine digits
  starting with `6`, `7` (`71`–`74`), `8` or `9`, with at most one separator between
  groups. Premium and toll-free numbers (`80x`, `90x`) are real phone numbers and are
  reported.

Each algorithm has unit tests with published valid examples and generated ones, and a
`hypothesis` property: for any valid identifier, changing the control character makes it
invalid.

**Rationale**: FR-009 … FR-013; these are the business rules of "what is a Spanish
identifier".

**Alternatives**: third-party validators such as `python-stdnum` (would cover DNI, NIE,
CIF, IBAN and NSS in one dependency). Kept as the *test oracle*: the property tests
compare our functions against `stdnum.es.dni`, `nie`, `cif`, `ccc` and `stdnum.iban` for
generated inputs, so the domain stays dependency-free while correctness is
cross-checked. `python-stdnum` has no Spanish NSS module; NSS is tested against
published examples and the mutation property only.

## R-14 Corpus v1 and metrics

**Decision**:

- `scripts/generate_corpus.py` (dev dependency Faker with `es_ES`, fixed seed
  `20261030`) writes `tests/corpus/pii-es.v1.jsonl`. The first line is a `meta` record
  (`version`, `synthetic: true`, `generator`, `seed`, `created`); every other line is a
  `case`: `id`, `text`, `spans` (`kind`, `start`, `end`), `tags` (domain: clinic,
  legal, hr, fintech, generic; `negative` for hard negatives).
- Identifiers come from our own generators (valid by construction, cross-checked with
  `stdnum`); hard negatives are the same identifiers with a wrong control character,
  eight-digit order numbers, postcodes, dates and nine-digit numbers starting with 1–5.
- Size: ≥ 300 cases, ≥ 30 positive cases per structured kind, ≥ 50 hard negatives,
  ≥ 60 cases with names and ≥ 40 with locations.
- Matching for metrics: a prediction is a true positive for structured kinds when kind,
  start and end match exactly; for `PERSON` and `LOCATION` when the kind matches and the
  spans overlap (NER boundaries differ on titles such as "Dra."). Unmatched predictions
  are false positives, unmatched labels false negatives.
- `pytest -m metrics` runs the full pipeline (real model) over the corpus, writes
  `services/privacy/reports/detection-metrics.json` (gitignored; uploaded as a CI
  artifact), prints a table and fails per the thresholds of SC-001/SC-002. It also runs
  anonymize → restore over every case (SC-003).
- Feature 007 reads the corpus in place (`services/privacy/tests/corpus/`); the file is
  the single copy (FR-019).

**Rationale**: constitution IV; deterministic regeneration means a reviewer can check
that the corpus is synthetic by reading the generator.

**Alternatives**: hand-written cases only (too few for stable metrics); an LLM-generated
corpus (non-reproducible, and an LLM may echo real data).

## R-15 Latency check

**Decision**: an `nlp` test runs 20 warm-up calls, then 100 timed `/analyze` calls
through the test client on a fixed 2 000-character corpus text, and asserts p95 <
200 ms (SC-004). If CI proves noisy, the bound is reported, not relaxed silently: the
change is recorded in the task record.

**Rationale**: the gateway calls the service on every request; feature 005 runs it in
parallel with classification, so its latency is directly user-visible.

**Alternatives**: a separate benchmark job (more CI configuration for one number).
