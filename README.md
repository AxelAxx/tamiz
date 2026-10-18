# Tamiz

**Privacy-aware LLM gateway.** Use the best model for every request without sensitive
data leaving where it belongs.

Tamiz is a self-hosted gateway that sits between your application and LLM providers. It
inspects each request for personal data (Spanish DNI/NIE, IBAN, emails, phones, names…),
routes it by a declarative policy (local Ollama, EU-resident provider, or frontier model,
with anonymization or blocking when required), survives provider failures with fallback
chains and circuit breakers, audits every decision without ever storing prompt content,
and proves it all with privacy-leak and routing evals that gate CI.

> Status: feature `001-contracts-and-skeleton` in progress. Spec approved
> (`specs/001-contracts-and-skeleton/`); the pnpm + Turborepo + Biome workspace is in
> place (`T-001-02`). Next: contracts, gateway skeleton, architecture limits and CI.
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
pnpm test         # Vitest per package
pnpm build        # tsc per package
```

Commits follow Conventional Commits and are checked by commitlint on `commit-msg`.

## Planned quick start

```bash
docker compose up
```

(Available after task `T-OPS-01`.) The full README with the simulator GIF, eval results
table and limitations is written in task `T-DOC-01`.

## License

Apache License 2.0. Copyright 2026 Alex Martinez. See `LICENSE` and `NOTICE`
(rationale in `docs/adr/ADR-0003-apache-2-licence.md`).
