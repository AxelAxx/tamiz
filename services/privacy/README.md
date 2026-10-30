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

Done so far:
- `T-004-02`: the skeleton, with the layers, the quality gates, `GET /health`, JSON
  logging with an allow-list, the error envelope and the container image.
- `T-004-03`: `POST /analyze` over Presidio with `es_core_news_lg`, which detects names,
  locations, emails and cards (Luhn). It also adds the sensitivity level, overlap
  resolution, the 1 MiB body limit, 400 validation errors and the exported contract
  [`openapi.json`](openapi.json).

- `T-004-04`: DNI, NIE and CIF, validated by their check characters.

Still to come: IBAN, phone and NSS in `T-004-05`, and `/anonymize` in `T-004-06`.

## Recognizers

| Kind | Source | Accepted only when |
|---|---|---|
| `PERSON`, `LOCATION` | spaCy `es_core_news_lg` (via Presidio) | the model tags `PER` / `LOC` (score 0.85) |
| `EMAIL` | Presidio `EmailRecognizer` | the address and its domain are well formed |
| `CREDIT_CARD` | Presidio `CreditCardRecognizer` | Luhn passes |
| `DNI` | own (`recognizers/identity.py`) | the letter is `TRWAGMYFPDXBNJZSQVHLCKE[number mod 23]` |
| `NIE` | own | X/Y/Z → 0/1/2, then the DNI rule |
| `CIF` | own | the control digit or letter matches; A, B, E, H need a digit; P, Q, R, S, N, W need a letter |

Own recognizers accept upper or lower case and the usual separators (`12.345.678-Z`,
`X-1234567-L`, `B-12345674`). Validated candidates score 1.0; invalid ones are dropped.
The check-character rules live in `domain/checksums.py`, and the tests use `python-stdnum`
as an oracle.

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
uv run pytest                 # every test, including the real-model ones
uv run pytest -m "not nlp"    # without loading the language model (seconds)
uv run python scripts/export_openapi.py [--check]   # write or check openapi.json
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
| `PRIVACY_DEFAULT_MIN_SCORE` | `0.5` | 0–1; used when a request omits `min_score` |
| `PRIVACY_SPACY_MODEL` | `es_core_news_lg` | the model is installed as a locked wheel by `uv sync` |

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
