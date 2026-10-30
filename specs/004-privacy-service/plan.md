# Implementation Plan: Privacy Service

**Branch**: `004-privacy-service` | **Date**: 2026-10-30 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/004-privacy-service/spec.md`

## Summary

A small Python service in `services/privacy` that the gateway calls over HTTP. It wraps
Presidio's `AnalyzerEngine` with the Spanish spaCy model `es_core_news_lg` for names
and locations, adds our own Spanish pattern recognizers whose check-digit validation
lives in pure domain functions (DNI, NIE, CIF, IBAN, NSS, phone), keeps Presidio's
email and card (Luhn) recognizers, and maps every result into a closed list of kinds.
The domain resolves overlaps, computes the sensitivity level and builds reversible
`<KIND_n>` placeholders; nothing is stored. `POST /analyze` returns findings without
values; `POST /anonymize` returns the anonymized text, the map and the analysis. The
Pydantic models are the contract; the OpenAPI document is exported to
`services/privacy/openapi.json` and checked for drift, so feature 005 can mirror it in
Zod. A seeded generator produces a synthetic, labelled Spanish corpus; a pytest marker
computes precision and recall per kind and fails below the spec's thresholds. The
service's quality gates run as extra steps of the existing `ci` job.

## Technical Context

**Language/Version**: Python 3.12 (pinned by `.python-version` and
`requires-python = ">=3.12,<3.13"`).

**Primary Dependencies**: FastAPI with Pydantic v2 and Uvicorn (`fastapi[standard]`
minus the CLI extras we do not use); `presidio-analyzer` (Data Privacy Stack
organisation, 2.2 line, R-02); spaCy 3.8 with `es_core_news_lg` 3.8 installed as a
pinned wheel URL through uv (R-03). Dev: Ruff, mypy (strict), pytest, `pytest-cov`,
`import-linter`, `hypothesis`, `python-stdnum` (test oracle, R-13), Faker (corpus generator), `httpx` (FastAPI test client). Not used:
`presidio-anonymizer` (R-07).

**Storage**: none. No database, cache or file writes at run time (FR-016).

**Testing**: pytest. Unit tests of domain functions (checksums, overlap, sensitivity,
placeholders) with no model; recognizer tests that run the pattern recognizers alone
(no model); `nlp`-marked tests that load the real model (person, location, end-to-end
`/analyze`); `metrics`-marked corpus run with thresholds; FastAPI `TestClient` for the
HTTP contract, limits and health; a log-capture fixture that fails a test if any input
text appears in logs (SC-005); `hypothesis` property tests for the checksum functions
and the anonymize → restore round trip.

**Target Platform**: Linux container (multi-stage, non-root), GitHub Actions
`ubuntu-latest`; developed on Windows 11.

**Project Type**: one more service in the monorepo, outside the pnpm workspace (uv
project).

**Performance Goals**: `/analyze` of a 2 000-character text < 200 ms p95 after warm-up
in CI (SC-004); model load < 20 s at start.

**Constraints**: domain imports nothing outside the standard library (checked by
import-linter, R-05); no input text, values or maps in logs, errors or files (V); body
limit 1 MiB; image size dominated by the model (~550 MB), acceptable for the demo;
CI time for the Python steps < 4 minutes with the uv cache warm.

**Scale/Scope**: 6 backlog tasks (`T-004-02` … `T-004-07`); ~6 domain modules, 2 use
cases, 1 port, 1 Presidio adapter with 6 recognizers, 2 endpoints plus health, 1
generator script, 1 corpus file; 23 FRs, 6 stories, 32 scenarios.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| # | Principle | How this plan complies | Status |
|---|---|---|---|
| I | Strict Clean Architecture | `src/privacy/{domain,application,infrastructure,api}` with `main.py` (composition root) as the only importer of `infrastructure`; contracts enforced by import-linter in CI (R-05), the Python counterpart of dependency-cruiser. | PASS |
| II | Contract-first | Pydantic request/response models in `api/schemas.py` are the source; `openapi.json` is exported from them and committed; a test fails on drift (FR-022). Feature 005 mirrors it in Zod (`T-005-03`). | PASS |
| III | Spec before code | Each of the 32 scenarios maps to a named test (coverage table in `tasks.md`). | PASS |
| IV | Evals are executable spec | Detection is an AI behaviour: synthetic corpus v1 + thresholds in SC-001/SC-002, enforced by `pytest -m metrics` in CI (`T-004-07`); feature 007 reuses the corpus. | PASS |
| V | Privacy by default | Findings carry positions, never values; maps only in the response; logging through one structured logger with an allow-list of fields (R-09); request bodies never logged; uvicorn access log keeps path and status only; a test greps captured logs for corpus texts. | PASS |
| VI | Fail fast, never silently | Settings validated at start (process exits on invalid values); model load failure stops start; typed errors at the edge; checksum failures are explicit `False`, not exceptions. Domain is total (no exceptions); errors only in `api/`. | PASS |
| VII | Strict typing | mypy `strict = true`, no `Any` in `src` (`disallow_any_explicit`), `Literal`/`StrEnum` closed lists, frozen dataclasses for domain values, `NewType` for scores and offsets where useful. Presidio and spaCy lack full stubs: their use is confined to `infrastructure/` with typed wrappers (R-04). | PASS |
| VIII | Testability | Use cases depend on a `PiiAnalyzerPort` protocol; application tests use an in-memory fake; only `nlp`/`metrics` tests load the model. No clock needed (no time logic). | PASS |
| IX | Composition over inheritance | Recognizers are configured instances of Presidio's `PatternRecognizer` with a validation function passed in (a thin subclass only where Presidio requires overriding `validate_result`); post-processing is a pipeline of pure functions (map kinds → drop below score → resolve overlaps → level). | PASS* |
| X | Simplicity | One port (the analyzer), justified by testing; no restore endpoint; no anonymizer library (R-07); no auth layer (internal network). | PASS |
| — | English-only (ADR-0002) | Code and docs in English; the corpus texts are Spanish by design. | PASS |
| — | Task protocol | One PR per backlog task `T-004-02` … `T-004-07`. | PASS |

\* Presidio's extension point for validation is a method override on
`PatternRecognizer`. We subclass once (`ValidatedPatternRecognizer`) and pass the domain
validator as a constructor argument, so there is one inheritance edge to a library type
and no hierarchy of our own.

## Project Structure

### Documentation (this feature)

```text
specs/004-privacy-service/
├── spec.md              # Specification (T-004-01), approved 2026-10-30
├── plan.md              # This file
├── research.md          # Phase 0: decisions R-01 … R-15
├── data-model.md        # Phase 1: domain, port, contract and corpus shapes
├── quickstart.md        # Phase 1: how to verify the feature end to end
├── contracts/
│   ├── README.md
│   ├── http.md                      # /analyze, /anonymize, /health, errors
│   ├── analyze.example.json         # request + response pair
│   ├── anonymize.example.json       # request + response pair
│   └── corpus.example.jsonl         # three corpus lines (format of T-004-07)
├── checklists/requirements.md
└── tasks.md             # Phase 2 (/speckit-tasks)
```

### Source Code (repository root; new or changed files only)

```text
services/privacy/
├── pyproject.toml            # uv project, deps, ruff, mypy, pytest markers, importlinter
├── uv.lock
├── .python-version           # 3.12
├── Dockerfile                # multi-stage, non-root, model baked in
├── .dockerignore
├── README.md                 # extended: run, test, endpoints, limits
├── openapi.json              # exported contract (T-004-03), drift-checked
├── scripts/
│   ├── export_openapi.py     # writes openapi.json
│   └── generate_corpus.py    # seeded synthetic corpus generator (T-004-07)
├── src/privacy/
│   ├── domain/
│   │   ├── entity_kind.py    # EntityKind (StrEnum), closed list FR-005
│   │   ├── finding.py        # Finding (kind, start, end, score)
│   │   ├── sensitivity.py    # SensitivityLevel, LEVEL_BY_KIND, level_of(findings)
│   │   ├── overlap.py        # resolve_overlaps(findings)
│   │   ├── placeholders.py   # anonymize(text, findings) -> (text, mapping)
│   │   └── checksums.py      # is_valid_dni/nie/cif/iban/nss, normalize helpers
│   ├── application/
│   │   ├── ports.py          # PiiAnalyzerPort (Protocol)
│   │   ├── analyze_text.py   # use case: analyze → filter → overlaps → level
│   │   └── anonymize_text.py # use case: analyze_text + placeholders
│   ├── infrastructure/
│   │   ├── presidio_analyzer.py      # AnalyzerEngine factory, kind mapping, adapter
│   │   ├── recognizers/
│   │   │   ├── validated.py          # ValidatedPatternRecognizer
│   │   │   ├── identity.py           # DNI, NIE, CIF (T-004-04)
│   │   │   ├── banking.py            # IBAN (T-004-05)
│   │   │   ├── social_security.py    # NSS (T-004-05)
│   │   │   └── phone.py              # Spanish phones (T-004-05)
│   │   └── settings.py       # pydantic-settings: port, min score, log level
│   ├── api/
│   │   ├── app.py            # create_app(analyzer, settings): routes, middleware, errors
│   │   ├── schemas.py        # Pydantic contract (source of openapi.json)
│   │   ├── errors.py         # error envelope and handlers
│   │   ├── limits.py         # 1 MiB body limit middleware
│   │   └── logging.py        # JSON logger with field allow-list, request id
│   └── main.py               # composition root: settings → engine → app
└── tests/
    ├── conftest.py           # fixtures: fake analyzer, app client, no-leak log capture
    ├── unit/                 # domain + application (no model)
    ├── recognizers/          # pattern recognizers alone (no model)
    ├── api/                  # TestClient: contract, limits, errors, health, openapi drift
    ├── nlp/                  # @pytest.mark.nlp: real model
    ├── metrics/              # @pytest.mark.metrics: corpus precision/recall (+ scoring.py)
    ├── helpers/restore.py    # restore(text, mapping): what the gateway will do (T-005-04)
    └── corpus/pii-es.v1.jsonl
.github/workflows/ci.yml      # + Python steps in job `ci` (R-06)
docker-compose.yml            # + `privacy` service (polish)
```

**Structure Decision**: the layering `CLAUDE.md` section 5 prescribes for the Python
service. Checksum algorithms are domain (pure, the business rule of "what is a DNI");
the regular expressions that find candidates are infrastructure (they exist to feed
Presidio). The API layer owns Pydantic models and maps domain objects to them; domain
objects are frozen dataclasses with no Pydantic dependency.

## Requirement → task mapping

| Backlog task | Requirements | Spec stories |
|---|---|---|
| `T-004-02` Skeleton: uv, FastAPI, layering, Ruff/mypy/pytest, Dockerfile, `/health`, CI steps, logging, error envelope | FR-001 … FR-003, FR-021 | US5 (1, 5) |
| `T-004-03` Analyzer + `/analyze` + sensitivity + overlaps + body limit and validation errors + OpenAPI export | FR-004 … FR-008, FR-020, FR-022, FR-023 | US1, US5 (3, 4), US6 |
| `T-004-04` DNI, NIE, CIF | FR-009, FR-013 | US2 (1–5) |
| `T-004-05` IBAN, phone, NSS | FR-010 … FR-013 | US2 (6–8) |
| `T-004-06` `/anonymize` with placeholders and map | FR-014 … FR-016 | US3, US5 (2) |
| `T-004-07` Corpus, generator, metrics, thresholds | FR-017 … FR-019 | US4 |

Order: `T-004-02` → `T-004-03` → `T-004-04` → `T-004-05` → {`T-004-06`, `T-004-07`}.
`T-004-06` and `T-004-07` both need only `T-004-05` and touch disjoint files (except
`README.md`), so they can run as two sessions. Feature 005 (`T-005-03`) needs
`T-004-06`; feature 007 (`T-007-03`) needs `T-004-07`.

## Complexity Tracking

No constitution violations to justify. For review:

- **R-07 own placeholder logic instead of `presidio-anonymizer`.** `CLAUDE.md` lists the
  Anonymizer in the stack. Our requirements (one placeholder per distinct value,
  numbering per kind, collision avoidance, the map returned) need a custom operator
  plus our own bookkeeping anyway; a 40-line pure domain function is simpler, fully
  testable without the library, and removes a dependency. If Alex prefers to keep the
  library for the portfolio story, the domain function stays and the operator calls it.
- **R-02 own Spanish recognizers instead of Presidio's `ES_NIF`/`ES_NIE`.** The built-ins
  exist but do not cover CIF, NSS, Spanish phones or the IBAN account control digits,
  and keeping two styles of recognizer would split the tests. We disable them.
- **R-06 Python steps in the one `ci` job.** Keeps the single required check of
  `T-001-05`; the job's timeout rises from 15 to 25 minutes.
- **Image size** (~1 GB with the model). Accepted for the demo; a smaller model is a
  later option measured by the corpus, not a default.
