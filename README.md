# Tamiz

**Privacy-aware LLM gateway.** Use the best model for every request without sensitive
data leaving where it belongs.

Tamiz is a self-hosted gateway that sits between your application and LLM providers. It
inspects each request for personal data (Spanish DNI/NIE, IBAN, emails, phones, names…),
routes it by a declarative policy (local Ollama, EU-resident provider, or frontier model,
with anonymization or blocking when required), survives provider failures with fallback
chains and circuit breakers, audits every decision without ever storing prompt content,
and proves it all with privacy-leak and routing evals that gate CI.

> Status: features `001` … `007` and `009` done; `008` in progress.
>
> - **001 contracts and skeleton**: pnpm + Turborepo + Biome workspace, Zod contracts,
>   gateway skeleton, architecture check, CI.
> - **002 provider routing**: the OpenAI-compatible `POST /v1/chat/completions` with API
>   keys, a declarative YAML routing policy, four providers (Ollama, Mistral, Anthropic,
>   OpenAI), cost per request, `/openapi.json`, and a routing dataset gated at ≥ 95 %
>   (currently 44/44). Walkthrough:
>   [`specs/002-provider-routing/quickstart.md`](specs/002-provider-routing/quickstart.md).
> - **003 resilience**: timeouts, retries with jittered backoff, per-target circuit
>   breakers (optionally shared through Valkey), fallback along the decided chain with a
>   residency guard that blocks instead of degrading (`451`), `x-tamiz-fallback`, and
>   streaming (`stream: true`) with fallback before the first token. Walkthrough:
>   [`specs/003-resilience/quickstart.md`](specs/003-resilience/quickstart.md).
>
> - **004 privacy service**: a Python service (`services/privacy`, FastAPI + Presidio +
>   spaCy `es_core_news_lg`) with `POST /analyze` (findings and a sensitivity level, never
>   values) and `POST /anonymize` (reversible `<DNI_1>`-style placeholders; the mapping is
>   returned, stored nowhere). Spanish recognizers check the control characters of DNI,
>   NIE, CIF, IBAN and NSS. Detection on the synthetic corpus v1 (324 cases), gated in CI:
>
>   | Kind | Precision | Recall |
>   |---|---|---|
>   | DNI, NIE, CIF, IBAN, NSS, phone, email, card | 1.000 | 1.000 |
>   | Person (gate: recall ≥ 0.80) | 0.871 | 0.917 |
>   | Location (reported) | 0.805 | 0.939 |
>
>   The corpus is generated in the formats the recognizers target, so these figures
>   guard against regressions; they are not field accuracy. The PII-leak eval of feature
>   007 measures what reaches providers. Walkthrough:
>   [`specs/004-privacy-service/quickstart.md`](specs/004-privacy-service/quickstart.md).
>
> - **005 privacy-aware routing**: every request is inspected by the privacy service
>   before routing, and the policy's `privacy` section turns the sensitivity level into an
>   action:
>   - `allow`;
>   - `anonymize`: `<KIND_n>` placeholders reach the provider, and the answer is restored
>     in memory, also when streaming, even with placeholders split across chunks;
>   - `restrict_to_local`;
>   - `block` (`451`).
>
>   With the default policy, critical data (DNI, NIE, NSS, IBAN, card) never leaves the
>   machine, and names, emails and phones leave only anonymized and only to EU or local
>   targets. If the privacy service fails, the gateway fails closed. Responses say what
>   happened (`x-tamiz-sensitivity`, `x-tamiz-privacy`), and `POST /v1/simulate` shows the
>   decision without calling any model. Walkthrough:
>   [`specs/005-privacy-aware-routing/quickstart.md`](specs/005-privacy-aware-routing/quickstart.md).
>
> - **006 audit and telemetry**: every request that reaches the routing decision leaves
>   one audit entry: the decision, the entity kinds and counts, target, fallbacks, tokens,
>   cost, the "everything to the frontier model" baseline cost, and latency. It never holds
>   content; the messages are identified only by an HMAC. Entries go to PostgreSQL with
>   migrations at boot and an asynchronous batched writer, or to a bounded in-memory log.
>   Admin keys (`403` for client keys) open the admin API:
>   - `GET /v1/admin/audit`: filtered, keyset-paginated entries;
>   - `GET /v1/admin/cost`: actual vs baseline cost by day, route or model;
>   - `GET /v1/admin/providers`: circuit state, error rate and latency p50/p95 per target.
>
>   Each request is also an OpenTelemetry trace: a `tamiz.request` span with the decision,
>   one `chat {model}` span per provider attempt with the GenAI semantic-convention
>   attributes, and routing, circuit and privacy steps as span events. Spans are exported
>   over OTLP when `OTEL_EXPORTER_OTLP_ENDPOINT` is set (`docker compose up jaeger`). A
>   capture test searches logs, events, audit entries and spans for the test texts and
>   finds none. Walkthrough:
>   [`specs/006-audit-and-telemetry/quickstart.md`](specs/006-audit-and-telemetry/quickstart.md).
>
>   <!-- Jaeger screenshot: added with T-OPS-01 / T-DOC-01, once the full stack runs. -->
>
> - **007 evals gate**: `pnpm evals` runs the leak, detection, routing, quality
>   (LLM-as-judge) and cost evals against the real services. The CI job `evals` runs them on
>   every pull request with local models and blocks below threshold. Results are in the
>   [Evals](#evals) section below. Walkthrough:
>   [`specs/007-evals-gate/quickstart.md`](specs/007-evals-gate/quickstart.md).
>
> - **009 MCP server and agent**: `apps/mcp-server` exposes four read-only MCP tools over
>   stdio and streamable HTTP, for Claude Desktop, Claude Code or any MCP host:
>   - `simulate_routing`;
>   - `query_audit_log`;
>   - `get_cost_report`;
>   - `get_provider_health`.
>
>   An allowlist chooses the tools, and the admin key stays with the server. A small
>   agent (AI SDK 6 + MCP client) answers "why did spend rise yesterday?". Its own model
>   calls go **through Tamiz** on the local-only `pinned-local` rule, so the gateway audits
>   its own operator tooling. Setup:
>   [`apps/mcp-server/README.md`](apps/mcp-server/README.md).
>
> Next: feature `008-dashboard`.
>
> Repository: https://github.com/AxelAxx/tamiz

## Evals

The evals are the executable specification of what Tamiz promises (constitution IV,
`specs/007-evals-gate/`). They run against the real privacy service and gateway on every
pull request, with local models, and the pull request cannot merge below a threshold.
All data is synthetic and versioned in `packages/evals/datasets/`.

- **PII leak**: would a personal value reach a non-local provider verbatim, through any
  target of the decided chain, fallbacks included? 160 synthetic Spanish requests (health,
  legal, fintech, HR).
- **Detection**: precision and recall of the privacy service on held-out sentences in
  harder formats than its development corpus.
- **Routing**: the 44 routing cases through `POST /v1/simulate`, with the real inspection.
- **Quality**: answers on the local route, graded by a blind local judge. CI compares them
  with an accepted baseline for the same models, so a regression fails. The frontier
  comparison needs keys and is run separately.
- **Cost**: the routing cases priced on the decided target and on the most expensive one.

<!-- evals:start -->
Last run: 2026-10-31, commit `7f423cd`, policy `default` v3 — overall **pass**.

| Eval | Metric | Result | Threshold | |
|---|---|---|---|---|
| PII leak | `leak_rate.CREDIT_CARD` | 0.00 % | = 0.00 % | ✓ pass |
| PII leak | `leak_rate.DNI` | 0.00 % | = 0.00 % | ✓ pass |
| PII leak | `leak_rate.EMAIL` | 0.00 % | < 2.00 % | ✓ pass |
| PII leak | `leak_rate.IBAN` | 0.00 % | = 0.00 % | ✓ pass |
| PII leak | `leak_rate.NIE` | 0.00 % | = 0.00 % | ✓ pass |
| PII leak | `leak_rate.NSS` | 0.00 % | = 0.00 % | ✓ pass |
| PII leak | `leak_rate.PERSON` | 1.00 % | < 2.00 % | ✓ pass |
| PII leak | `leak_rate.PHONE` | 0.00 % | < 2.00 % | ✓ pass |
| Detection | `recall.CIF` | 100.00 % | ≥ 95.00 % | ✓ pass |
| Detection | `recall.CREDIT_CARD` | 100.00 % | ≥ 95.00 % | ✓ pass |
| Detection | `recall.DNI` | 100.00 % | ≥ 95.00 % | ✓ pass |
| Detection | `recall.EMAIL` | 100.00 % | ≥ 95.00 % | ✓ pass |
| Detection | `recall.IBAN` | 100.00 % | ≥ 95.00 % | ✓ pass |
| Detection | `recall.NIE` | 100.00 % | ≥ 95.00 % | ✓ pass |
| Detection | `recall.NSS` | 100.00 % | ≥ 95.00 % | ✓ pass |
| Detection | `recall.PERSON` | 89.09 % | ≥ 80.00 % | ✓ pass |
| Detection | `recall.PHONE` | 100.00 % | ≥ 95.00 % | ✓ pass |
| Routing | `route_accuracy` | 100.00 % | ≥ 95.00 % | ✓ pass |
| Quality | `mean_score.routed` | 0.8750 | reported | reported |
| Quality | `relative_score` | 100.00 % | ≥ 95.00 % | ✓ pass |
| Cost | `cost.routed_estimate` | $0.03759 | reported | reported |
| Cost | `cost.baseline_estimate` | $0.29130 | reported | reported |
| Cost | `saving` | 87.09 % | reported | reported |

Datasets: pii-leak-es v1 (160), pii-detection-es v1 (160), routing v1 (44), quality-es v1 (24). Models: answer `qwen2.5:1.5b`, judge `qwen2.5:3b`.
<!-- evals:end -->

Limitations: detection is statistical (spaCy for names), so the figures are a measured
defence layer on synthetic data, not a guarantee. CI runs small local models, so the
quality figures track regressions rather than absolute quality.

## Where to start

- `CLAUDE.md` — the project map and working protocol (read first).
- `docs/tamiz-project.md` — foundational document (vision, stack, architecture, roadmap).
- `.specify/memory/constitution.md` — the ten non-negotiable principles.
- `docs/architecture.md` — diagrams.
- `docs/adr/` — architecture decision records.
- `docs/tasks/BACKLOG.md` — the task list for the 14-day roadmap.

## Developing

Node.js 22 LTS (`.nvmrc`) and pnpm 10 (pinned by `packageManager`; `corepack enable pnpm`
or `npm install -g pnpm@10`).

```bash
pnpm install      # also installs the commit-message hook
pnpm lint         # Biome
pnpm typecheck    # tsc per package
pnpm test         # every package from the root (Vitest projects); add --coverage for the table
pnpm test:packages  # per-package Vitest through Turborepo (cached)
pnpm build        # tsc per package
```

Commits follow Conventional Commits and are checked by commitlint on `commit-msg`.

To run the gateway locally, copy `.env.example` (every variable is documented there),
generate a key with `pnpm --filter @tamiz/gateway generate-api-key <client>`, and start
it with `pnpm --filter @tamiz/gateway dev`. `docker compose up valkey` plus
`REDIS_URL=redis://localhost:6379` shares circuit breaker state between instances;
`docker compose up postgres` with `DATABASE_URL` keeps the audit log, and
`docker compose up jaeger` with `OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318` shows
the traces (UI on http://localhost:16686).

## Planned quick start

```bash
docker compose up
```

(Available after task `T-OPS-01`.) The full README with the simulator GIF, eval results
table and limitations is written in task `T-DOC-01`.

## License

Apache License 2.0. Copyright 2026 Alex Martinez. See `LICENSE` and `NOTICE`
(rationale in `docs/adr/ADR-0003-apache-2-licence.md`).
