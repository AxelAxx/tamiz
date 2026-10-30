# Quickstart: verifying Audit and Telemetry

**Feature**: `006-audit-and-telemetry` · **Date**: 2026-10-30

How a reviewer proves the feature works once `T-006-02` … `T-006-06` are merged.

## Prerequisites

- Features 002–005 and their quickstarts.
- Docker, for `postgres` and `jaeger` (`docker compose up postgres jaeger privacy`).

## 1. Suites (US1, US5, SC-001 … SC-003)

```bash
pnpm --filter @tamiz/gateway test -- audit telemetry admin no-leak
```

Expected: exactly one entry per request for every outcome; the no-content capture over
logs, events, entries and spans is clean; the in-memory span exporter shows the request
and attempt spans with the `gen_ai.*` attributes.

## 2. PostgreSQL (US2, SC-004, SC-005)

```bash
pnpm --filter @tamiz/gateway test -- persistence
```

Expected (CI, or locally with Docker): migrations run from empty; the filters and the
keyset pages are correct; a page over 100 000 rows takes under 200 ms; the aggregates equal
the sums.

## 3. End to end

```bash
docker compose up -d postgres jaeger privacy
export DATABASE_URL=postgres://tamiz:tamiz@localhost:5432/tamiz
export TAMIZ_AUDIT_HASH_KEY=$(openssl rand -hex 32)
export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
pnpm --filter @tamiz/gateway api-key:add ops --admin
pnpm --filter @tamiz/gateway dev
```

Send a request with a DNI and one with a name (see the feature 005 quickstart). Then:

```bash
curl -s "localhost:3000/v1/admin/audit?entity=DNI" -H "authorization: Bearer $ADMIN_KEY"
curl -s "localhost:3000/v1/admin/cost?from=2026-10-01T00:00:00Z&to=2026-12-01T00:00:00Z" -H "authorization: Bearer $ADMIN_KEY"
curl -s "localhost:3000/v1/admin/providers" -H "authorization: Bearer $ADMIN_KEY"
```

Expected:
- **Audit:** the DNI request appears with `sensitivity: critical`,
  `privacyAction: restrict_to_local`, `entities: {"DNI": 1}` and no text.
- **Cost:** the cost report shows a baseline above the actual cost.
- **Providers:** every target is listed.
- **Jaeger** (http://localhost:16686, service `tamiz-gateway`): the trace has
  `tamiz.request` → `chat llama3.1:8b`, the `gen_ai.*` attributes and a
  `routing.decision` event.
- **Client key:** a client key on `/v1/admin/audit` gets `403`.
