# HTTP contract: admin API

All endpoints live under `/v1/admin/*`. They require `Authorization: Bearer <key>` with
role `admin`:

| Key | Answer |
|---|---|
| none or invalid | `401 unauthorized` |
| `client` role | `403 forbidden` (new error type) |

Admin keys come from `TAMIZ_ADMIN_API_KEYS` (format `client:sha256hex,…`, like
`TAMIZ_API_KEYS`) or from the `api_keys` table with `role = 'admin'`.

## `GET /v1/admin/audit`

Query string (all optional):

| Field | Type | Notes |
|---|---|---|
| `from`, `to` | ISO date-time | `from` inclusive, `to` exclusive, on `startedAt` |
| `route` | target id | the answering (or last failed) target |
| `rule` | rule id | |
| `sensitivity` | `unknown`/`none`/`low`/`high`/`critical` | |
| `action` | `allow`/`anonymize`/`restrict_to_local`/`block` | |
| `entity` | entity kind | entries where that kind was detected |
| `outcome` | `answered`/`failed`/`blocked`/`cancelled` | |
| `cursor` | opaque string | from the previous page |
| `limit` | 1–200 | default 50 |

200: `{ "entries": AuditEntry[], "nextCursor": string | null }`. Entries are newest first.
An entry is shaped as [`audit-entry.example.json`](audit-entry.example.json); it has no
content field.

400 `invalid_request`: an unknown filter value, `limit` out of range, or a malformed
cursor.

## `GET /v1/admin/cost`

Query: `from` and `to` (required), `groupBy` = `day` (default), `route` or `model`.

200: `CostReport`, see [`cost-report.example.json`](cost-report.example.json):
- `baseline`: the most expensive target of the active policy, with its prices, or `null`;
- `rows`: per group, `requests`, `inputTokens`, `outputTokens`, `costUsd`,
  `baselineCostUsd`;
- `notServed`: blocked and failed counts;
- `totals`.

Days are UTC.

## `GET /v1/admin/providers`

Query: `windowMinutes` (1–1440, default 15).

200: `{ "windowMinutes", "generatedAt", "targets": ProviderHealth[] }`. Every declared
target is listed, and each has:
- `circuit` (`closed`, `open` or `half_open`) and `cooldownRemainingMs` when open;
- `window`: `requests`, `errors`, `errorRate`, `latencyP50Ms`, `latencyP95Ms` (`null`
  without traffic).

## Environment (gateway)

| Variable | Default | Notes |
|---|---|---|
| `DATABASE_URL` | unset | `postgres://…`; unset = in-memory audit log (bounded) |
| `TAMIZ_AUDIT_HASH_KEY` | required with `DATABASE_URL` | at least 32 characters; keys the message hash |
| `TAMIZ_AUDIT_MEMORY_ENTRIES` | `10000` | size of the in-memory log |
| `TAMIZ_ADMIN_API_KEYS` | unset | admin keys, hashed |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | unset | for example `http://localhost:4318`; unset = tracing off |
| `OTEL_SERVICE_NAME` | `tamiz-gateway` | |
