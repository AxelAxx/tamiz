# Tamiz Constitution

Tamiz is a privacy-aware LLM gateway: it inspects every request for personal data,
routes it according to a declarative policy, survives provider failures, audits every
decision without storing content, and proves all of this with evals that gate CI.

These principles are non-negotiable. Every spec, plan, task and pull request is checked
against them. The foundational document is `docs/tamiz-project.md`; this constitution is
its executable summary.

## Core Principles

### I. Strict Clean Architecture
The domain imports nothing from infrastructure or frameworks. Dependencies point inward:
`domain` depends on nothing, `application` depends on `domain`, `infrastructure` and
`presentation` depend on `application` and `domain`. Only the composition root
(`main.ts`) imports from `infrastructure`. The rules are enforced automatically by
dependency-cruiser in CI; a violation is a failed build, not a review comment.

### II. Contract-First
Every public contract (HTTP endpoints, events, MCP tools) is defined first as a Zod schema
in `packages/contracts`. TypeScript types and OpenAPI documents are derived from those
schemas, never written by hand. The Python privacy service publishes an OpenAPI contract
that the gateway consumes through a mirrored Zod schema.

### III. Spec Before Code
No feature is implemented without an approved `spec.md`, `plan.md` and `tasks.md` under
`specs/NNN-feature/`. Every `spec.md` states acceptance criteria as Given/When/Then that
map one-to-one to tests. Human review is mandatory between each Spec Kit step: the spec
governs, the AI executes.

### IV. Evals Are Executable Spec
Every AI behaviour has a versioned, synthetic eval dataset with a threshold declared in
its spec. If a change drops a metric below its threshold, CI fails and the PR cannot be
merged. Real data is never used in datasets.

### V. Privacy by Default
Prompt content is never written to logs, traces or the database. Only metadata and
hashes are persisted. Anonymization maps live in memory for the duration of a request and
are never stored. Sensitive fields (`prompt`, `messages`, `authorization`) are redacted
at the logger.

### VI. Fail Fast, Never Silently
Domain errors are typed values (`Result<T, E>`); exceptions exist only at the edges and
are converted into domain errors by adapters. Every fallback is recorded as an observable
event (trace event, metric, response header). A fallback that would violate data
residency fails the request instead of degrading it. Invalid configuration stops the
process at boot.

### VII. Strict TypeScript
`strict`, `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` are on. `any` is
forbidden. Identifiers (`RequestId`, `PolicyId`) and units (`Usd`, `Milliseconds`) are
branded types. The Python service holds the same bar: Ruff, strict mypy, Pydantic v2.

### VIII. Testability
Every use case is tested with in-memory fake adapters from `packages/test-utils`, with no
network and no database. Time enters the domain through a `ClockPort`. Integration tests
use Testcontainers (PostgreSQL, Redis) and MSW for providers; they never replace unit
tests.

### IX. Composition Over Inheritance
Middlewares, resilience policies and routing strategies are composable functions. No
class hierarchies for behaviour.

### X. Simplicity
No speculative abstractions. A port is introduced when a second real adapter exists or
when it is needed to test a use case. Specs stay short and centred on acceptance
criteria.

## Repository Rules

### English as the single repository language
Everything inside the repository is written in English: code, identifiers, comments,
docstrings, specs, plans, tasks, ADRs, documentation, commit messages, PR descriptions
and this constitution. The only exception is *content* that is Spanish by design: the
synthetic eval datasets and the test corpora for Spanish PII recognizers (DNI, NIE, CIF,
IBAN, phone numbers, social security numbers). Conversations with the maintainer may
happen in Spanish; nothing in Spanish is committed as documentation. See ADR-0002.

### Task protocol
Work is split into small, independent tasks listed in `docs/tasks/BACKLOG.md`, each one
sized for a single Claude Code session (roughly 1-3 hours) and identified by a stable ID
(`T-FFF-NN`, where `FFF` is the feature number). Before touching code, a session reads
`CLAUDE.md`, then `docs/tasks/BACKLOG.md`, then the relevant completion records under
`docs/tasks/done/`. When a task is finished, the session writes
`docs/tasks/done/<TASK-ID>-<slug>.md` from `docs/tasks/TEMPLATE.md` and updates the task
status in the backlog in the same commit. One task equals one pull request.

### Code conventions
Conventional Commits (`feat`, `fix`, `chore`, `docs`, `test`, `refactor`, `ci`, `build`),
enforced by commitlint. Early returns, short single-responsibility functions, no deep
nesting. Pure and deterministic domain functions. System prompts are versioned files in
the repository, never inline strings. Explicit timeouts per provider and per task type.

## Quality Gates

The CI pipeline runs, in order: `biome check` -> `tsc --noEmit` -> `depcruise` ->
`vitest` -> evals -> `build` -> `docker build`. The Python service runs `ruff` -> `mypy`
-> `pytest`. A PR is mergeable only when every stage is green and every eval metric is at
or above its threshold. Containers run as a non-root user and dependencies are scanned in
CI.

## Governance

This constitution supersedes any other practice in the repository. Amendments are made
through a pull request that updates this file, bumps the version below, and adds an ADR
in `docs/adr/` when the change affects architecture. Every spec, plan and PR review must
state how it complies with these principles; added complexity must be justified in the
plan's complexity tracking section. `CLAUDE.md` is the runtime guidance file for AI
sessions and must stay consistent with this document.

**Version**: 1.0.0 | **Ratified**: 2026-10-18 | **Last Amended**: 2026-10-18
