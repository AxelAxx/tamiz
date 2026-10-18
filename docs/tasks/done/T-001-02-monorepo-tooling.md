# T-001-02 — Monorepo tooling: pnpm workspaces, Turborepo, Biome, shared tsconfig, commitlint, Renovate

| Field | Value |
|---|---|
| Task | `T-001-02` (see `docs/tasks/BACKLOG.md`) |
| Feature | `001-contracts-and-skeleton` |
| Spec | `specs/001-contracts-and-skeleton/spec.md` (US1, FR-001 … FR-005); `tasks.md` Phase 1 (T001–T016) |
| Branch / PR | `T-001-02-monorepo-tooling` / PR opened after this commit |
| Date | 2026-10-18 |
| Session | Claude Code (Claude Fable 5.1), same session that wrote `T-001-01` |
| Status | done (one manual step left for Alex: install the Renovate GitHub App, see Pending) |

## What was done

The repository is now a pnpm 10 workspace orchestrated by Turborepo 2 and checked by
Biome 2, with a shared strict TypeScript configuration package, Conventional Commits
enforced by commitlint through a husky `commit-msg` hook, and a Renovate configuration.
Three workspace members exist as buildable scaffolds (`@tamiz/contracts`,
`@tamiz/test-utils`, `@tamiz/gateway`) so that `pnpm lint`, `pnpm typecheck`,
`pnpm test` and `pnpm build` exercise the whole chain from the root; their real content
arrives in `T-001-03`, `T-001-06` and `T-001-04`. Spec scenarios US1-1 … US1-5 are
covered: install and the four gates exit 0, a non-conventional commit is refused, a
conventional one is accepted, and `apps/gateway/test/root-manifest.test.ts` asserts
the root manifest is private, Apache-2.0 and pins Node 22 and pnpm.

## Files touched

- `package.json` — root: private, Apache-2.0, `type: module`, `packageManager: pnpm@10.34.7`, `engines.node >=22 <23`, scripts `lint`, `format`, `typecheck`, `arch` (placeholder until `T-001-05`), `test`, `build`, `commitlint`, `prepare: husky`.
- `pnpm-workspace.yaml` — `apps/*`, `packages/*`; pnpm **catalog** pinning `typescript`, `vitest`, `@types/node` once for every package.
- `.npmrc` — `auto-install-peers`, `strict-peer-dependencies=false`.
- `.nvmrc` — `22`.
- `turbo.json` — tasks `typecheck`, `test`, `build` (`dependsOn: ["^build"]`, `outputs: dist/**`).
- `biome.json` — root config (`root: true`), `vcs.useIgnoreFile`, excludes `.specify`, `.claude`, `pnpm-lock.yaml`; `preset: recommended`, `noExplicitAny: error`, `noNonNullAssertion: error`; formatter 2 spaces / 100 cols / double quotes / LF; `organizeImports` on.
- `commitlint.config.ts` — extends `@commitlint/config-conventional`, type enum from the constitution plus `perf`, `style`, `revert`; header ≤ 100.
- `.husky/commit-msg` — `pnpm commitlint "$1"` (the root script already carries `--edit`).
- `renovate.json` — `config:recommended`, `:semanticCommits`, `group:allNonMajor`, `helpers:pinGitHubActionDigests`, Monday-morning schedule (Europe/Madrid), `rangeStrategy: bump`, lock-file maintenance.
- `packages/tsconfig/{package.json,base.json,library.json,node-app.json}` — shared configs (see Decisions).
- `packages/contracts/{package.json,tsconfig.json,tsconfig.build.json,src/index.ts}`, `packages/test-utils/…`, `apps/gateway/…` — scaffolds with `typecheck`, `test` (`vitest run --passWithNoTests`) and `build` scripts.
- `apps/gateway/test/root-manifest.test.ts` — spec US1-5 (4 assertions).
- `pnpm-lock.yaml` — committed.
- `README.md` (status + "Developing" section), `CLAUDE.md` section 12 (commands are real now), READMEs of the four packages.

## Decisions

- **pnpm installed with `npm install -g pnpm@10`, not Corepack.** `corepack enable pnpm`
  fails with `EPERM` on this machine because Node lives in `C:\Program Files\nodejs`
  (no admin rights). `corepack pnpm@10` works but is not on `PATH` for git hooks. The
  `packageManager` field still pins the version for Corepack users and for CI
  (`pnpm/action-setup` reads it).
- **pnpm catalog** for `typescript`, `vitest`, `@types/node` so every package resolves
  the same version from one place; Renovate updates the catalog.
- **Root `lint` runs Biome once over the whole repository** instead of a Turborepo
  `lint` task per package: Biome is a single fast binary and the root has files
  (`turbo.json`, `renovate.json`, configs) that no package owns. `tasks.md` T005 listed
  `lint` among the turbo tasks; dropped as redundant. `typecheck`, `test`, `build` are
  turbo tasks.
- **`turbo.json` `test.outputs` is empty**, not `coverage/**`: per-package coverage does
  not exist (the root Vitest `projects` run of `T-001-06` produces it) and Turborepo
  warned about missing outputs on every run.
- **`library.json` has no `composite`/`incremental`** (research R-04 listed them): there
  are no project references, and `composite` conflicts with the `noEmit` typecheck
  config. Declarations and maps are kept.
- **Per-package `tsconfig.json` (typecheck, includes `test/`, `noEmit`) and
  `tsconfig.build.json` (emit `src/` → `dist/`)**, as planned.
- **Biome 2.5 `preset: "recommended"`**: `rules.recommended: true` is deprecated; the
  file was migrated with `biome migrate --write`, which also inserted a duplicate
  `"root": false` that had to be removed by hand (see Pitfalls).
- **Versions resolved**: pnpm 10.34.7, turbo 2.11.9, Biome 2.5.15, TypeScript 5.9.3,
  Vitest 4.1.12, `@types/node` 22.20.5, commitlint 21.2.3, husky 9.1.7.
- **Backlog edit kept to the `T-001-02` row only.** A parallel session is writing
  `T-002-01` in its own worktree and also edits `docs/tasks/BACKLOG.md`; not touching
  the Notes section avoids a merge conflict.

## How it was verified

```bash
pnpm install                                   # Done in 1s, husky prepare ran
pnpm lint                                      # Checked 22 files. No fixes applied.   exit 0
pnpm typecheck                                 # Tasks: 3 successful, 3 total          exit 0
pnpm test                                      # @tamiz/gateway: 1 file, 4 tests passed; others pass with no tests
pnpm build                                     # Tasks: 3 successful; dist/ in contracts, test-utils, gateway
for i in 1 2 3; do pnpm typecheck && pnpm test && pnpm build; done   # all green, 3/3
git commit -m "wip"
# ✖ subject may not be empty [subject-empty]  ✖ type may not be empty [type-empty]
# husky - commit-msg script failed (code 1)                              exit 1
git commit -m "chore: verify commit hook"                               exit 0  (then git reset --soft HEAD~1)
```

Every pnpm command prints `WARN Unsupported engine: wanted {"node":">=22 <23"} (current:
v24.14.0)`; this is the intended visible mismatch (spec Assumptions), not an error.

## Pending / follow-ups

- **Alex**: install the Renovate GitHub App on `AxelAxx/tamiz` (https://github.com/apps/renovate);
  `renovate.json` is in place. Its onboarding PR is expected to be a no-op.
- `pnpm arch` is a placeholder until `T-001-05`.
- `pnpm test` runs Vitest per package through Turborepo; `T-001-06` replaces it with the
  root `vitest.config.ts` (`test.projects`) and coverage.
- A `.github/workflows/ci.yml` does not exist yet (`T-001-05`), so this PR has no checks.

## Pitfalls for the next session

- **Transient pnpm crash under Turborepo on the very first `pnpm typecheck`**: one
  package failed with a stack trace inside `pnpm.cjs` and no TypeScript error; the
  three following runs were clean. Rerun before debugging. If it recurs, run turbo
  with `--concurrency 1` to confirm it is a race.
- **`biome migrate --write` inserted `"root": false` as the first key while `"root":
  true` already existed**, and `biome check` then failed on `noDuplicateObjectKeys`.
  Check `biome.json` after any migration.
- **Hook argument**: the root script is `commitlint --edit`, so the hook must call
  `pnpm commitlint "$1"`; `pnpm commitlint --edit "$1"` passes `--edit` twice (it still
  worked, but the command line was wrong).
- **Python edits on Windows write CRLF**; `.gitattributes` normalises on commit, but
  normalise the working copy too (`\r\n` → `\n`) or `git status` shows phantom changes.
- `corepack enable` needs admin rights here; use `npm install -g pnpm@10` (user prefix
  `%APPDATA%\npm`, already on `PATH`).
- Spec Kit skills were not involved in this task; `.specify/feature.json` still points
  at `specs/001-contracts-and-skeleton`.

## Links

- Spec / plan / tasks: `specs/001-contracts-and-skeleton/{spec,plan,tasks}.md` (Phase 1), `research.md` R-01 … R-06
- ADRs: `docs/adr/ADR-0003-apache-2-licence.md` (root `license` field)
- Related task records: `docs/tasks/done/T-001-01-spec-plan-tasks-001.md`, `docs/tasks/done/T-000-01-bootstrap.md` (machine facts: Node 24, no pnpm)
