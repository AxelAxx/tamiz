# Tamiz

**Privacy-aware LLM gateway.** Use the best model for every request without sensitive
data leaving where it belongs.

Tamiz is a self-hosted gateway that sits between your application and LLM providers. It
inspects each request for personal data (Spanish DNI/NIE, IBAN, emails, phones, names…),
routes it by a declarative policy (local Ollama, EU-resident provider, or frontier model,
with anonymization or blocking when required), survives provider failures with fallback
chains and circuit breakers, audits every decision without ever storing prompt content,
and proves it all with privacy-leak and routing evals that gate CI.

> Status: bootstrap. The repository structure, constitution and task backlog are in
> place; implementation starts with feature `001-contracts-and-skeleton`.

## Where to start

- `CLAUDE.md` — the project map and working protocol (read first).
- `docs/tamiz-project.md` — foundational document (vision, stack, architecture, roadmap).
- `.specify/memory/constitution.md` — the ten non-negotiable principles.
- `docs/architecture.md` — diagrams.
- `docs/adr/` — architecture decision records.
- `docs/tasks/BACKLOG.md` — the task list for the 14-day roadmap.

## Planned quick start

```bash
docker compose up
```

(Available after task `T-OPS-01`.) The full README with the simulator GIF, eval results
table and limitations is written in task `T-DOC-01`.

## Licence

To be decided (MIT assumed).
