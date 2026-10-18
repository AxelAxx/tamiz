# T-000-01 — Bootstrap repository, constitution and task protocol

| Field | Value |
|---|---|
| Task | `T-000-01` |
| Feature | — (bootstrap) |
| Spec | — |
| Branch / PR | `main`, first commit, not pushed (no remote yet, see `T-OPS-00`) |
| Date | 2026-10-18 |
| Session | Claude Code (Claude Fable 5.1), started from the maintainer's Unreal session |
| Status | done |

## What was done

Created the Tamiz repository from scratch at `C:\Users\almc7\Documents\Repos\tamiz`
following the foundational document (`docs/tamiz-project.md`). Initialized GitHub Spec
Kit for Claude Code, wrote the constitution (10 principles plus the English-only rule and
the task protocol), the master `CLAUDE.md`, the full task backlog for the 14-day roadmap,
the task record template, two ADRs, the architecture diagrams and the folder skeleton of
the monorepo with a one-paragraph README per folder. No application code and no npm or
Python dependencies were installed on purpose: feature 001 starts that in its own tasks.

## Files touched

- `docs/tamiz-project.md` — verbatim copy of the foundational document (Spanish; it is
  the source, not repository documentation, see ADR-0002).
- `.specify/**` — Spec Kit scaffold (templates, PowerShell scripts, workflow registry).
- `.specify/memory/constitution.md` — Tamiz constitution v1.0.0.
- `.claude/skills/speckit-*/SKILL.md` — Spec Kit skills installed by the CLI.
- `CLAUDE.md` — master project guide and session protocol.
- `docs/tasks/BACKLOG.md` — all tasks for features 001-010, OPS and DOC.
- `docs/tasks/TEMPLATE.md` — task record template.
- `docs/tasks/done/T-000-01-bootstrap.md` — this record.
- `docs/adr/TEMPLATE.md`, `docs/adr/ADR-0001-clean-architecture-contract-first.md`,
  `docs/adr/ADR-0002-english-single-repository-language.md`.
- `docs/architecture.md` — Mermaid system view, request flow and layer dependencies.
- `README.md`, `.gitignore`, `.editorconfig`.
- `apps/{gateway,dashboard,mcp-server}/README.md`, `services/privacy/README.md`,
  `packages/{contracts,evals,tsconfig,test-utils}/README.md`, `specs/README.md`,
  `docs/adr/README.md`.

## Decisions

- **Spec Kit CLI changed its flags.** The foundational document shows
  `specify init tamiz` with `--ai claude`; the current CLI (spec-kit `1.2.2.dev0`, commit
  `c6a4c18`) uses `--integration claude` and installs **skills** under `.claude/skills/`
  named `/speckit-constitution`, `/speckit-specify`, `/speckit-plan`, `/speckit-tasks`,
  `/speckit-implement` (hyphen, not dot), plus `/speckit-clarify`, `/speckit-checklist`,
  `/speckit-analyze`, `/speckit-converge`, `/speckit-taskstoissues`. `CLAUDE.md` documents
  the hyphenated names; the foundational document keeps the old `/speckit.*` spelling as
  history.
- Exact command used:
  `uvx --from git+https://github.com/github/spec-kit.git specify init --here --force --non-interactive --integration claude --script ps --ignore-agent-tools`.
  `--script ps` because the maintainer works on Windows; `--no-git` is no longer an
  option, so `git init` was run by hand afterwards with `main` as the default branch.
- `.specify/.gitignore` (written by the CLI) excludes machine-local state
  (`feature.json`, integration packages). `.claude/` is committed because it only holds
  the Spec Kit skills; no credentials live there. Review before adding anything else.
- The constitution was written by hand from section 2 of the foundational document
  instead of running `/speckit-constitution`, so that this bootstrap session did not
  depend on an interactive skill. The template checksum file
  `.specify/memory/.constitution-template.json` was left untouched.
- Backlog granularity: one row per 1-3 hour session, grouped by roadmap day. Spec
  writing for each feature is its own task (`T-00N-01`). Cross-cutting delivery and
  documentation tasks use the `OPS` and `DOC` feature codes because the foundational
  document has no feature number for them.
- The Redis circuit-state adapter (`T-003-06`) is scheduled on day 7 with the other
  infrastructure (Postgres, Jaeger) rather than on day 4, to keep day 4 focused on the
  pure resilience logic.
- Licence not committed: MIT assumed for a portfolio project, pending the maintainer's
  confirmation (see `CLAUDE.md` section 13).

## How it was verified

```bash
uvx --from git+https://github.com/github/spec-kit.git specify init --here --force --non-interactive --integration claude --script ps --ignore-agent-tools
# -> "Project ready." with the skills list
git init -b main && git add -A && git commit -F <message file>
git log --oneline   # one commit on main
```

The file tree was listed after the commit to confirm every path in "Files touched"
exists. No tests exist yet (no code).

## Pending / follow-ups

- `T-OPS-00` (GitHub remote and push) is `blocked` on the maintainer's choice of handle
  (`tamiz` / `tamiz-ai`) and licence.
- First real task: `T-001-01` (spec, plan and tasks for `001-contracts-and-skeleton`).
- `docs/architecture.md` has the system view and layer diagrams; the C4 context and
  container diagrams are completed in `T-DOC-02`.

## Pitfalls for the next session

- The Spec Kit skills run PowerShell scripts (`.specify/scripts/powershell/*.ps1`). From
  Claude Code on Windows they are invoked as `powershell -File ...`; if the Bash tool is
  used, call `powershell.exe` explicitly.
- `/speckit-specify` creates a branch `NNN-short-name` from the description. Always pass
  the roadmap short name so the folder under `specs/` matches the feature list in
  `CLAUDE.md` section 11 (`001-contracts-and-skeleton`, …). Feature numbering is
  `sequential` (`.specify/init-options.json`).
- `pnpm` is **not installed** on this machine (Node 24.14 is; the project targets Node 22
  LTS). `T-001-02` must install pnpm (`corepack enable pnpm` or the official installer)
  and pin Node 22 via `.nvmrc`/`engines`; verify with `node --version` before assuming.
- Python on the machine is 3.13; the privacy service targets 3.12 and must pin it with
  `uv python pin 3.12` (uv 0.11 downloads it).
- `docs/tamiz-project.md` is in Spanish by design (it is the source document). Do not
  translate it in place; quote it in English in specs.

## Links

- Foundational document: `docs/tamiz-project.md`
- Constitution: `.specify/memory/constitution.md`
- ADRs: `docs/adr/ADR-0001-clean-architecture-contract-first.md`,
  `docs/adr/ADR-0002-english-single-repository-language.md`
- Backlog: `docs/tasks/BACKLOG.md`
