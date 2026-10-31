# Data Model: Dashboard

**Feature**: `008-dashboard` · **Date**: 2026-10-31

The dashboard stores nothing of its own except operator sessions (in memory) and reads eval
reports from files. Everything else is a contract that already exists in
`packages/contracts` or is added here for the policy editor.

## 1. Contracts (`packages/contracts/src`)

### 1.1 Existing, read as they are

| Schema | Module | Screen |
|---|---|---|
| `AuditQuerySchema`, `AuditPageSchema`, `AuditEntrySchema` | `admin.ts`, `audit.ts` | live traffic, audit log, entry detail |
| `SimulateResponseSchema`, `ChatMessageSchema` | `simulate.ts`, `chat-completion.ts` | simulator |
| `CostQuerySchema`, `CostReportSchema` | `admin.ts` | cost analytics |
| `ProvidersQuerySchema`, `ProvidersReportSchema` | `admin.ts` | provider health |
| `EvalReportSchema` | `evals.ts` | evals |
| `RoutingPolicySchema` | `routing-policy.ts` | policy editor (shape check in the browser) |
| `HealthResponseSchema` | `health.ts` | gateway status in the header |

### 1.2 Added (`T-008-08` unless noted)

`error.ts`:

| Change | Shape |
|---|---|
| `ErrorTypeSchema` + `conflict` | `errorTypeToHttpStatus.conflict = 409` |
| `ErrorEnvelopeSchema.error.issues` (optional) | `Array<{ path: string; message: string }>`, `path` in dot form, `""` for the root |

`policy-admin.ts` (new):

```ts
PolicySourceSchema = z.enum(["file", "store"]);

PolicyVersionMetaSchema = z.strictObject({
  source: PolicySourceSchema,
  savedAt: z.iso.datetime().nullable(),   // null for the boot file
  savedBy: z.string().nullable(),         // admin client id; null for the boot file
  contentHash: z.string().regex(/^[0-9a-f]{64}$/), // SHA-256 of the canonical JSON
  persistent: z.boolean(),                // false: saves are lost on restart
});

ActivePolicySchema = z.strictObject({
  policy: RoutingPolicySchema,
  meta: PolicyVersionMetaSchema,
});

ReplacePolicyRequestSchema = z.strictObject({
  baseVersion: z.int().min(1),
  policy: RoutingPolicySchema,            // its `version` is ignored and replaced
});
// 200 answer: ActivePolicySchema
```

`chat-completion.ts` (`T-008-04`): export `MAX_BODY_BYTES = 1_048_576` (moved from the
gateway's `app.ts`, which then imports it), so the simulator's form enforces the same limit.

### 1.3 Dashboard-only shapes (`apps/dashboard/src/lib/schemas.ts`)

Not shared contracts: they describe the dashboard's own BFF answers.

```ts
EvalsListSchema = z.strictObject({
  reports: z.array(z.strictObject({ file: z.string(), report: EvalReportSchema })),
  unreadable: z.array(z.strictObject({ file: z.string(), issue: z.string() })),
});

BffErrorSchema = z.strictObject({
  error: z.strictObject({
    type: z.enum([
      "unauthenticated",      // no or expired session (401)
      "forbidden_origin",     // cross-origin write (403)
      "gateway_credentials",  // the gateway answered 401/403 to the dashboard (502)
      "gateway_unreachable",  // network error or timeout (504)
      "contract",             // the gateway answer failed its schema (502)
      "gateway",              // a gateway error envelope, passed through with its status
    ]),
    message: z.string(),
    gatewayError: ErrorEnvelopeSchema.shape.error.optional(),
    endpoint: z.string().optional(),
    issues: z.array(z.string()).optional(), // contract issue paths only
  }),
});
```

## 2. Gateway

### 2.1 Domain

No new model. `validatePolicy` already returns `ValidationError` with `issues` (path,
message). `PolicyVersion` is an application type:

```ts
interface PolicyVersion {
  readonly policy: RoutingPolicy;        // validated
  readonly source: "file" | "store";
  readonly savedAt: string | null;
  readonly savedBy: string | null;
  readonly contentHash: string;
  readonly persistent: boolean;
}
```

### 2.2 Application

- `PolicyRepositoryPort`:
  - `getActive(): Promise<RoutingPolicy>` (unchanged);
  - `getActiveVersion(): Promise<PolicyVersion>`;
  - `replace(next: PolicyVersion, baseVersion: number): Promise<Result<PolicyVersion, ConflictError>>`.
- `ConflictError` (`kind: "conflict"`, `activeVersion`) joins the error union; it maps to
  the `conflict` envelope.
- Use cases `GetActivePolicy` and `ReplacePolicy` (research R-10). `ReplacePolicy` takes
  `{ input, baseVersion, adminClientId }` and deps
  `{ policies, checkProviders, clock, hash, logger }`.

### 2.3 Infrastructure

- `in-memory-policy-repository.ts`: holds the active `PolicyVersion`; `replace` compares
  `baseVersion` with the active version.
- `postgres-policy-repository.ts`: table below; `replace` runs
  `insert … select … where (select max(version) …) = $baseVersion` in one transaction and
  maps a unique violation or zero inserted rows to `conflict`.

### 2.4 Table (PostgreSQL, migration `0001_policy_versions`)

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | |
| `policy_id` | `text` not null | |
| `version` | `integer` not null | unique with `policy_id` |
| `document` | `jsonb` not null | the validated policy as JSON |
| `content_hash` | `char(64)` not null | SHA-256 of the canonical JSON |
| `source` | `text` not null | `file` (recorded at boot) or `store` |
| `created_by` | `text` | admin client id; null for `file` |
| `created_at` | `timestamptz` not null | |

Append-only: rows are never updated or deleted by the gateway.

## 3. Dashboard server state

### 3.1 Operator session (in memory)

| Field | Notes |
|---|---|
| `id` | 32 random bytes, base64url; the cookie carries `id.signature` |
| `createdAt` | |
| `expiresAt` | `createdAt + 8 h`; absolute, not sliding |

Sign-out and expiry delete the entry. A periodic sweep removes expired entries.

### 3.2 Sign-in attempts (in memory)

`address → { failures: number, windowStart: number, blockedUntil?: number }`: 5 failures per
60 s window, then refused for 60 s (US1-2).

### 3.3 Configuration (`src/lib/server/env.ts`, Zod)

| Variable | Rule |
|---|---|
| `TAMIZ_GATEWAY_URL` | URL, `http` or `https` |
| `TAMIZ_DASHBOARD_ADMIN_KEY` | non-empty, no whitespace |
| `TAMIZ_DASHBOARD_PASSPHRASE_HASH` | `scrypt$<N>$<r>$<p>$<salt b64>$<hash b64>` |
| `TAMIZ_DASHBOARD_SESSION_SECRET` | ≥ 32 bytes |
| `TAMIZ_DASHBOARD_PUBLIC_URL` | URL; its origin is the allowed `Origin` |
| `TAMIZ_DASHBOARD_EVALS_DIR` | path, default `./data/evals` |
| `TAMIZ_DASHBOARD_TRUST_PROXY` | `true` \| `false`, default `false` |

## 4. Browser state

| State | Where | Lifetime |
|---|---|---|
| Theme | `localStorage` (`next-themes`) | persistent |
| Audit filters | URL search params | the address |
| Live traffic rows, pause buffer | React state | the tab |
| Simulator text and result | React state | the tab (never stored) |
| Policy draft | React state | the tab; a save after session expiry opens the sign-in dialog in place, so the draft survives (never stored) |
| Server data | TanStack Query cache | in memory, the tab |

## 5. State transitions

**Live traffic connection**: `connecting` → `live` → (`paused` ⇄ `live`) ; any failed poll →
`retrying` (backoff, keeps rows) → `live` on success.

**Policy editor**: `loading` → `clean` → (edit) `dirty-invalid` | `dirty-valid` →
(save) `saving` → `clean` (new version) | `refused` (issues listed, still dirty) |
`conflict` (reload offered) | `error`.

**Eval report** (per file): `valid` | `unreadable`; run status `pass` | `fail` | `error`
from the report; each eval `pass` | `fail` | `error` | `skipped`.
