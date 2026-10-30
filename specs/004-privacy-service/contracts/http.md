# HTTP contract: privacy service

Base URL inside the stack: `http://privacy:8001` (Docker Compose), `http://localhost:8001`
locally. JSON in and out, UTF-8. There is no authentication: the service listens on the
internal network only (spec, Assumptions). Character offsets are positions in the
request text as a sequence of Unicode code points (Python `str` indices). JavaScript
strings index by UTF-16 code unit, so the gateway converts them (`T-005-03`) whenever
the text has characters outside the Basic Multilingual Plane (emoji, for example).

## `POST /analyze`

Request (`AnalyzeRequest`, unknown fields rejected):

| Field | Type | Default | Notes |
|---|---|---|---|
| `text` | string | required | may be empty |
| `language` | `"es"` | `"es"` | the only supported value in this feature |
| `min_score` | number 0–1 | `0.5` | findings below are dropped before the level is computed |
| `entities` | array of `EntityKind` | all | restricts the kinds reported; empty array → 400 |

`EntityKind`: `DNI`, `NIE`, `CIF`, `IBAN`, `NSS`, `PHONE`, `EMAIL`, `CREDIT_CARD`,
`PERSON`, `LOCATION`.

Response 200 (`AnalyzeResponse`):

| Field | Type | Notes |
|---|---|---|
| `findings` | array of `{kind, start, end, score}` | sorted by `start`, non-overlapping; `end` exclusive; no values |
| `counts` | object `EntityKind → integer` | only kinds with at least one finding |
| `sensitivity_level` | `none` \| `low` \| `high` \| `critical` | highest level among findings |

Level per kind: `critical` for `DNI`, `NIE`, `NSS`, `IBAN`, `CREDIT_CARD`; `high` for
`PERSON`, `PHONE`, `EMAIL`; `low` for `CIF`, `LOCATION`.

Example: [`analyze.example.json`](analyze.example.json).

## `POST /anonymize`

Request: `AnonymizeRequest`, the same fields as `AnalyzeRequest`.

Response 200 (`AnonymizeResponse`):

| Field | Type | Notes |
|---|---|---|
| `text` | string | every finding replaced by `<KIND_n>` |
| `mapping` | array of `{placeholder, kind, value}` | order of first appearance; the only place original values appear |
| `analysis` | `AnalyzeResponse` | findings and level **of the original text** (offsets refer to the request text) |

Rules:

- numbering is per kind, from 1, in order of first appearance;
- the same `(kind, value)` reuses its placeholder; a different value of the same kind
  gets the next number. In the example, `Lucía Fernández Ruiz` and the later `Lucía` are
  different values, so they are `<PERSON_1>` and `<PERSON_2>`;
- if the input already contains `<DNI_3>`, new `DNI` placeholders start at `<DNI_4>`;
- restoring = replacing each `placeholder` in the text by its `value`; the result equals
  the request text exactly. The service has no restore endpoint.

Example: [`anonymize.example.json`](anonymize.example.json).

## `GET /health`

| State | Status | Body |
|---|---|---|
| model and recognizers loaded | 200 | `{"status": "ok", "ready": true, "version": "0.1.0"}` |
| not ready | 503 | error envelope, `type: "not_ready"` |

## Errors

Envelope (same vocabulary as the gateway's 001 envelope):

```json
{ "error": { "type": "invalid_request", "message": "Field required", "field": "text" } }
```

| Situation | Status | `type` | Notes |
|---|---|---|---|
| Not JSON, missing or wrong-typed field, unknown field, `language` other than `es`, `min_score` out of range, empty `entities` | 400 | `invalid_request` | `field` = dotted path of the first problem; the message never contains the value |
| Body larger than 1 MiB | 413 | `payload_too_large` | refused before parsing |
| Model not loaded | 503 | `not_ready` | |
| Unexpected | 500 | `internal_error` | generic message; details only in the log, without input |

## Logging (observable contract)

One JSON line per request with `request_id` (the `x-request-id` request header, or a
generated one; echoed in the response header), `endpoint`, `status`, `duration_ms`,
`text_length`, `counts`, `level`, `error_type`. Never the text, values or mapping.
