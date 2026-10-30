# T-004-03 — Presidio analyzer and `POST /analyze`

| Field | Value |
|---|---|
| Task | `T-004-03` (see `docs/tasks/BACKLOG.md`) |
| Feature | `004-privacy-service` |
| Spec | `specs/004-privacy-service/spec.md` (FR-004 … FR-008, FR-020, FR-022, FR-023; US1, US5-3, US5-4, US6; SC-004); `tasks.md` Phase 2 (T015–T035); `research.md` R-02 … R-04, R-08, R-10, R-11, R-15 |
| Branch / PR | `T-004-03-analyze-endpoint` / PR opened after this commit |
| Date | 2026-10-30 |
| Session | Claude Code (Claude Opus 5.5), side session (merge authority delegated by Alex) |
| Status | done |

## What was done

The service now analyzes text. Presidio runs with spaCy `es_core_news_lg` behind a
`PiiAnalyzerPort` and uses one explicit registry:
- spaCy, reporting `PERSON` and `LOCATION` only;
- the email recognizer;
- the card recognizer (Luhn).

Every result is mapped to the closed `EntityKind` list. The domain then applies a
pipeline:
1. filter by the requested kinds;
2. filter by `min_score` (request value, else `PRIVACY_DEFAULT_MIN_SCORE`);
3. resolve overlaps (score, then specificity, then span length);
4. compute counts and the sensitivity level.

`POST /analyze` returns findings with offsets and scores, never values (US1-6). It runs
the analysis in a worker thread, with calls serialised by a lock in the adapter.

The API also gains:
- a 1 MiB body limit on `content-length` and on chunked bodies (US5-3);
- 400 `invalid_request` errors naming the field without echoing it (US5-4);
- the exported contract `services/privacy/openapi.json`, checked for drift by a test and
  by `scripts/export_openapi.py --check` (US6).

The service loads the model before it listens (R-11).

## Files touched

- Domain:
  - `services/privacy/src/privacy/domain/{entity_kind,finding,sensitivity,overlap}.py` (T024–T026).
- Application:
  - `src/privacy/application/{ports,analyze_text}.py` (T027).
- Infrastructure:
  - `src/privacy/infrastructure/presidio_analyzer.py`: `build_engine`, `PresidioAnalyzer`,
    `PRESIDIO_TO_KIND` (T029).
- API:
  - `src/privacy/api/schemas.py` (T030);
  - `api/limits.py` and the validation handler in `api/errors.py` (T031);
  - `api/app.py`, `api/mappers.py` (T032);
  - `api/openapi.py`: custom OpenAPI without FastAPI's 422 (T033).
- `src/privacy/main.py`: builds the engine first; `api/logging.py` mutes Presidio below
  WARNING.
- `services/privacy/scripts/export_openapi.py`, `services/privacy/openapi.json` (T033).
- `services/privacy/pyproject.toml`, `uv.lock` (T028):
  - dependencies `presidio-analyzer` 2.2.366 and spaCy 3.8;
  - the model `es-core-news-lg` 3.8.0 as a wheel URL in `[tool.uv.sources]`;
  - dev dependency `python-stdnum` (for T-004-04);
  - mypy now also checks `scripts`;
  - the forbidden-imports contract adds `presidio_analyzer` and `spacy`.
- Tests:
  - `tests/support/fakes.py`;
  - `tests/unit/{test_sensitivity,test_overlap,test_analyze_text}.py` (T015–T017);
  - `tests/api/{test_analyze,test_limits,test_errors,test_openapi}.py` (T018–T021);
  - `tests/nlp/{conftest,test_analyze_nlp,test_latency}.py` (T022, T023);
  - `tests/conftest.py` (`create_app(FakeAnalyzer)`).
- `services/privacy/README.md`, `specs/004-privacy-service/tasks.md` (T015–T035 ticked), `docs/tasks/BACKLOG.md`.

## Decisions

- **`create_app(analyzer, default_min_score)`** replaces T009's
  `create_app(readiness, settings)`:
  - readiness comes from `analyzer.is_ready()`;
  - the default minimum score is a plain value, because `api` may not import
    `infrastructure.settings`;
  - `AnalyzeRequest.min_score` is optional (`null` = service default), so the default
    stays configurable per deployment.
- **The OpenAPI document drops FastAPI's automatic 422 response and the
  `HTTPValidationError` / `ValidationError` schemas.** The service never returns 422
  (R-10), so the gateway's Zod mirror must not model one.
- **A body FastAPI cannot read** (for example, not UTF-8) is 400 `invalid_request` with
  `field: "body"`. An HTTP 413 maps to `payload_too_large`.
- **The phone part of US1-1 is not in this PR.** It needs the Spanish phone recognizer
  (`T-004-05`, task T048), as planned in tasks.md. The DNI and CIF levels of US1-2 and
  US1-4 are covered at domain level here and end to end in `T-004-04` (T038). The
  backlog row's "phone detected" acceptance therefore moves to `T-004-05`.
- **Overlap order is total.** After score, specificity and length, the earlier start
  wins, so results do not depend on Presidio's output order (property-tested).
- **Presidio 2.2.366** (Data Privacy Stack) and spaCy 3.8.18 both ship `py.typed`, so no
  mypy overrides were needed (R-04's fallback was not used).
- **The latency test bound is unchanged:** p95 32.7 ms locally against a 200 ms budget.

## How it was verified

Locally (Windows, Python 3.12.13 via uv):

```bash
cd services/privacy
uv run ruff check . && uv run ruff format --check .   # All checks passed; formatted
uv run mypy                                           # Success: no issues found in 40 source files
uv run lint-imports                                   # Contracts: 2 kept, 0 broken.
uv run pytest                                         # 78 passed, 1 warning
uv run pytest -m nlp -s                               # 8 passed; /analyze 2000 chars: p50 24.2 ms, p95 32.7 ms
uv run python scripts/export_openapi.py --check       # openapi.json is up to date
```

Manual run with `uv run python -m privacy.main`:
- the model was ready in about 1 s;
- `/health` → 200;
- `/analyze` on "Soy Lucía Fernández, vivo en Sevilla, correo lucia@example.com" →
  `PERSON` 4–19, `LOCATION` 29–36, `EMAIL` 45–62, level `high`;
- the log line had `text_length`, `counts`, `level` and `endpoint: /analyze` only;
- `{"text": "Pedido 12345678", "extra": 1}` → 400 with `field: "extra"`.

CI also builds the image (with the model) and runs the `nlp` suite; the PR log has the
numbers.

## Pending / follow-ups

- `T-004-04` / `T-004-05` add the six Spanish recognizers. The adapter already maps their
  entity names, and `KIND_TO_PRESIDIO` only asks Presidio for entities it supports.
- No new backlog rows.

## Pitfalls for the next session

- **Git Bash's `curl -d` sends non-ASCII as cp1252 on this machine.** Use `í`-style
  escapes in JSON for manual calls, or the service answers 400 `Body could not be
  read`.
- **Long Bash heredocs with many quotes fail to parse in this environment.** Write files
  with the Write tool instead.
- **`app.openapi` is overridden in `api/openapi.py`.** After changing any schema or
  route, run `scripts/export_openapi.py`, or `test_openapi.py` fails.
- **The `nlp` fixtures are session-scoped** (`tests/nlp/conftest.py`): the model loads
  once, in about 1 s once cached.

## Links

- Spec / plan / tasks: `specs/004-privacy-service/`
- ADRs: none added
- Related task records: `docs/tasks/done/T-004-02-privacy-skeleton.md`
