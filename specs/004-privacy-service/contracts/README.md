# Contracts (review projection)

The source of truth will be the Pydantic models in
`services/privacy/src/privacy/api/schemas.py` and the OpenAPI document exported from them
to `services/privacy/openapi.json` (`T-004-03`), which the gateway mirrors in Zod
(`T-005-03`). The files here are design-time projections for reviewing this feature
before the code exists; they are not shipped or imported.

- `http.md`: the endpoints `POST /analyze`, `POST /anonymize` and `GET /health`, the
  error envelope and statuses, and the limits.
- `analyze.example.json` and `anonymize.example.json`: one request/response pair each,
  over the same synthetic text. Offsets are correct and the identifiers pass their
  checks (the DNI letter, for example).
- `corpus.example.jsonl`: the meta line and three cases in the corpus format of
  `T-004-07` (one positive, two hard negatives).

All personal data in these files is invented.
