# <TASK-ID> — <Title>

Copy this file to `docs/tasks/done/<TASK-ID>-<slug>.md` when the task is finished and
fill every section. Keep it factual and short; the next session will read it before
touching the same area. Written in English.

| Field | Value |
|---|---|
| Task | `<TASK-ID>` (see `docs/tasks/BACKLOG.md`) |
| Feature | `NNN-feature-name` or `—` |
| Spec | `specs/NNN-feature-name/spec.md` (or `—`) |
| Branch / PR | `T-FFF-NN-slug` / PR link or "not pushed yet" |
| Date | YYYY-MM-DD |
| Session | Claude Code (model, if relevant) |
| Status | done / partially done (say what is missing) |

## What was done

Two to five sentences: the outcome, in the project's own words. Cite requirement or
acceptance-criterion IDs from the spec when they exist.

## Files touched

- `path/to/file` — one line on why.
- …

## Decisions

Decisions taken during the task that the code does not make obvious: trade-offs,
alternatives rejected, deviations from the spec or plan (and why). If a decision is
architectural, link the ADR you added in `docs/adr/`.

## How it was verified

The exact commands run and their result (tests, lint, typecheck, architecture check,
manual checks). Paste the relevant tail of the output. If something could not be
verified, say so explicitly.

```bash
pnpm test --filter ...
```

## Pending / follow-ups

Anything left undone, known gaps, or new tasks added to `BACKLOG.md` (with their IDs).
Write "None" if there is nothing.

## Pitfalls for the next session

Gotchas, environment quirks, commands that look right but are not, things that took
longer than expected. This is the most valuable section.

## Links

- Spec / plan / tasks: …
- ADRs: …
- Related task records: …
