# T-OPS-00 — Create the public GitHub repository and push `main`

| Field | Value |
|---|---|
| Task | `T-OPS-00` |
| Feature | — (delivery / repository) |
| Spec | — |
| Branch / PR | `main`, pushed directly (no PR: the repository did not exist before) |
| Date | 2026-10-18 |
| Session | Claude Code (Claude Fable 5.1), the maintainer's "Tamiz project setup" session; record written by the bootstrap session |
| Status | done (branch protection deferred to `T-001-05`, see below) |

## What was done

With Alex's explicit go-ahead, the public repository
**https://github.com/AxelAxx/tamiz** was created under his personal GitHub account
(`AxelAxx`, repository name `tamiz`, description "Tamiz - Privacy-aware LLM gateway: …")
and `main` was pushed with HEAD `dafb193`. `origin` is configured in the local checkout
and `main` tracks `origin/main`. This closes the handle decision recorded in the
`T-000-01` follow-up: no organisation, personal account, workspace packages `@tamiz/*`
private and never published.

## Files touched

- None in the repository by the creation itself. This record, `docs/tasks/BACKLOG.md`,
  `README.md` and `CLAUDE.md` (repository URL) were updated afterwards in the commit
  that records the task.

## Decisions

- Repository created with GitHub CLI:
  `gh repo create tamiz --public --source . --remote origin --push`.
- GitHub CLI 2.102.0 was installed via `winget`; Alex logged in as `AxelAxx` with the
  `https` git protocol. Note for Git Bash sessions: `gh` may not be on `PATH` until the
  shell is restarted; `git` alone is enough for day-to-day work.
- **Branch protection was NOT configured.** Requiring CI on `main` makes no sense before
  the workflow exists; it is deferred to `T-001-05` (architecture limits and CI pipeline),
  whose definition of done now includes configuring branch protection on `main` requiring
  the CI check.

## How it was verified

From the local checkout, after the push:

```bash
git remote -v          # origin  https://github.com/AxelAxx/tamiz.git (fetch/push)
git fetch origin
git status -sb         # ## main...origin/main
git rev-parse HEAD origin/main   # both dafb1932866f11861463a229d04a20af83ee92e2
```

## Pending / follow-ups

- Branch protection on `main` requiring CI → `T-001-05`.
- The GitHub repository description and topics can be refined in `T-DOC-01`.

## Pitfalls for the next session

- Pushing to `main` directly was acceptable only for this bootstrap phase. From
  `T-001-01` on, every task goes through a branch and a pull request (constitution,
  "Task protocol").
- `gh` is installed but may be missing from the Git Bash `PATH` in sessions opened before
  the install; use `git` or call `gh` by its full path
  (`C:\Program Files\GitHub CLI\gh.exe`) if needed.

## Links

- Repository: https://github.com/AxelAxx/tamiz
- Related record: `docs/tasks/done/T-000-01-bootstrap.md` (follow-up section with the
  handle decision), ADR-0003 (licence).
