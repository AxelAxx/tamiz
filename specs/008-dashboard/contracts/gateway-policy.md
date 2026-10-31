# HTTP contract: policy admin endpoints (gateway)

New in feature 008 (`T-008-08`). Both live under `/v1/admin/*`, so they need
`Authorization: Bearer <key>` with role `admin`: no or invalid key → `401 unauthorized`,
a `client` key → `403 forbidden` (feature 006). Schemas: `data-model.md` §1.2.

## `GET /v1/admin/policy`

200: `ActivePolicy`:

```json
{
  "policy": { "id": "default", "version": 5, "targets": ["…"], "rules": ["…"], "default": {}, "privacy": {} },
  "meta": {
    "source": "store",
    "savedAt": "2026-11-03T10:15:00.000Z",
    "savedBy": "dashboard",
    "contentHash": "4f2c…64 hex…",
    "persistent": true
  }
}
```

A policy loaded from the file at boot has `source: "file"`, `savedAt: null`,
`savedBy: null`. `persistent` is `true` when `DATABASE_URL` is configured.

## `PUT /v1/admin/policy`

Body: `ReplacePolicyRequest`, `{ "baseVersion": 5, "policy": { … } }`. Example:
[`replace-policy.example.json`](replace-policy.example.json).

Order of checks (research R-10); the first failing step answers:

| Step | Failure | Answer |
|---|---|---|
| body shape (`ReplacePolicyRequestSchema`, which includes `RoutingPolicySchema`) | any issue | `400 invalid_request`, `issues` with paths under `policy.` |
| `policy.id` equals the active id | different | `400 invalid_request`, issue `policy.id` |
| cross-field rules (`validatePolicy`) | any issue | `400 invalid_request`, `issues` |
| every provider the policy uses is configured on this gateway | missing | `400 invalid_request`, issue `policy.targets.<i>.provider` |
| active version equals `baseVersion` | stale | `409 conflict`, message names the active version |

On success: `200` with the new `ActivePolicy` (`version = baseVersion + 1`,
`source: "store"`, `savedBy` = the admin client id). The `version` in the body is ignored.
The new policy applies to every request and simulation that starts after the answer.

Error example (`400`):

```json
{
  "error": {
    "type": "invalid_request",
    "message": "policy: 2 issues",
    "requestId": "0b7e…",
    "issues": [
      { "path": "policy.rules.2.route.0", "message": "unknown target 'mistral-large'" },
      { "path": "policy.privacy.localRoute.0", "message": "expected a target with residency local" }
    ]
  }
}
```

Issue messages name paths and ids, never secrets. Every save logs one line
`policy.replaced` with `policyId`, `version`, `clientId` and `contentHash`; never the
document.

## OpenAPI

Both routes are declared with `createRoute`; `ActivePolicy` and `ReplacePolicyRequest` are
named components in `/openapi.json`.
