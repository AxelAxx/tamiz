# services/privacy

The privacy service: a Python 3.12 FastAPI application (managed with uv) that wraps
Presidio Analyzer and Anonymizer with spaCy's Spanish model and custom recognizers for
Spanish identifiers (DNI, NIE, CIF, IBAN, phone numbers, social security numbers). It
exposes `/analyze` (entities + sensitivity level) and `/anonymize` (reversible
placeholders; the map is returned, never stored) with an OpenAPI contract the gateway
consumes. Same layering as the gateway: `src/privacy/{domain,application,infrastructure,api}/`.
Test corpora under `tests/` are synthetic **Spanish** text by design (ADR-0002). Created
in feature `004-privacy-service` (task `T-004-02`).
