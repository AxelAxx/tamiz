# Contracts (review projection)

The source of truth will be the Zod schemas in `packages/contracts/src/{audit,admin}.ts`
and the gateway's `GET /openapi.json`. These files are design-time projections for
reviewing the feature before the code exists.

- `http.md`: the admin endpoints (`/v1/admin/audit`, `/cost`, `/providers`), the admin
  role and the errors.
- `audit-entry.example.json`: one entry for an anonymized request answered by the EU
  target. Its `requestHash` is HMAC-SHA-256 with an example key, and its cost and baseline
  were computed from the default policy's prices.
- `cost-report.example.json`: two days grouped by day. Every cost and baseline equals its
  tokens × the prices (mistral-small 0.1/0.3, baseline anthropic-sonnet 3/15 USD per
  million tokens).

All data is invented.
