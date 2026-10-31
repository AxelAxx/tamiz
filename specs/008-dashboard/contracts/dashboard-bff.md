# HTTP contract: dashboard endpoints (BFF)

The browser calls only these endpoints, on the dashboard's own origin (research R-01).
Every endpoint except `POST /api/session` and `GET /api/health` needs a valid session
cookie; without one it answers `401 { error: { type: "unauthenticated" } }` and calls
nothing. Every non-GET endpoint checks `Origin` first (research R-04) and answers
`403 forbidden_origin` on a mismatch.

Errors use `BffErrorSchema` (`data-model.md` §1.3).

| Endpoint | Body / query | Calls | 200 answer |
|---|---|---|---|
| `POST /api/session` | `{ passphrase }` | — | `{ ok: true }` + `Set-Cookie: tamiz_session` |
| `DELETE /api/session` | — | — | `{ ok: true }`, cookie cleared, session deleted |
| `GET /api/health` | — | — | `{ status: "ok" }` (the dashboard only; container healthcheck) |
| `GET /api/gateway-health` | — | `GET /health` | `HealthResponse` |
| `GET /api/audit` | `AuditQuery` (query string) | `GET /v1/admin/audit` | `AuditPage` |
| `GET /api/cost` | `CostQuery` | `GET /v1/admin/cost` | `CostReport` |
| `GET /api/providers` | `ProvidersQuery` | `GET /v1/admin/providers` | `ProvidersReport` |
| `POST /api/simulate` | `ChatCompletionRequest` (`stream` dropped) | `POST /v1/simulate` | `SimulateResponse` |
| `GET /api/policy` | — | `GET /v1/admin/policy` | `ActivePolicy` |
| `PUT /api/policy` | `ReplacePolicyRequest` | `PUT /v1/admin/policy` | `ActivePolicy` |
| `GET /api/evals` | — | reads `TAMIZ_DASHBOARD_EVALS_DIR` | `EvalsList` |

Rules for every handler:

- the request is validated with the same contract schema the gateway uses, so a bad request
  is refused before the gateway is called (`400`, issues with paths);
- the gateway is called with `Authorization: Bearer ${TAMIZ_DASHBOARD_ADMIN_KEY}` and a
  10-second timeout (`gateway_unreachable` on timeout or network error);
- a gateway error envelope is passed through with its status as `type: "gateway"` and
  `gatewayError`; a gateway `401`/`403` becomes `502 gateway_credentials` (the operator's
  session is fine, the dashboard's key is not);
- the answer is parsed with the contract schema; failure → `502 contract` with issue paths;
- no request or response body is logged; one line per call with endpoint, status, duration
  and the gateway's `x-request-id`;
- responses carry `Cache-Control: no-store`.

`POST /api/session` failures: wrong passphrase → `401 { error: { type: "unauthenticated",
message: "Wrong passphrase" } }`; rate limited → `429` with `Retry-After`.

## Environment

See `data-model.md` §3.3. `.env.example` of the dashboard documents each variable;
`pnpm --filter @tamiz/dashboard hash-passphrase` prints a value for
`TAMIZ_DASHBOARD_PASSPHRASE_HASH` (it reads the passphrase from standard input, never from
an argument).
