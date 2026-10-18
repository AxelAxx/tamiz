# ADR-0001 — Adopt Clean Architecture and contract-first design

| Field | Value |
|---|---|
| Status | accepted |
| Date | 2026-10-18 |
| Deciders | Alex |
| Related | constitution principles I and II; feature `001-contracts-and-skeleton`; task `T-000-01` |

## Context

Tamiz sits between client applications and several LLM providers, a privacy service, a
database and a cache. The routing and resilience logic is the value of the project and
must stay testable without any of those dependencies. The public surface (an
OpenAI-compatible HTTP API, admin endpoints, MCP tools) is consumed by the dashboard, the
MCP server and third parties, so drift between implementation and documentation would be
costly. The project is also a portfolio piece: the architecture has to be legible and
verifiable by a reader in minutes.

## Decision

We will structure the gateway (and mirror it in the Python privacy service) as a strict
Clean Architecture with four layers, `domain`, `application`, `infrastructure` and
`presentation`, with dependencies pointing inward:

- `domain` imports nothing outside itself.
- `application` imports only `domain` and defines ports (interfaces) for every external
  capability (LLM provider, PII detector, audit log, policy repository, circuit state,
  clock).
- `infrastructure` implements those ports and may import `application` and `domain`.
- `presentation` (HTTP) imports `application`, `domain` and `packages/contracts`.
- Only the composition root `main.ts` imports from `infrastructure`.

These rules are encoded in `.dependency-cruiser.cjs` and run in CI; a violation fails the
build.

We will define every public contract first as a Zod schema in `packages/contracts`.
TypeScript types, request validation and the OpenAPI document are derived from those
schemas. The privacy service publishes OpenAPI from its Pydantic models and the gateway
consumes it through a mirrored Zod schema, validated by contract tests.

## Consequences

- Use cases are tested with in-memory fakes only (`packages/test-utils`); no network or
  database in unit tests. Integration tests exercise adapters in isolation.
- Adding a provider means adding one adapter; the domain and use cases do not change.
- A single source of truth for contracts removes hand-written types and keeps the
  dashboard's RPC client (`hc`) and the MCP tool schemas in sync.
- Cost: more files and some ceremony (ports, mappers). Mitigated by principle X: a port
  is only introduced with a second real adapter or when needed for testing.
- Enforcement: dependency-cruiser in CI (task `T-001-05`), contract tests per endpoint,
  review checklist in each `plan.md`.

## Alternatives considered

- **Framework-centric layout (routes with inline logic)** — faster to start, but routing
  and resilience logic would be coupled to Hono and untestable without HTTP; rejected.
- **Hand-written OpenAPI as the source of truth** — generates types but not runtime
  validation, and drifts from the Zod validators; rejected in favour of Zod-first with
  `@hono/zod-openapi`.
- **Hexagonal naming (`ports`/`adapters` only, two layers)** — equivalent in spirit; the
  four-layer vocabulary was chosen because it is more widely recognised and maps directly
  onto dependency-cruiser rules.
