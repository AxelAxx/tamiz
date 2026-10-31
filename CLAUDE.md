# Tamiz — Project Guide for Claude Code

> **Use the best model for every request without sensitive data leaving where it belongs.**

This file is the master map of the project. It is dense on purpose and links to the
sources of truth instead of copying them. Read it first in every session.

Source documents, in order of authority:

1. `.specify/memory/constitution.md` — the 10 non-negotiable principles plus repository rules.
2. `docs/tamiz-project.md` — the foundational document (vision, stack, architecture, roadmap).
3. `specs/NNN-feature/` — the approved spec, plan and tasks of each feature.
4. `docs/adr/` — architecture decision records.
5. `docs/tasks/BACKLOG.md` and `docs/tasks/done/` — what is done, what is next, what was learned.

---

## 1. How to work here (read this before anything else)

**Language.** Everything in this repository is in English: code, comments, docstrings,
identifiers, specs, docs, ADRs, commit messages, PR descriptions. The maintainer (Alex)
chats in Spanish; nothing in Spanish is committed except *content* that is Spanish by
design (synthetic eval datasets and test corpora for Spanish PII recognizers). ADR-0002.

**Session protocol (mandatory).**

1. Read `CLAUDE.md` (this file).
2. Read `docs/tasks/BACKLOG.md`. Pick the task you were given; check its dependencies
   are `done`.
3. Read the `docs/tasks/done/*.md` records of its dependencies and of any task that
   touched the same area. They hold decisions and pitfalls that the code does not show.
4. Read the feature's `specs/NNN-*/spec.md`, `plan.md` and `tasks.md` if they exist.
   If the task *is* writing them, use the `/speckit-*` skills (section 6).
5. Do the work on a branch named after the task (`T-002-03-domain-routing-policy`),
   one task per pull request, Conventional Commits.
6. Before finishing: tests green, lint green, architecture check green, docs updated.
7. Write `docs/tasks/done/<TASK-ID>-<slug>.md` from `docs/tasks/TEMPLATE.md` and set the
   task to `done` in `BACKLOG.md` **in the same commit**. If you leave something
   undone, say so in the record and, if it is real work, add a new task to the backlog.
8. Do not start a task whose dependencies are not `done`. Do not widen a task's scope;
   add a backlog entry instead.

**When in doubt**, the constitution wins over this file, and this file wins over any
older doc. Flag contradictions in your task record.

---

## 2. Vision, audience, non-goals

**Problem.** Small European teams in regulated sectors (health, legal, fintech, HR) want
to use LLMs but cannot send personal data to arbitrary providers. Today they either avoid
AI on that data or use it without control.

**Solution.** A self-hosted gateway between the application and LLM providers that:

1. **Inspects** each request and detects personal data (Spanish DNI/NIE/CIF, IBAN,
   emails, phones, social security numbers, names, locations).
2. **Routes** by declarative policy: sensitive data goes to a local model (Ollama) or an
   EU-resident provider, or is anonymized before leaving; non-sensitive requests go to
   the cheapest model that meets the quality bar for the task type.
3. **Resists** failures: fallback chains, circuit breaker, retry with backoff, timeouts.
4. **Audits** every decision (entities found, rule applied, model used, cost, latency)
   without ever storing prompt content.
5. **Proves** it works: privacy-leak and routing-quality evals gate CI.

**Audience.** Startups and SMEs in Europe without a platform team. This is also a
two-week portfolio project: clarity and demonstrable rigour matter as much as features.

**Non-goals.** Not a certified compliance product. PII detection is statistical and is
presented as a defence layer with published metrics, never as a guarantee. Citara
integration (feature 010) is optional and independent.

**Naming (decided 2026-10-18).** Brand **Tamiz**, subtitle *Privacy-aware LLM gateway*.
The repository is **https://github.com/AxelAxx/tamiz** (Alex's personal GitHub account,
display name "Tamiz"); no organisation: the GitHub user `TAMIZ` and the organisation `tamiz-ai` are
taken by others, and the npm package `tamiz` is an unrelated library. Workspace packages
stay `@tamiz/*` and are **private, never published**; if a package is ever published to
npm, re-check the scope then (likely `@tamiz-ai`). Licence: **Apache-2.0** (ADR-0003).
`origin` points there; `main` tracks `origin/main` (`T-OPS-00`, 2026-10-18).

---

## 3. Constitution (summary; the full text is `.specify/memory/constitution.md`)

| # | Principle | In practice |
|---|---|---|
| I | Strict Clean Architecture | `domain` imports nothing; dependencies point inward; dependency-cruiser fails CI on violations. |
| II | Contract-first | Every public contract is a Zod schema in `packages/contracts`; types and OpenAPI derive from it. |
| III | Spec before code | No code without approved `spec.md`, `plan.md`, `tasks.md`; Given/When/Then map 1:1 to tests. |
| IV | Evals are executable spec | Every AI behaviour has a versioned synthetic dataset and a threshold; below threshold, CI fails. |
| V | Privacy by default | Prompt content never reaches logs, traces or DB; only metadata and hashes; anonymization maps in memory only. |
| VI | Fail fast, never silently | `Result<T, E>` in domain, exceptions only at the edges; every fallback is an observable event; residency violations block. |
| VII | Strict TypeScript | `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`; no `any`; branded types for IDs and units. |
| VIII | Testability | Use cases tested with in-memory fakes, no network, no DB; time via `ClockPort`. |
| IX | Composition over inheritance | Middlewares, resilience and routing strategies are composable functions. |
| X | Simplicity | No speculative abstractions; a port appears with the second real adapter or when needed to test. |

Repository rules added on top: English-only repository (ADR-0002) and the task protocol
of section 1.

---

## 4. Stack (major versions pinned; see `docs/tamiz-project.md` section 3 for rationale)

| Area | Choice |
|---|---|
| Runtime / PM / orchestration | Node.js 22 LTS · pnpm workspaces · Turborepo |
| Language / lint / arch | TypeScript 5.x strict · Biome · dependency-cruiser |
| Commits / deps | Conventional Commits + commitlint · Renovate |
| Gateway HTTP | Hono v4 + `@hono/node-server`, Zod + `@hono/zod-validator`, `@hono/zod-openapi` |
| LLM layer | Vercel AI SDK 6 (`ai`, `@ai-sdk/*`), streaming, tools, MCP client |
| Persistence / cache | Drizzle ORM + Drizzle Kit · PostgreSQL 17 · Redis (Valkey) |
| Observability | pino (JSON, redaction) · OpenTelemetry with GenAI semantic conventions · Jaeger |
| Resilience | **Own implementation** (circuit breaker, retry, timeout): it is the core of the project, never imported |
| Privacy service | Python 3.12 · uv · FastAPI + Pydantic v2 · Presidio (Analyzer + Anonymizer) · spaCy `es_core_news_lg` · Ruff + strict mypy + pytest |
| Models | Local: Ollama (Llama/Qwen/small Mistral) · EU: Mistral API · Frontier: Anthropic / OpenAI · Cheap: small model of any provider |
| Dashboard | Next.js 16 (App Router) + React 19 · Tailwind CSS v4 · shadcn/ui · shadcn Charts (Recharts) · TanStack Table + Query · Hono RPC client (`hc`) · React Hook Form + Zod · Motion · lucide-react · next-themes |
| MCP / agent | `@modelcontextprotocol/sdk` · AI SDK 6 agent that calls the LLM **through Tamiz** |
| Testing | Vitest · Testcontainers (Postgres, Redis) · MSW · Playwright · contract tests against Zod · own eval runner in `packages/evals` |
| Delivery | Docker Compose (gateway, privacy, dashboard, postgres, redis, ollama, jaeger) · GitHub Actions · multi-stage non-root images · demo on Vercel + EU VPS |

Note: Presidio moved from Microsoft to the Data Privacy Stack organization in July 2026
(MIT licence unchanged); images live at `ghcr.io/data-privacy-stack/presidio-*`.

---

## 5. Architecture

System view, request flow and layer diagram: `docs/architecture.md` (Mermaid) and
`docs/tamiz-project.md` section 4. Decisions: `docs/adr/`.

**Request flow (gateway).** `POST /v1/chat/completions` (OpenAI-compatible) → Zod
validation → `ClassifyTask` → `InspectSensitivity` (privacy service) →
`RoutingPolicy.decide()` (pure domain, returns a `RoutingDecision` with an ordered
fallback chain and a privacy action: `allow` | `anonymize` | `restrict_to_local` |
`block`) → resilient execution (timeout → retry → circuit breaker → next target; a
fallback that violates residency **blocks**) → de-anonymize with the in-memory session
map → `AuditEntry` + OTel span with GenAI attributes and `routing.decision` /
`routing.fallback` events. Response headers: `x-tamiz-route`, `x-tamiz-fallback`.

**Gateway layers (`apps/gateway/src/`).**

```
domain/        model/ (inference-request, model-target, sensitivity, routing-policy,
               routing-decision, audit-entry), errors.ts, result.ts   — zero external imports
application/   ports/ (llm-provider, pii-detector, audit-log, policy-repository,
               circuit-state, clock), use-cases/ (route-inference, stream-inference,
               simulate-policy, query-audit-log), resilience/ (retry, timeout, breaker)
infrastructure/ llm/ privacy/ persistence/ cache/ telemetry/ config/   — port adapters
presentation/  routes/ middlewares/ mappers/                            — HTTP only
main.ts        composition root: the only place that wires adapters
```

**Dependency rules (enforced by `.dependency-cruiser.cjs`).**

- `domain` → nothing.
- `application` → `domain`.
- `infrastructure` → `application`, `domain`.
- `presentation` → `application`, `domain`, `packages/contracts`.
- Only `main.ts` imports from `infrastructure`.

The Python service mirrors the layering: `src/privacy/{domain,application,infrastructure,api}/`.
The dashboard is organised by feature (`features/{live-traffic,audit-log,policy-editor,cost-analytics,eval-results}`), routes stay thin.

**MCP tools (read-only by default, permission per tool):** `simulate_routing`,
`query_audit_log`, `get_cost_report`, `get_provider_health`.

---

## 6. Monorepo layout

```
tamiz/
├── apps/
│   ├── gateway/        Hono API, Clean Architecture (section 5)
│   ├── dashboard/      Next.js 16
│   └── mcp-server/     MCP tools over the gateway admin API
├── services/
│   └── privacy/        FastAPI + Presidio (Python, uv)
├── packages/
│   ├── contracts/      Zod schemas: single source of truth for every API
│   ├── evals/          Eval runner, datasets, scorers
│   ├── tsconfig/       Shared strict TypeScript configs
│   └── test-utils/     In-memory fakes for ports, builders
├── specs/              Spec Kit output, one folder per feature (NNN-short-name)
├── docs/
│   ├── tamiz-project.md   Foundational document
│   ├── architecture.md    Mermaid diagrams
│   ├── adr/               ADR-NNNN-*.md (+ TEMPLATE.md)
│   └── tasks/             BACKLOG.md, TEMPLATE.md, done/<TASK-ID>-<slug>.md
├── .specify/           Spec Kit memory (constitution), templates, scripts
├── .claude/skills/     Spec Kit skills (/speckit-*)
├── docker-compose.yml  turbo.json  biome.json  .dependency-cruiser.cjs  (feature 001)
└── README.md
```

Each top-level folder has a one-paragraph `README.md` describing its purpose.

---

## 7. Spec-driven flow (GitHub Spec Kit)

Spec Kit is installed for Claude Code (`specify init --integration claude --script ps`,
PowerShell scripts under `.specify/scripts/powershell/`). The commands are **skills**
named with a hyphen (`/speckit-constitution`, not `/speckit.constitution`):

| Step | Skill | Artifact |
|---|---|---|
| 0 (once) | `/speckit-constitution` | `.specify/memory/constitution.md` (already written, v1.0.0) |
| 1 | `/speckit-specify` | `specs/NNN-feature/spec.md` |
| 1b (optional) | `/speckit-clarify` | questions resolved inside `spec.md` |
| 2 | `/speckit-plan` | `plan.md`, `research.md`, `data-model.md`, `contracts/`, `quickstart.md` |
| 2b (optional) | `/speckit-checklist` | quality checklist |
| 3 | `/speckit-tasks` | `tasks.md` (small, testable tasks) |
| 3b (optional) | `/speckit-analyze` | cross-artifact consistency report |
| 4 | `/speckit-implement` | code + tests |

`/speckit-specify` creates a git branch `NNN-short-name` and the matching `specs/`
folder. Feature numbers are fixed by the roadmap (001-010 below); pass the short name
so the folder matches (`001-contracts-and-skeleton`, `002-provider-routing`, …).

Project rules on top of Spec Kit (constitution III, IV):

- Every `spec.md` has Given/When/Then acceptance criteria that become tests 1:1.
- Every AI feature adds a dataset under `packages/evals/datasets/` and a threshold in `spec.md`.
- Relevant architecture decisions become an ADR in `docs/adr/` (template there).
- Human review between every step: the spec governs, the AI executes.
- `/speckit-tasks` output is the fine-grained list *inside* a feature; `docs/tasks/BACKLOG.md`
  is the coarser session-sized list across features. Keep them consistent: a backlog task
  normally maps to a group of `tasks.md` items.

---

## 8. Conventions

- **TypeScript**: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`; no
  `any`; `Result<T, E>` for domain errors; branded types for IDs (`RequestId`, `PolicyId`)
  and units (`Usd`, `Milliseconds`); env validated with Zod at boot (process refuses to start
  otherwise); pure deterministic domain, time via `ClockPort`; early returns, short functions.
- **AI in production**: system prompts are versioned files; explicit timeouts per provider
  and task type; fallbacks are never silent (trace event + metric + `x-tamiz-fallback`);
  residency violations fail instead of degrading; cost computed per request and audited.
- **Security / privacy**: API keys per client, hashed in DB; pino redaction of `prompt`,
  `messages`, `authorization`; anonymization map in memory only; non-root containers;
  dependency scanning in CI.
- **Git**: trunk-based, small PRs, one PR per backlog task; Conventional Commits with
  commitlint; branch `T-FFF-NN-short-slug` for backlog tasks (Spec Kit uses `NNN-short-name`
  for the spec-writing step; merge it before implementation tasks start).
- **Python**: Ruff, strict mypy, Pydantic v2, pytest; same layering as the gateway.
- **Docs**: Markdown, English, ADRs numbered `ADR-NNNN`, Mermaid for diagrams.

---

## 9. Testing strategy

| Layer | Test type | Real dependencies |
|---|---|---|
| Domain | Unit (+ property-based for `RoutingPolicy.decide`) | None |
| Application | Unit with fakes from `packages/test-utils` | None |
| Infrastructure | Integration | Postgres/Redis via Testcontainers, providers via MSW |
| Presentation | Contract + in-process HTTP (`app.request()`) | Fakes |
| Privacy service | pytest with synthetic Spanish corpus | Real Presidio |
| Dashboard | Playwright on key flows | Gateway with fakes |
| System | Evals | Real models (local in CI) |

---

## 10. Evals and thresholds (the heart of the project)

Synthetic, versioned datasets under `packages/evals/datasets/`. **Never real data.**

| Eval | Metric | Initial threshold |
|---|---|---|
| PII leak | % of sensitive entities reaching a disallowed provider | 0 % for critical (DNI, IBAN); < 2 % for names |
| Detection | Precision / recall per entity type | Recall ≥ 0.95 on structured identifiers |
| Routing | % of requests sent to the expected route | ≥ 95 % |
| Quality | LLM-as-judge vs reference | No more than 5 % below the frontier route |
| Cost | Total vs "everything to frontier" baseline | Reported, no threshold |

Results are published in the README (between `<!-- evals:start -->` markers, generated by
`pnpm evals:readme`) and on the dashboard's evals screen. The CI job `evals` (feature 007)
runs every eval against the real services with local models (`qwen2.5:1.5b` answers,
`qwen2.5:3b` judges) and fails below threshold; its report is the `evals-report` artifact.
Thresholds live in `packages/evals/src/thresholds.ts`; the accepted quality baseline in
`packages/evals/baselines/quality.json`. Changing either is a reviewed change.

---

## 11. Roadmap (14 days) and cut order

| Day | Delivery | Features |
|---|---|---|
| 1 | Spec Kit + constitution + specs 001 and 002; monorepo, CI and architecture limits green | 001, 002 (spec) |
| 2-3 | Multi-provider routing + OpenAI-compatible endpoint + tests | 002 |
| 4 | Resilience and streaming with fallback | 003 |
| 5-6 | Privacy service with Spanish recognizers + PII-aware routing | 004, 005 |
| 7 | Audit log + OpenTelemetry + Jaeger | 006 |
| 8 | Evals + CI gate | 007 |
| 9-11 | Dashboard (live traffic, simulator, cost, evals) | 008 |
| 12 | MCP server + agent | 009 |
| 13 | Full Docker Compose, demo deploy | OPS |
| 14 | README, GIF, diagrams, LinkedIn post, case study | DOC |

Features: `001-contracts-and-skeleton`, `002-provider-routing`, `003-resilience`,
`004-privacy-service`, `005-privacy-aware-routing`, `006-audit-and-telemetry`,
`007-evals-gate`, `008-dashboard`, `009-mcp-agent`, `010-citara-integration` (optional).

**Cut order if late:** MCP agent → cost screen → learned classifier. **Never** evals or
privacy. The full task list per day is `docs/tasks/BACKLOG.md`.

---

## 12. Useful commands

The TypeScript workspace tooling exists since `T-001-02` (pnpm 10 pinned by
`packageManager`, Node 22 by `.nvmrc`/`engines`; on this machine pnpm was installed with
`npm install -g pnpm@10` because `corepack enable` needs admin rights). Commands marked
*(later)* arrive with the task in brackets:

```bash
pnpm install                 # workspace install (also installs the husky hooks)
pnpm lint                    # biome check . (whole repo, one run)
pnpm format                  # biome format --write .
pnpm typecheck               # tsc --noEmit per package (turbo)
pnpm arch                    # dependency-cruiser over apps/gateway/src (root run, like lint)
pnpm test                    # build deps (turbo), then one root Vitest run over every project
pnpm test --coverage         # same, plus the v8 coverage table (text) and coverage/lcov.info
pnpm test:packages           # vitest per package (turbo, cached)
pnpm build                   # tsc -p tsconfig.build.json per package (turbo)
pnpm evals                   # eval runner (TAMIZ_EVAL_* env, see packages/evals/README.md); exit 0 pass / 1 below threshold / 2 error
pnpm evals:readme -- --report <evals.json>   # README results table from a report (CI artifact `evals-report`)
pnpm --filter @tamiz/evals generate:datasets [-- --check]   # regenerate the synthetic PII datasets (never edit them by hand)
pnpm --filter @tamiz/gateway generate-api-key <client>   # prints a key and its TAMIZ_API_KEYS entry
docker compose up valkey     # shared circuit state for REDIS_URL (T-003-06)
docker compose up privacy    # privacy service for TAMIZ_PRIVACY_URL (required since T-005-03)
docker compose up postgres   # audit log + API keys for DATABASE_URL (T-006-03)
docker compose up jaeger     # traces: OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318, UI :16686 (T-006-05)
pnpm --filter @tamiz/gateway db:generate   # new migration from the Drizzle schema (commit drizzle/)
pnpm --filter @tamiz/gateway api-key:add <client> [--admin]   # key stored hashed in the database
pnpm --filter @tamiz/mcp-server start:http   # MCP server on http://127.0.0.1:3100/mcp (bearer = Tamiz key); stdio: node apps/mcp-server/dist/main.js
npx @modelcontextprotocol/inspector node apps/mcp-server/dist/main.js   # try the MCP tools by hand (TAMIZ_MCP_GATEWAY_URL/KEY in its env panel)
docker compose up            # full local stack                   (later: OPS)
```

Vitest hides the output of passing tests in this agent environment; add
`--reporter=default` to see it (for example the routing dataset's accuracy report).
`.env.example` documents every gateway variable.

Commit messages are checked by commitlint through the husky `commit-msg` hook; a
non-conventional message is refused locally. CI (`.github/workflows/ci.yml`) has two jobs:
`ci` runs lint → typecheck → arch → test → build on every pull request and on `main`, plus
commitlint over the PR range; `main` requires that check (`T-001-05`). `evals` (feature 007)
starts the privacy service, two gateways and Ollama, and runs `pnpm evals`.

Privacy service (`services/privacy`, since `T-004-02`): `uv sync`, `uv run ruff check .`,
`uv run ruff format --check .`, `uv run mypy` (files from `pyproject.toml`), `uv run lint-imports`,
`uv run pytest`, `uv run python -m privacy.main`; the same steps run in the `ci` job after
`pnpm build`, plus `docker build services/privacy`. Biome ignores `services/privacy`.
`uv run pytest -m "not nlp and not metrics"` skips the model-backed suites (seconds);
`-m metrics` runs the corpus metrics and writes `reports/detection-metrics.json`;
`uv run python scripts/export_openapi.py --check` and `scripts/generate_corpus.py --check`
guard the committed contract and corpus.

Spec Kit: `uvx --from git+https://github.com/github/spec-kit.git specify check` to verify
the installation; skills are invoked from Claude Code as `/speckit-*`.

Git: `git log --oneline`, branches `T-FFF-NN-slug`, commits via Conventional Commits.

---

## 13. Decisions taken and still open

Decided on 2026-10-18: this file and the whole repository are in English (ADR-0002);
licence Apache-2.0 (ADR-0003, `LICENSE` + `NOTICE` at the root); public repository
https://github.com/AxelAxx/tamiz under Alex's personal account (section 2); `main` is
protected since `T-001-05`: required check `ci`, pull requests only, admins included.

Still open (ask Alex, do not assume):

- Public demo hosting details (VPS provider and region).
