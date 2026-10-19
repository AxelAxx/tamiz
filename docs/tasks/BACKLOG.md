# Tamiz — Task Backlog

One row per task. Each task is sized for a single Claude Code session (roughly 1-3 hours),
has a stable ID, belongs to a feature, lists its dependencies, names a concrete deliverable
and a verifiable definition of done. Tasks are ordered by the 14-day roadmap of
`docs/tamiz-project.md` section 9.

**Protocol.** Before starting a task: read `CLAUDE.md`, this file, and the records in
`done/` of every dependency. When finished: write `done/<TASK-ID>-<slug>.md` from
`TEMPLATE.md`, flip the status here, same commit, one PR per task. Do not start a task
whose dependencies are not `done`. New work discovered mid-task becomes a new row, never
scope creep.

**ID scheme.** `T-FFF-NN` where `FFF` is the feature number (`001`-`010`), or `OPS`
(delivery/infra) and `DOC` (final documentation and marketing). `T-000-*` is bootstrap.

**Status values.** `todo` · `in-progress` · `done` · `blocked` (say why in Notes).

**Day column.** Nominal roadmap day. The roadmap is aggressive; if a day overflows, the
cut order is MCP agent → cost screen → learned classifier, never evals or privacy.

Legend for the *Area* column: `G` gateway, `C` contracts, `P` privacy service, `E` evals,
`D` dashboard, `M` MCP server, `X` cross-cutting / repo.

---

## Bootstrap

| ID | Day | Feature | Area | Title | Depends on | Deliverable | Definition of done | Status |
|---|---|---|---|---|---|---|---|---|
| T-000-01 | 0 | — | X | Bootstrap repository, constitution and task protocol | — | Repo skeleton, Spec Kit, constitution, `CLAUDE.md`, this backlog, ADR-0001/0002, first commit | All files present; `git log` shows the first commit on `main`; `done/T-000-01-bootstrap.md` written | done |

## Day 1 — Spec Kit, specs 001 and 002, monorepo and CI green

| ID | Day | Feature | Area | Title | Depends on | Deliverable | Definition of done | Status |
|---|---|---|---|---|---|---|---|---|
| T-001-01 | 1 | 001 | X | Spec, plan and tasks for `001-contracts-and-skeleton` | T-000-01 | `specs/001-contracts-and-skeleton/{spec,plan,tasks}.md` via `/speckit-specify`, `/speckit-plan`, `/speckit-tasks` | Spec has Given/When/Then for health endpoint, contract validation and architecture check; plan lists the stack of section 4 of `CLAUDE.md`; reviewed by Alex | done |
| T-001-02 | 1 | 001 | X | Monorepo tooling: pnpm workspaces, Turborepo, Biome, shared tsconfig, commitlint, Renovate | T-001-01 | Root `package.json` (with `"license": "Apache-2.0"`, `"private": true`), `pnpm-workspace.yaml`, `turbo.json`, `biome.json`, `packages/tsconfig/*.json` (strict flags on), commitlint + git hook, `renovate.json`, `.nvmrc`/`engines` Node 22 | `pnpm install`, `pnpm lint`, `pnpm typecheck` exit 0 on the empty workspace; a non-conventional commit message is rejected by the hook | done |
| T-001-03 | 1 | 001 | C | `packages/contracts`: chat completions, health and error schemas + branded types | T-001-02 | Zod schemas for OpenAI-compatible `ChatCompletionRequest`/`Response` (non-streaming subset), `HealthResponse`, `ErrorEnvelope`; branded `RequestId`, `PolicyId`, `Usd`, `Milliseconds`; inferred types exported; unit tests | `pnpm --filter @tamiz/contracts test` green; a request with an unknown field or wrong type fails validation in a test; package builds | done |
| T-001-04 | 1 | 001 | G | Gateway skeleton: Hono app, Clean Architecture folders, `Result`, config, logger, `/health` | T-001-03 | `apps/gateway/src/{domain,application,infrastructure,presentation}`, `domain/result.ts`, `domain/errors.ts`, Zod env schema in `infrastructure/config`, pino with redaction, `main.ts` composition root, `GET /health` | In-process test with `app.request()` asserts `/health` matches `HealthResponse`; booting with an invalid env exits non-zero with a clear message; logger redacts `prompt`, `messages`, `authorization` in a test | done |
| T-001-05 | 1 | 001 | X | Architecture limits (dependency-cruiser) and CI pipeline | T-001-04 | `.dependency-cruiser.cjs` with the five rules of `CLAUDE.md` section 5; `.github/workflows/ci.yml` running lint → typecheck → depcruise → test → build; `pnpm arch` script | A deliberate `domain → infrastructure` import fails `pnpm arch` locally (then removed); CI green on `origin/main`; branch protection on `main` requiring the CI check configured on GitHub (deferred from T-OPS-00) | done |
| T-001-06 | 1 | 001 | X | `packages/test-utils` and Vitest workspace config | T-001-04 | `FakeClock`, `InMemoryPolicyRepository` placeholder, request builders; shared `vitest.workspace.ts`; coverage config | `pnpm test` runs every package from the root; `FakeClock` advances time deterministically in a test | done (`done/T-001-06-test-utils.md`) |
| T-001-07 | 1 | 001 | X | CI test step runs with coverage | T-001-05, T-001-06 | `.github/workflows/ci.yml` Test step becomes `pnpm test --coverage` (pnpm 10 forwards a literal `--`, so not `-- --coverage`) | CI log on the PR shows the three Vitest projects and the coverage table; `ci` check green | done (folded into the `T-001-06` PR after `T-001-05` merged; see `done/T-001-06-test-utils.md`) |
| T-002-01 | 1 | 002 | X | Spec, plan and tasks for `002-provider-routing` | T-001-01 | `specs/002-provider-routing/{spec,plan,tasks}.md` | Spec covers task classification, rule-based policy, provider adapters, OpenAI-compatible endpoint, cost per request, `x-tamiz-route` header; acceptance criteria in Given/When/Then; reviewed by Alex | done (reviewed by Alex 2026-10-18, `done/T-002-01-spec-plan-tasks-002.md`) |

## Days 2-3 — Multi-provider routing and OpenAI-compatible endpoint

| ID | Day | Feature | Area | Title | Depends on | Deliverable | Definition of done | Status |
|---|---|---|---|---|---|---|---|---|
| T-002-02 | 2 | 002 | G | Domain model: `InferenceRequest`, `ModelTarget`, `TaskType`, `RoutingDecision`, rule-based `RoutingPolicy.decide()` | T-002-01, T-001-06 | `domain/model/*.ts`; `decide()` pure and deterministic, returns ordered fallback chain; sensitivity input stubbed as `unknown` | Unit tests + property-based tests (fast-check) for `decide()`: same input → same output; every returned target is in the policy; `pnpm arch` green | done (`done/T-002-02-domain-routing-model.md`) |
| T-002-03 | 2 | 002 | G | Application: ports `LlmProviderPort`, `PolicyRepositoryPort`, `ClockPort`; use cases `ClassifyTask` and `RouteInference` (non-streaming) | T-002-02 | `application/ports/*.port.ts`, `application/use-cases/{classify-task,route-inference}.ts`; fakes in `packages/test-utils` | Use-case tests with fakes only: task type derived from heuristics (length, keywords); `RouteInference` returns `Result` with provider response or typed error; no network in tests | todo |
| T-002-04 | 2 | 002 | G | Infrastructure: AI SDK adapters for Ollama, Mistral, Anthropic, OpenAI + provider registry | T-002-03 | `infrastructure/llm/*.ts` implementing `LlmProviderPort` via `ai` + `@ai-sdk/*` (Ollama through an OpenAI-compatible provider); registry built from config | MSW integration tests per adapter: success, HTTP 429, HTTP 500, malformed body → typed domain errors; timeouts passed explicitly | todo |
| T-002-05 | 3 | 002 | G/C | Declarative policy file: schema, loader, validation at boot | T-002-03 | `RoutingPolicy` schema in `packages/contracts`; file-based `PolicyRepository` adapter (YAML/JSON); `policies/default.yaml` example | Boot with an invalid policy exits non-zero with the Zod issue path; valid policy loads and `decide()` uses its rules in a test | todo |
| T-002-06 | 3 | 002 | G | Presentation: `POST /v1/chat/completions` (non-streaming), middlewares, mappers | T-002-04, T-002-05 | Route with `@hono/zod-validator`, request-id and error-mapping middlewares, API-key auth middleware (keys from env, hashed), DTO ↔ domain mappers, `x-tamiz-route` header, OpenAPI via `@hono/zod-openapi` | Contract tests with `app.request()` and fake providers: 200 valid per `ChatCompletionResponse`, 401 without key, 400 on invalid body, 502 mapped from provider error; `/openapi.json` served | todo |
| T-002-07 | 3 | 002 | G | Cost per request: pricing table on `ModelTarget`, `Usd` arithmetic, usage in response | T-002-06 | Cost computed from token usage and target pricing; exposed in response `usage` extension and ready for audit | Unit tests for cost rounding and zero-usage; response includes cost in a contract test | todo |
| T-002-08 | 3 | 002 | G/E | Routing dataset v1 and gate test (≥ 95 % expected route) | T-002-07 | `packages/evals/datasets/routing.v1.jsonl` (≥ 40 synthetic ES/EN cases bound to `policies/default.yaml`); `apps/gateway/test/evals/routing-dataset.test.ts` running classifier + `decide()` without network; README/docs polish of feature 002 | Gate test passes at ≥ 95 % and lists every mismatch by id; task-type accuracy reported; `T-007-04` later moves the scoring into the eval runner | todo |

## Day 4 — Resilience and streaming with fallback

| ID | Day | Feature | Area | Title | Depends on | Deliverable | Definition of done | Status |
|---|---|---|---|---|---|---|---|---|
| T-003-01 | 4 | 003 | X | Spec, plan and tasks for `003-resilience` | T-002-01 | `specs/003-resilience/{spec,plan,tasks}.md` | Spec covers timeout, retry with backoff + jitter, circuit breaker states, fallback chain, residency guard, streaming with fallback before first token, observable events; reviewed by Alex | todo |
| T-003-02 | 4 | 003 | G | Composable `timeout` and `retry` policies | T-003-01, T-002-03 | `application/resilience/{timeout,retry}.ts` as higher-order functions over `ClockPort`; exponential backoff with jitter; retry only on retryable errors | Unit tests with `FakeClock`: no real timers; non-retryable errors are not retried; max attempts respected | todo |
| T-003-03 | 4 | 003 | G | Circuit breaker + `CircuitStatePort` + in-memory adapter | T-003-02 | `application/resilience/circuit-breaker.ts` (closed/open/half-open), `application/ports/circuit-state.port.ts`, `InMemoryCircuitState` in `test-utils` | State-machine unit tests: opens after N failures, half-opens after cool-down, closes on success; per-target isolation | todo |
| T-003-04 | 4 | 003 | G | Fallback chain execution with residency guard and observable events | T-003-03 | Composition timeout → retry → breaker → next target inside `RouteInference`; residency violation returns `ResidencyViolation` error instead of degrading; `x-tamiz-fallback` header; fallback event emitted through a port | Tests: chain advances on failure; chain blocks when the next target violates residency; header present only when a fallback happened; event recorded in the fake | todo |
| T-003-05 | 4 | 003 | G | Streaming: `StreamInference` use case and SSE endpoint | T-003-04 | `application/use-cases/stream-inference.ts`; `stream: true` on `/v1/chat/completions` emitting OpenAI-compatible SSE chunks; fallback allowed only before the first token | MSW tests: chunks match the streaming contract; provider failure before first token falls back; failure after first token ends the stream with a typed error event | todo |

## Day 5 — Privacy service with Spanish recognizers

| ID | Day | Feature | Area | Title | Depends on | Deliverable | Definition of done | Status |
|---|---|---|---|---|---|---|---|---|
| T-004-01 | 5 | 004 | X | Spec, plan and tasks for `004-privacy-service` | T-000-01 | `specs/004-privacy-service/{spec,plan,tasks}.md` | Spec covers `/analyze`, `/anonymize`, sensitivity levels, Spanish recognizers with checksum validation, synthetic corpus, detection thresholds (recall ≥ 0.95 structured identifiers); reviewed by Alex | todo |
| T-004-02 | 5 | 004 | P | Python project skeleton: uv, FastAPI, layering, quality tooling, Dockerfile | T-004-01 | `services/privacy/pyproject.toml` (uv), `src/privacy/{domain,application,infrastructure,api}/`, `GET /health`, Ruff + strict mypy + pytest configured, multi-stage non-root Dockerfile | `uv run ruff check .`, `uv run mypy .`, `uv run pytest` exit 0; `docker build` succeeds; `/health` returns 200 in a test client | todo |
| T-004-03 | 5 | 004 | P | Presidio Analyzer integration and `POST /analyze` | T-004-02 | Analyzer engine with spaCy `es_core_news_lg`; `/analyze` returns entities (type, span, score) and a `sensitivity_level`; Pydantic contract and OpenAPI | pytest: email, phone and person detected in Spanish text; sensitivity level computed by rule (critical/high/low/none); OpenAPI exported to `services/privacy/openapi.json` | todo |
| T-004-04 | 5 | 004 | P | Spanish recognizers: DNI, NIE, CIF with checksum validation | T-004-03 | Custom Presidio recognizers with letter/checksum validation; registered in the analyzer | pytest: valid IDs detected with score ≥ 0.9, invalid checksum rejected, no false positive on plain 8-digit numbers | todo |
| T-004-05 | 5 | 004 | P | Spanish recognizers: IBAN (ES, mod-97), phone numbers, social security number (NSS) | T-004-04 | Three more recognizers, registered and documented | pytest: valid IBAN ES detected and mod-97 failure rejected; mobile and landline formats with/without +34; NSS with control digits | todo |
| T-004-06 | 5 | 004 | P | Reversible anonymization: `POST /anonymize` with placeholder map | T-004-05 | Presidio Anonymizer producing `<DNI_1>`-style placeholders and returning the map to the caller; nothing persisted | pytest: round-trip text → anonymized → restored equals original; map not written anywhere (no file/db writes in the service) | todo |
| T-004-07 | 5 | 004 | P/E | Synthetic Spanish PII corpus and detection metrics report | T-004-05 | `services/privacy/tests/corpus/*.jsonl` (synthetic, labelled); script producing precision/recall per entity type; corpus also copied/linked for `packages/evals` | Report generated by `uv run pytest -m metrics`; recall ≥ 0.95 on DNI/NIE/IBAN/NSS/phone; corpus contains no real data (generated by script with fake generators) | todo |

## Day 6 — Privacy-aware routing

| ID | Day | Feature | Area | Title | Depends on | Deliverable | Definition of done | Status |
|---|---|---|---|---|---|---|---|---|
| T-005-01 | 6 | 005 | X | Spec, plan and tasks for `005-privacy-aware-routing` | T-002-01, T-004-01 | `specs/005-privacy-aware-routing/{spec,plan,tasks}.md` | Spec covers sensitivity model, privacy actions (`allow`, `anonymize`, `restrict_to_local`, `block`), in-memory de-anonymization, streaming restoration, simulator, caching by hash; thresholds for the PII-leak eval (0 % critical, < 2 % names); reviewed by Alex | todo |
| T-005-02 | 6 | 005 | G | Domain: `SensitivityLevel`, `DetectedEntity`, privacy actions, policy rules by sensitivity | T-005-01, T-002-02 | `domain/model/sensitivity.ts`; `RoutingPolicy` extended with sensitivity rules and residency constraints per action | Property-based tests: critical entities never yield a non-local, non-EU target unless `anonymize`; `block` returns no target; `pnpm arch` green | todo |
| T-005-03 | 6 | 005 | G/C | `PiiDetectorPort`, HTTP adapter for the privacy service, fake detector, hash cache | T-005-02, T-004-06 | Zod mirror of the privacy OpenAPI in `packages/contracts`; `infrastructure/privacy/http-pii-detector.ts`; `FakePiiDetector` in `test-utils`; cache by content hash via a `CachePort` (in-memory adapter) | MSW tests: contract mismatch → typed error; cache hit skips the HTTP call; privacy call runs in parallel with `ClassifyTask` (asserted with `FakeClock`) | todo |
| T-005-04 | 6 | 005 | G | `InspectSensitivity` + anonymize / de-anonymize in `RouteInference` (non-streaming) | T-005-03 | Use case wiring; session map kept in request scope only; `block` maps to HTTP 422 with a typed error body | Tests: anonymized prompt reaches the fake provider, response restored; `restrict_to_local` forces the local target; `block` never calls a provider; map absent from logs and audit (asserted) | todo |
| T-005-05 | 6 | 005 | G | Streaming de-anonymization with placeholder-safe buffering | T-005-04, T-003-05 | Token buffer that restores placeholders split across chunks in `StreamInference` | Tests: placeholder split in two chunks is restored; non-placeholder text passes through without extra latency beyond the buffer size; stream end flushes the buffer | todo |
| T-005-06 | 6 | 005 | G/C | `SimulatePolicy` use case and `POST /v1/simulate` (dry-run) | T-005-04 | Contract in `packages/contracts`; use case returns detected entities, rule matched, decision and chain without calling any provider | Contract test: simulating a text with a DNI returns `restrict_to_local` or `anonymize` per policy and zero provider calls in the fake | todo |

## Day 7 — Audit log, OpenTelemetry, Jaeger, shared state

| ID | Day | Feature | Area | Title | Depends on | Deliverable | Definition of done | Status |
|---|---|---|---|---|---|---|---|---|
| T-003-06 | 7 | 003 | G | Redis (Valkey) adapter for `CircuitStatePort` + Testcontainers | T-003-03 | `infrastructure/cache/redis-circuit-state.ts`; `docker-compose.yml` gains `redis`; `.env.example` | Testcontainers integration test: state shared between two breaker instances; TTL on open state; falls back to in-memory with a logged warning when Redis is unavailable | todo |
| T-006-01 | 7 | 006 | X | Spec, plan and tasks for `006-audit-and-telemetry` | T-005-01 | `specs/006-audit-and-telemetry/{spec,plan,tasks}.md` | Spec covers `AuditEntry` fields (no content), query API, cost aggregates, provider health, OTel GenAI attributes and events; privacy acceptance criteria ("no prompt content in logs/traces/DB"); reviewed by Alex | todo |
| T-006-02 | 7 | 006 | G | Domain `AuditEntry` + `AuditLogPort` + in-memory fake + wiring into use cases | T-006-01, T-005-04 | `domain/model/audit-entry.ts` (request hash, entity types and counts, rule, route, fallbacks, cost, latency, timestamps), port, `InMemoryAuditLog` | Tests: every `RouteInference` and `StreamInference` call appends exactly one entry; entry contains no prompt text (asserted by searching the serialized entry) | todo |
| T-006-03 | 7 | 006 | G | Drizzle schema, migrations and PostgreSQL repositories (audit log, api keys) | T-006-02 | `infrastructure/persistence/{schema,migrations,repositories}`; `docker-compose.yml` gains `postgres`; Drizzle Kit scripts | Testcontainers tests: migrate from empty DB, insert and query entries, api-key lookup by hash; `pnpm db:migrate` documented | todo |
| T-006-04 | 7 | 006 | G/C | `QueryAuditLog` use case + `GET /v1/admin/audit` with filters and pagination | T-006-03 | Contract (filters: date range, route, entity type, cursor pagination); use case; route behind admin API key | Contract tests with fake repository; integration test against Postgres for the SQL filters | todo |
| T-006-05 | 7 | 006 | G | OpenTelemetry with GenAI semantic conventions, routing events, Jaeger | T-006-02 | `infrastructure/telemetry/*`: tracer setup, span per provider call with `gen_ai.*` attributes, events `routing.decision` / `routing.fallback`; `docker-compose.yml` gains `jaeger`; OTLP exporter configured by env | Test with an in-memory span exporter: attributes present, prompt content absent; pino redaction re-asserted; manual check in Jaeger documented in the task record | todo |
| T-006-06 | 7 | 006 | G/C | Admin aggregates: `GET /v1/admin/cost` and `GET /v1/admin/providers` | T-006-04, T-003-06 | Cost per route/model/day via SQL aggregates vs "all frontier" baseline; provider health from circuit state and recent latencies; contracts | Integration tests against Postgres for aggregates; providers endpoint reflects an opened breaker in a test | todo |

## Day 8 — Evals and CI gate

| ID | Day | Feature | Area | Title | Depends on | Deliverable | Definition of done | Status |
|---|---|---|---|---|---|---|---|---|
| T-007-01 | 8 | 007 | X | Spec, plan and tasks for `007-evals-gate` | T-005-01 | `specs/007-evals-gate/{spec,plan,tasks}.md` | Spec fixes dataset format, scorers, thresholds (table in `CLAUDE.md` section 10), report format and CI behaviour; reviewed by Alex | todo |
| T-007-02 | 8 | 007 | E | `packages/evals` runner: dataset format, scorer interface, JSON + Markdown report, CLI | T-007-01, T-001-06 | Versioned JSONL datasets, `Scorer` type, `runEval()`, threshold check with non-zero exit, `pnpm evals` | Unit tests for the runner with a toy dataset; report written to `packages/evals/reports/`; exit code 1 when a threshold fails | todo |
| T-007-03 | 8 | 007 | E | PII-leak and detection evals against the privacy service | T-007-02, T-004-07, T-005-06 | Datasets `pii-leak-es.v1.jsonl`, `pii-detection-es.v1.jsonl` (synthetic, Spanish content); scorers using `/v1/simulate` and `/analyze` | Leak rate 0 % on DNI/IBAN and < 2 % on names with the default policy; recall ≥ 0.95 on structured identifiers; results in the report | todo |
| T-007-04 | 8 | 007 | E | Routing eval: expected route per request | T-007-02, T-005-06 | Dataset `routing.v1.jsonl` with expected route; scorer over `/v1/simulate` with fake providers | ≥ 95 % of requests reach the expected route; failures listed by ID in the report | todo |
| T-007-05 | 8 | 007 | E | Quality (LLM-as-judge) and cost evals | T-007-02, T-002-07 | Dataset with references; judge prompt as a versioned file; local judge model via Ollama; cost vs "all frontier" baseline | Quality no more than 5 % below the frontier route on the dataset (local judge in CI, frontier optional by env); cost reported with no threshold | todo |
| T-007-06 | 8 | 007 | X | CI evals stage with local models and report artifact | T-007-03, T-007-04 | `ci.yml` gains an `evals` job (Ollama service with a small quantized model, privacy service container), uploads the report, fails below threshold; README results table generated from the report | A PR that lowers a threshold metric fails the `evals` job (simulated locally by editing a dataset expectation, then reverted); `pnpm evals:readme` updates the table | todo |

## Days 9-11 — Dashboard

| ID | Day | Feature | Area | Title | Depends on | Deliverable | Definition of done | Status |
|---|---|---|---|---|---|---|---|---|
| T-008-01 | 9 | 008 | X | Spec, plan and tasks for `008-dashboard` | T-006-01 | `specs/008-dashboard/{spec,plan,tasks}.md` | Spec covers the four screens + policy editor, data sources (admin API), auth, accessibility basics, Playwright flows; reviewed by Alex | todo |
| T-008-02 | 9 | 008 | D | Next.js 16 skeleton: Tailwind v4, shadcn/ui, next-themes, typed Hono RPC client, TanStack Query, feature folders | T-008-01, T-006-06 | `apps/dashboard` with App Router layout and navigation, `lib/api-client.ts` (`hc` typed from the gateway app type), `features/*` folders, Playwright configured, Turbo build | `pnpm --filter @tamiz/dashboard build` green; a smoke Playwright test loads the home page; dark/light toggle works | todo |
| T-008-03 | 9 | 008 | D | Live traffic screen | T-008-02 | `features/live-traffic`: polling or SSE of recent audit entries, animated rows (Motion), route badges (`local`/`eu`/`frontier`), detected entity chips | Playwright test with a fake gateway: new entry appears as a row with the right badge; no prompt content displayed (none is available by contract) | todo |
| T-008-04 | 10 | 008 | D | Policy simulator screen (the README GIF) | T-008-02, T-005-06 | `features/policy-editor/simulator`: text input (RHF + Zod from contracts) → entities highlighted → decision flow visualization → chosen route | Playwright test: pasting a text with a DNI shows the entity and a `local`/`anonymize` outcome; form validation errors shown inline | todo |
| T-008-05 | 10 | 008 | D | Audit log screen | T-008-02, T-006-04 | `features/audit-log`: TanStack Table with filters (date, route, entity type) and cursor pagination over `/v1/admin/audit` | Playwright test: filter by route narrows rows; pagination loads the next page | todo |
| T-008-06 | 10 | 008 | D | Cost analytics screen | T-008-02, T-006-06 | `features/cost-analytics`: charts (shadcn Charts) real spend vs "all frontier" baseline per day and per route | Playwright test: chart renders with fake data; totals match the API fixture; cuttable per the cut order | todo |
| T-008-07 | 11 | 008 | D | Eval results screen | T-008-02, T-007-06 | `features/eval-results`: leak rate, recall and routing accuracy per policy version from the evals report exposed by the gateway (or static JSON in the repo) | Playwright test: thresholds shown green/red according to the report fixture | todo |
| T-008-08 | 11 | 008 | D/G/C | Policy editor: edit, validate and save the policy | T-008-04, T-002-05 | YAML/JSON editor with Zod validation shared from contracts; `PUT /v1/admin/policy` in the gateway (contract + use case + route) with version bump | Gateway contract test for `PUT`; Playwright: invalid policy shows the Zod issue path, valid policy saves and the simulator uses it | todo |
| T-008-09 | 11 | 008 | D | Dashboard Dockerfile, env wiring and E2E in CI | T-008-03, T-008-04, T-008-05 | Multi-stage non-root Dockerfile; env schema; Playwright job in `ci.yml` against the gateway with fakes | `docker build` succeeds; CI E2E job green; `docker-compose.yml` gains `dashboard` | todo |

## Day 12 — MCP server and agent

| ID | Day | Feature | Area | Title | Depends on | Deliverable | Definition of done | Status |
|---|---|---|---|---|---|---|---|---|
| T-009-01 | 12 | 009 | X | Spec, plan and tasks for `009-mcp-agent` | T-006-01 | `specs/009-mcp-agent/{spec,plan,tasks}.md` | Spec covers the four tools, permissions (read-only by default), transports, the dogfooding agent and the demo question "why did spend rise yesterday?"; reviewed by Alex | todo |
| T-009-02 | 12 | 009 | M/C | MCP server skeleton with `simulate_routing` and `get_provider_health` | T-009-01, T-006-06 | `apps/mcp-server` on `@modelcontextprotocol/sdk` (stdio + streamable HTTP), tool input/output schemas from `packages/contracts`, per-tool permission config | Tests with an in-process MCP client and a fake gateway: both tools return contract-valid results; a disabled tool is not listed | todo |
| T-009-03 | 12 | 009 | M | Tools `query_audit_log` and `get_cost_report` | T-009-02, T-006-04 | Two more tools with filters mirrored from the admin contracts | Tests as above; README section for the MCP server with a Claude Desktop / Claude Code config example | todo |
| T-009-04 | 12 | 009 | M | Dogfooding agent (AI SDK 6 + MCP client) calling the LLM through Tamiz | T-009-03, T-003-05 | `apps/mcp-server/src/agent/*`: agent with the MCP tools, LLM calls routed via `http://gateway/v1/chat/completions`, versioned system prompt, CLI demo script | Scripted demo answers the spend question using `get_cost_report`; the call shows up in the audit log with route `local`; recorded transcript in the task record | todo |

## Day 13 — Delivery: Docker Compose and public demo

| ID | Day | Feature | Area | Title | Depends on | Deliverable | Definition of done | Status |
|---|---|---|---|---|---|---|---|---|
| T-OPS-00 | — | — | X | Create the public GitHub repository `tamiz` under Alex's personal account and push `main` | T-000-01 | Public repository https://github.com/AxelAxx/tamiz (display name "Tamiz", Apache-2.0), `origin` set, `main` pushed | `git remote -v` shows origin and `main` tracks `origin/main`; branch protection requiring CI deferred to T-001-05 | done |
| T-OPS-01 | 13 | — | X | Full `docker compose up`: gateway, privacy, dashboard, postgres, redis, ollama, jaeger | T-008-09, T-004-02, T-006-05 | Complete `docker-compose.yml` with healthchecks, `.env.example`, Ollama model pull on first start, Makefile or `pnpm` scripts | On a clean machine `docker compose up` reaches a healthy stack in under 2 minutes (model pull excluded); a request with a DNI is routed to Ollama and visible in the dashboard and Jaeger | todo |
| T-OPS-02 | 13 | — | X | Public demo deploy: dashboard on Vercel, gateway + privacy on an EU VPS | T-OPS-01 | Deployment docs in `docs/deploy.md`, Vercel project, VPS compose profile (EU route + local only if resources allow), secrets handling | Demo URL reachable; simulator works end-to-end; limitations documented | todo |

## Day 14 — Final documentation and marketing

| ID | Day | Feature | Area | Title | Depends on | Deliverable | Definition of done | Status |
|---|---|---|---|---|---|---|---|---|
| T-DOC-01 | 14 | — | X | Final README: pitch, quick start, evals table, architecture diagram, ADR links, limitations | T-OPS-01, T-007-06 | `README.md` per `docs/tamiz-project.md` section 10 | Quick start verified from scratch; evals table generated by `pnpm evals:readme`; honest limitations section | todo |
| T-DOC-02 | 14 | — | X | Simulator GIF and C4 diagrams | T-008-04, T-DOC-01 | GIF of "request with DNI → detected → routed local → audited" embedded in README; `docs/architecture.md` completed with C4 context/container diagrams | GIF under 5 MB renders on GitHub; diagrams render in Mermaid | todo |
| T-DOC-03 | 14 | — | X | LinkedIn post and web case study drafts | T-DOC-01 | `docs/marketing/linkedin-post.md`, `docs/marketing/case-study.md` (problem → decisions → trade-offs → metrics); the post itself may be in Spanish as *content*, the surrounding docs in English | Reviewed by Alex; links to repo and demo | todo |

## Optional — Citara integration

| ID | Day | Feature | Area | Title | Depends on | Deliverable | Definition of done | Status |
|---|---|---|---|---|---|---|---|---|
| T-010-01 | — | 010 | X | Spec, plan and tasks for `010-citara-integration` | T-002-06 | `specs/010-citara-integration/{spec,plan,tasks}.md` | Spec describes how Citara points its LLM calls at Tamiz (base URL + API key) and what it gets back (headers, audit); reviewed by Alex | todo |
| T-010-02 | — | 010 | X | Integration guide and example client | T-010-01, T-OPS-01 | `docs/integrations/citara.md` + a minimal client example against the OpenAI-compatible endpoint | Example runs against `docker compose` and shows up in the audit log | todo |

---

## Notes

- Repository: https://github.com/AxelAxx/tamiz (created 2026-10-18, `T-OPS-00`). Licence Apache-2.0
  (ADR-0003); repository language English (ADR-0002). Workspace packages stay
  `@tamiz/*`, private and never published (the npm package `tamiz` is unrelated).
  Branch protection on `main` requiring CI is part of `T-001-05`.
- Spec-writing tasks (`T-00N-01`) use the Spec Kit skills; they create a `NNN-short-name`
  branch that is merged before the implementation tasks of that feature start.
- `T-001-01` artefacts are written (2026-10-18, record `done/T-001-01-spec-plan-tasks-001.md`);
  spec approved by Alex on 2026-10-18 (PR #1); `T-001-02` may start.
- Day assignments are nominal. Reorder within a feature freely; keep dependencies.
