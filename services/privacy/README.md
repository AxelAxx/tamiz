# services/privacy

The privacy service: a Python 3.12 FastAPI application (managed with uv) that detects
personal data in Spanish text and anonymizes it reversibly. It wraps Presidio Analyzer and
spaCy's Spanish model, with its own recognizers for Spanish identifiers (DNI, NIE, CIF,
IBAN, phone numbers, social security numbers). It exposes `/analyze` (entities and a
sensitivity level) and `/anonymize` (`<DNI_1>`-style placeholders; the map is returned,
never stored). Its OpenAPI contract is consumed by the gateway. Spec:
[`specs/004-privacy-service`](../../specs/004-privacy-service/spec.md).

Test corpora under `tests/` are synthetic **Spanish** text by design (ADR-0002).

## Status

`T-004-02` (skeleton) is done: the layers, the quality gates, `GET /health`, JSON logging
with an allow-list, the error envelope and the container image. `/analyze` arrives in
`T-004-03` and `/anonymize` in `T-004-06`.

## Layers

`src/privacy/` mirrors the gateway (constitution I). `import-linter` enforces it:

| Layer | Holds | May import |
|---|---|---|
| `domain/` | entity kinds, findings, sensitivity, placeholders, check digits | standard library only |
| `application/` | use cases and the analyzer port | `domain` |
| `infrastructure/` | Presidio adapter, recognizers, settings | `application`, `domain` |
| `api/` | FastAPI app, Pydantic contract, errors, logging | `application`, `domain` |
| `main.py` | composition root | everything |

## Commands

Run from `services/privacy`; uv installs Python 3.12 from `.python-version`.

```bash
uv sync                       # environment from uv.lock
uv run ruff check .           # lint
uv run ruff format --check .  # formatting
uv run mypy                   # strict typing (src and tests)
uv run lint-imports           # layering
uv run pytest                 # tests; -m nlp / -m metrics select the model-backed suites (T-004-03+)
uv run python -m privacy.main # serve on PRIVACY_HOST:PRIVACY_PORT (default 0.0.0.0:8001)
```

Container, from the repository root:

```bash
docker build -t tamiz-privacy services/privacy
docker run --rm -p 8001:8001 tamiz-privacy
```

The image runs as the non-root user `privacy` (uid 10001), and its health check calls
`/health`.

## Configuration

| Variable | Default | Notes |
|---|---|---|
| `PRIVACY_HOST` | `0.0.0.0` | bind address; reach the service on the internal network only (no authentication) |
| `PRIVACY_PORT` | `8001` | 1–65535 |
| `PRIVACY_LOG_LEVEL` | `info` | `debug`, `info`, `warning`, `error` |
| `PRIVACY_DEFAULT_MIN_SCORE` | `0.5` | 0–1; default minimum score of findings (T-004-03) |
| `PRIVACY_SPACY_MODEL` | `es_core_news_lg` | (T-004-03) |

An invalid value stops the process with exit code 1, naming the variable but never its
value.

## Logging

There is one JSON line per request, with only these fields:
- `request_id`: the `x-request-id` header when it is a safe token, otherwise generated; it
  is echoed in the response;
- `endpoint`: the route template, never the raw path;
- `status`, `duration_ms`, `error_type`;
- `text_length`, `counts`, `level` (from `T-004-03` on).

Request text, detected values, anonymization maps, exception messages and source lines
are never logged.
