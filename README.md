# Tamiz

**Privacy-aware LLM gateway.** Use the best model for every request without sensitive
data leaving where it belongs.

Tamiz is a self-hosted gateway that sits between your application and LLM providers. It
inspects each request for personal data (Spanish DNI/NIE, IBAN, emails, phones, names…),
routes it by a declarative policy (local Ollama, EU-resident provider, or frontier model,
with anonymization or blocking when required), survives provider failures with fallback
chains and circuit breakers, audits every decision without ever storing prompt content,
and proves it all with privacy-leak and routing evals that gate CI.

> Status: features `001` … `004` done.
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
> Next: feature `005-privacy-aware-routing`.
>
> Repository: https://github.com/AxelAxx/tamiz

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
`REDIS_URL=redis://localhost:6379` shares circuit breaker state between instances.

## Planned quick start

```bash
docker compose up
```

(Available after task `T-OPS-01`.) The full README with the simulator GIF, eval results
table and limitations is written in task `T-DOC-01`.

## License

Apache License 2.0. Copyright 2026 Alex Martinez. See `LICENSE` and `NOTICE`
(rationale in `docs/adr/ADR-0003-apache-2-licence.md`).
