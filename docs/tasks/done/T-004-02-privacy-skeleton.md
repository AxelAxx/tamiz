# T-004-02 — Privacy service skeleton

| Field | Value |
|---|---|
| Task | `T-004-02` (see `docs/tasks/BACKLOG.md`) |
| Feature | `004-privacy-service` |
| Spec | `specs/004-privacy-service/spec.md` (FR-001 … FR-003, FR-021; US5-1, US5-5); `tasks.md` Phase 1 (T001–T014); `research.md` R-01, R-05, R-06, R-09 … R-11 |
| Branch / PR | `T-004-02-privacy-skeleton` / PR opened after this commit |
| Date | 2026-10-30 |
| Session | Claude Code (Claude Opus 5.5), side session (merge authority delegated by Alex) |
| Status | done |

## What was done

`services/privacy` is now a uv project (`tamiz-privacy` 0.1.0, Python 3.12, package
`privacy`, built with `uv_build`). It has the four layers and the composition root
`main.py`. It provides:

- `GET /health`: 200 when ready, 503 `not_ready` when not (FR-001, US5-5);
- one allow-listed JSON log line per request (FR-021, US5-1);
- the error envelope `{"error": {type, message, field}}`;
- a multi-stage, non-root image (FR-003).

Ruff, strict mypy, import-linter and pytest pass. All of them, plus `docker build`, now
run as steps of the single required `ci` job (FR-002, FR-003, research R-06).

## Files touched

- `services/privacy/pyproject.toml`, `uv.lock`, `.python-version`:
  - dependencies;
  - Ruff (`E F I B UP SIM RUF S PT`), mypy strict with `disallow_any_explicit` for
    `privacy.*`;
  - pytest markers `nlp` and `metrics`;
  - import-linter contracts (layers, forbidden libraries in domain and application)
  - (T001).
- `services/privacy/src/privacy/{domain,application,infrastructure,api}/__init__.py`, `py.typed` (T002).
- `src/privacy/infrastructure/settings.py`: `PRIVACY_*` settings, exit 1 naming variables only (T006).
- `src/privacy/api/logging.py`: `JsonFormatter` (allow-list; exceptions as type + file:line:function frames), `RequestLogMiddleware` (pure ASGI), `configure_logging` (T007).
- `src/privacy/api/errors.py`, `api/schemas.py`: envelope and handlers (T008).
- `src/privacy/api/app.py`, `src/privacy/main.py`: `create_app(readiness)`, server start (T009).
- Tests:
  - `services/privacy/tests/conftest.py`, `tests/support/logs.py` (T010);
  - `tests/api/test_health.py` (T003);
  - `tests/api/test_logging.py` (T004);
  - `tests/unit/test_settings.py` (T005).
- `services/privacy/Dockerfile`, `.dockerignore` (T011).
- `.github/workflows/ci.yml`: Python steps and the 25-minute timeout. `biome.json`
  ignores `services/privacy`; `.gitignore` adds the coverage files and reports (T012).
- `services/privacy/README.md` (T013), `CLAUDE.md` section 12 (privacy commands).
- `specs/004-privacy-service/tasks.md`: T001–T014 ticked.
- `docs/tasks/BACKLOG.md`: `T-004-02` → `done`.

## Decisions

- **`create_app(readiness)` takes no `Settings`** (tasks.md T009 said
  `create_app(readiness, settings)`). `Settings` lives in `infrastructure`, and the
  import-linter layers contract keeps `api` and `infrastructure` independent. From
  `T-004-03` on, `main.py` passes plain values (the analyzer, the default minimum
  score) instead.
- **The log's `endpoint` is the matched route template, or `unmatched`, never the raw
  path.** A path such as `/patients/12345678Z` would otherwise reach the logs. A test
  covers it.
- **Stack traces in logs are `file:line in function` only.** Python's
  `traceback.format_list` includes source lines, and a source line can contain literal
  data. Exception messages are never logged.
- **`x-request-id` is accepted only as a safe token** (`[A-Za-z0-9._-]{1,64}`).
  Anything else is replaced by a generated id, so a client cannot put personal data
  into the logs through the header.
- **A fifth error type, `not_found`,** was added for unknown routes (data-model §4
  listed four). Other 4xx `HTTPException`s map to `invalid_request` and 5xx to
  `internal_error`.
- **Readiness is constant `True` until `T-004-03`.** There is no model yet; the
  readiness callable is the seam the analyzer will fill.
- **Tests use `--import-mode=importlib` with `pythonpath = ["."]`,** so helpers are
  imported as `tests.support.*`. Relative imports from `conftest` do not work in that
  mode.
- **`mypy` reads `files = ["src", "tests"]`** from `pyproject.toml`. `uv run mypy` and
  `uv run mypy .` both work. CI runs the former.
- **Dependency versions are the newest at lock time:** FastAPI ≥ 0.120, uvicorn 0.54,
  pydantic-settings, and `setup-uv` v10.3.3 pinned by SHA. The base image is
  `python:3.12-slim-bookworm` with uv 0.11.21 copied in.

## How it was verified

Locally (Windows, uv 0.11.21; Python 3.12.13 installed by uv):

```bash
cd services/privacy
uv run ruff check .            # All checks passed!
uv run ruff format --check .   # 19 files already formatted
uv run mypy                    # Success: no issues found in 18 source files
uv run lint-imports            # Contracts: 2 kept, 0 broken.
uv run pytest                  # 13 passed, 1 warning
```

- Manual run: `PRIVACY_PORT=8011 uv run python -m privacy.main`.
  - `/health` → 200 with `x-request-id: smoke-1` echoed.
  - `/nope` → 404 `not_found`.
  - Every log line was JSON.
  - `PRIVACY_PORT=abc` → `invalid environment: PRIVACY_PORT`, exit 1.
- Root gates unchanged: `pnpm lint` green (Biome now ignores `services/privacy`).
- `docker build`: the Docker engine is not running on this machine, so the build is
  verified in CI (PR log).

## Pending / follow-ups

- The one pytest warning comes from Starlette: it deprecates `httpx` in its test client
  and suggests `httpx2`. It is harmless for now. Revisit when FastAPI's `TestClient`
  switches.
- `T-004-03` adds Presidio, the model (as a locked wheel), `/analyze`, the body limit and
  validation errors. It also extends the forbidden-imports contract with
  `presidio_analyzer` and `spacy` once they are installed.
- No new backlog rows.

## Pitfalls for the next session

- **The `httpx` logger writes the full request URL at INFO.** The `log_capture` fixture
  sets it to WARNING, because it is the test client's logging, not the service's.
- **`TestClient(app, raise_server_exceptions=False)` is required** to observe the 500
  envelope.
- **pytest's own log capture formats records with their messages.** A failing test's
  "captured log" section can therefore show test data; production uses only
  `JsonFormatter`.
- **Docker Desktop is not running here.** Read the CI log for the `docker build` step.

## Links

- Spec / plan / tasks: `specs/004-privacy-service/{spec,plan,tasks,research}.md`
- ADRs: none added
- Related task records: `docs/tasks/done/T-004-01-spec-plan-tasks-004.md`, `docs/tasks/done/T-001-05-architecture-and-ci.md` (single `ci` check)
