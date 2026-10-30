# Quickstart: verifying the Privacy Service

**Feature**: `004-privacy-service` · **Date**: 2026-10-30

How a reviewer proves the feature works once `T-004-02` … `T-004-07` are merged. Each
step names the spec scenarios it demonstrates. Commands run from `services/privacy`
unless stated otherwise.

## Prerequisites

- [uv](https://docs.astral.sh/uv/) (it installs Python 3.12 from `.python-version`).
- About 1 GB of disk for the environment (the Spanish model is ~550 MB).
- For section 6: Docker.

```bash
uv sync
```

## 1. Quality gates (FR-002, FR-003)

```bash
uv run ruff check .
uv run ruff format --check .
uv run mypy .
uv run lint-imports
```

Expected: all exit 0; `lint-imports` reports both contracts (layers, forbidden imports)
kept.

## 2. Tests without the model (US1–US3, US5, US6 logic)

```bash
uv run pytest -m "not nlp and not metrics"
```

Expected: domain, recognizer, application and API suites pass in seconds, including the
checksum property tests against `python-stdnum`, the anonymize → restore property test,
the OpenAPI drift check and the log-leak check.

## 3. Tests with the model (US1, US2, SC-004)

```bash
uv run pytest -m nlp
```

Expected: person, location, email and phone detected in Spanish sentences; the latency
test prints the p95 for a 2 000-character text (< 200 ms).

## 4. Detection metrics (US4, SC-001 … SC-003)

```bash
uv run pytest -m metrics
cat reports/detection-metrics.json
```

Expected: a per-kind table with precision, recall and support; every structured kind ≥
0.95 on both; `PERSON` recall ≥ 0.80; round trip exact on every case. To see the gate
work, break a recognizer locally (for example, change the DNI letter table) and run
again: the test fails naming `DNI` and the metric.

Regenerating the corpus gives the same file (seeded):

```bash
uv run python scripts/generate_corpus.py --check
```

## 5. Run the service and call it (US1, US3, US5)

```bash
uv run python -m privacy.main
```

In another terminal (the example bodies are in `specs/004-privacy-service/contracts/`):

```bash
curl -s localhost:8001/health
```

```bash
curl -s localhost:8001/analyze -H 'content-type: application/json' -d '{"text": "Soy Lucía Fernández, DNI 12345678Z"}'
```

```bash
curl -s localhost:8001/anonymize -H 'content-type: application/json' -d '{"text": "Soy Lucía Fernández, DNI 12345678Z"}'
```

```bash
curl -s localhost:8001/analyze -H 'content-type: application/json' -d '{"text": "Pedido 12345678", "extra": 1}'
```

Expected: health `ready: true`; analyze lists `PERSON` and `DNI` with level `critical`
and no values; anonymize returns `Soy <PERSON_1>, DNI <DNI_1>` and the mapping; the last
call is a 400 `invalid_request` with `field: "extra"`. The service's log lines show
counts and levels, never the names or the DNI.

## 6. Container (FR-003, US5-5)

From the repository root:

```bash
docker build -t tamiz-privacy services/privacy
docker run --rm -p 8001:8001 tamiz-privacy
```

Expected: the image builds; `docker inspect` shows a non-root user; `/health` answers
200 once the model is loaded, and the container's health status turns `healthy`.

## 7. Contract for the gateway (US6)

```bash
uv run python scripts/export_openapi.py --check
```

Expected: exit 0 (committed `openapi.json` matches the code). The document lists
`/analyze`, `/anonymize`, `/health`, and `EntityKind` and `SensitivityLevel` as named
enums.
