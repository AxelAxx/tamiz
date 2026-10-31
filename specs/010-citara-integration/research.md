# Research: Citara Integration

Phase 0 of `plan.md`. Each entry: decision, rationale, alternatives. Entries marked
**(D*n*)** are the decisions flagged for Alex in `spec.md`.

## R-01 What the repository says about Citara (D1)

- **Decision**: Specify the integration from Tamiz's side only, with Citara as the named
  first consumer of a generic OpenAI-compatible integration contract.
- **Rationale**: The only statements are in `docs/tamiz-project.md` section 1 ("independent
  project; optional integration at the end: Citara sends its LLM calls through Tamiz"),
  `CLAUDE.md` section 2 ("optional and independent") and the two backlog rows. No local
  checkout of Citara exists on the maintainer's machine (`Documents/Repos` holds `tamiz`,
  `OnaHealth`, `HandTrackingTest`). The name suggests appointments ("cita" in Spanish), which
  would make health or customer data likely, but nothing confirms it, so the spec does not
  assume it.
- **Alternatives**: Infer Citara's domain from its name and write domain-specific scenarios
  (rejected: invented product details); block the task until Alex describes Citara
  (rejected: the backlog row only needs the base URL + key contract, and the maintainer
  prefers decisions with defaults over questions).

## R-02 Example language and client library (D2)

- **Decision**: TypeScript on Node 22 with the official `openai` npm package, `7.47.0`
  (`latest` on 2026-10-31, `engines.node >= 22`), pinned exactly. The guide adds `curl`.
- **Rationale**: "Nothing changes but base URL and key" is most convincing with the
  provider's own SDK, unmodified. TypeScript keeps the example inside the repository's
  lint, typecheck and test pipeline. The SDK exposes everything the example needs (checked
  in the published tarball, `core/api-promise.d.ts`, `client.d.ts`, `core/error.d.ts`):
  - `.withResponse()` on `chat.completions.create(...)` returns `{ data, response,
    request_id }`, so the raw `Response` headers are available, for streams before the
    first chunk is read;
  - `request_id` is read from `x-request-id`, which is exactly Tamiz's request id;
  - client options `baseURL`, `apiKey`, `timeout`, `maxRetries`, `fetch`;
  - `APIError` carries `status`, `headers`, `error` (the body's `error` object) and `type`
    (its `type` field: Tamiz's error type).
- **Alternatives**: `@ai-sdk/openai-compatible` (already in the repo, but hides headers
  behind provider metadata and is not what most applications use); Python `openai` (would
  add a second toolchain to the example; reconsider if D2 says Citara is Python); raw
  `fetch` only (proves less about drop-in compatibility; kept as the `curl` section).

## R-03 Client retries and timeouts

- **Decision**: The example sets `maxRetries: 0` on the SDK and implements its own rule:
  never retry `invalid_request`, `unauthorized`, `forbidden`, `policy_blocked`,
  `provider_error`, `provider_timeout`, `internal`; retry once after `retry-after` (default
  1 s, capped at 30 s) for `provider_unavailable` and `privacy_unavailable` (503) and
  `rate_limited` (429). Client timeout 70 s by default.
- **Rationale**: The SDK retries 408, 409, 429 and every 5xx twice by default
  (`shouldRetry` in `client.js`). Tamiz already retries and falls back inside the request
  deadline (60 s in `policies/default.yaml`), so SDK retries of 502/504 multiply provider
  calls and cost, and a retried 451 can never succeed. A client timeout below the deadline
  abandons requests Tamiz is still serving.
- **Alternatives**: Keep SDK defaults (rejected for the reasons above); set
  `x-should-retry` headers in the gateway (rejected: gateway change, FR-015; a candidate
  follow-up if several clients need it).

## R-04 Where the example lives

- **Decision**: New top-level folder `examples/citara-client/`, workspace package
  `@tamiz/example-citara-client` (private, never published), added to
  `pnpm-workspace.yaml` and to the root Vitest `projects`. One README paragraph per
  `CLAUDE.md` section 6.
- **Rationale**: It is not part of Tamiz (not an app it ships), so `apps/` would mislead;
  `packages/` is for shared libraries. Being a workspace package puts it under lint,
  typecheck, test and build in CI, so it cannot rot.
- **Alternatives**: A loose script under `docs/integrations/` (rejected: untested, rots);
  inside `apps/mcp-server` (rejected: unrelated).

## R-05 How the example's tests reach a gateway

- **Decision**: Two levels.
  1. **Unit**: the example's core is a function `runExample(config, deps)` with injected
     `fetch`, `sleep`, `now` and output writer; retry rules, exit codes, key redaction and
     the audit poll are tested with a fake `fetch`.
  2. **End to end**: a Vitest `globalSetup` starts the gateway's existing E2E harness
     (`pnpm --filter @tamiz/gateway e2e-gateway`, `T-008-02`) on free ports with
     `TAMIZ_E2E_PROVIDERS=scripted`, and the example runs against it over real HTTP.
- **Rationale**: The harness already has the real `createApp`, the default policy, the
  in-memory audit log, a scripted detector with synthetic markers (DNI `12345678Z`, person
  `Ana García`, phone `612345678`), detector outage and circuit controls, and an admin key.
  The only gap is that its providers throw ("no screen may call one").
- **Alternatives**: Import the gateway's `createApp` into the example's tests (rejected:
  crosses an app boundary the architecture rules do not expect); MSW against the providers
  behind a real gateway process (rejected: needs provider keys and the privacy service).

## R-06 Scripted providers in the E2E harness (FR-013)

- **Decision**: `TAMIZ_E2E_PROVIDERS=scripted` (default `none`, today's behaviour) makes
  every target answer `echo: <last user message as received>` and stream it in two deltas.
  The control server gains `GET /__e2e/provider-calls` (target id and the messages it
  received) and `POST /__e2e/provider-script` (`{ targetId, fail: "http_error" | "timeout" }`
  to make one target fail until reset).
- **Rationale**: Echoing what the provider received lets one test assert both sides of
  anonymization: the provider saw placeholders (`/__e2e/provider-calls`), the client got
  the restored values (the echoed answer passes through restoration). Failing a target
  produces the fallback of US1-6. Off by default keeps the dashboard's Playwright tests
  unchanged ("providers that throw if called" is part of their contract).
- **Alternatives**: A separate harness for the example (rejected: duplicates ~250 lines);
  always-on scripted providers (rejected: changes the dashboard harness's guarantees).
- **Note**: The harness holds synthetic messages in memory for assertions; it is test
  tooling, never built into an image, and holds only fixture markers.

## R-07 Finding the audit entry by request id (D6)

- **Decision**: No gateway change. The audit check records `startedAt` just before sending,
  then queries `GET /v1/admin/audit?from=<startedAt − 5 s>&limit=200` with the admin key,
  follows `nextCursor` up to 5 pages, and matches `requestId` client-side. It polls every
  250 ms for at most 5 s (configurable).
- **Rationale**: `AuditQuerySchema` (`packages/contracts/src/admin.ts`) filters by time,
  route, rule, sensitivity, action, entity and outcome, but not by request id or client.
  A narrow window keeps the scan small in a demo; FR-015 keeps the feature independent.
- **Alternatives**: Add `requestId` (and `clientId`) filters to the admin audit query, its
  contract and the MCP `query_audit_log` tool. Better for real operations; proposed to Alex
  as an optional backlog row, not added by this task.

## R-08 Model aliases and policy (D4)

- **Decision**: The guide documents the three aliases of the default policy: `tamiz-auto`
  (no rule pins it; task classification and the privacy section decide), `tamiz-local`
  (`pinned-local`, local residency only) and `tamiz-frontier` (`pinned-frontier`; personal
  data of level `high` is blocked there because the only target is US and the `anonymize`
  level allows local and EU only). No Citara rule.
- **Rationale**: Read from `apps/gateway/policies/default.yaml` (version 3). The block on
  `tamiz-frontier` with a name is the concrete 451 used by US2-3 (`applyPrivacy` returns
  `no_target` when residency filtering empties the chain).
- **Alternatives**: A `citara-*` alias or a Citara rule (deferred to D4's answer).

## R-09 Documentation tests (FR-014)

- **Decision**: `examples/citara-client/test/guide.test.ts` parses four Markdown tables of
  `docs/integrations/citara.md`, each introduced by an HTML comment marker
  (`<!-- table:headers -->`, `errors`, `config`, `models`), and compares them with:
  - headers: the 200 response headers that the harness's `/openapi.json` declares for
    `POST /v1/chat/completions`, plus `retry-after`;
  - errors: the error types whose status (`errorTypeToHttpStatus` from `@tamiz/contracts`)
    is a documented response of that operation in `/openapi.json`, plus `internal` (500);
  - config: the keys of the example's Zod configuration schema;
  - models: one request per alias against the harness, checking `x-tamiz-rule`.
- **Rationale**: The OpenAPI document is generated from the route definitions, so the test
  follows the gateway without importing its source. The markers make parsing robust.
- **Alternatives**: Generate the tables from code (rejected: the guide is prose for
  humans; a check is enough); no doc tests (rejected: the guide is the main deliverable).

## R-10 Constitution IV (D5)

- **Decision**: No new dataset or threshold.
- **Rationale**: The feature adds no AI behaviour; the example's requests go through the
  routing, detection, leak and quality paths that feature 007 already gates on synthetic
  data. The example's privacy scenarios are deterministic tests with a scripted detector.
  A Citara-shaped slice (prompts like Citara's, with Citara's entity mix) is worth adding to
  `pii-leak-es` and `routing` only once D1 says what Citara sends.
- **Alternatives**: Invent a Citara dataset now (rejected: would encode guesses as a gate).

## R-11 Full-stack run and `T-OPS-01` (D7)

- **Decision**: `T-010-02` keeps `T-OPS-01` as a dependency only for US5. The backlog row
  is split: `T-010-02` (guide, example, tests; depends on `T-010-01`) and `T-010-03`
  (recorded run against `docker compose`; depends on `T-010-02`, `T-OPS-01`).
- **Rationale**: Everything but the recorded run works against the harness, so the feature
  need not wait for the dashboard design gate that blocks `T-OPS-01`.
- **Alternatives**: Keep `T-010-02` blocked on `T-OPS-01` (rejected: the only runnable work
  would stall behind G1).

## R-12 Deployment topology (D3)

- **Decision**: The guide describes two settings: same host or compose network
  (`http://gateway:3000`, plain HTTP inside the private network) and remote (HTTPS through a
  reverse proxy; Tamiz does not terminate TLS). The example takes any base URL.
- **Rationale**: Unknown where Citara runs; both are cheap to document.
- **Alternatives**: Ship a compose override that adds Citara (rejected: Citara's image is
  not part of this repository).
