# T-001-05 — Architecture limits (dependency-cruiser) and CI pipeline

| Field | Value |
|---|---|
| Task | `T-001-05` (see `docs/tasks/BACKLOG.md`) |
| Feature | `001-contracts-and-skeleton` |
| Spec | `specs/001-contracts-and-skeleton/spec.md` (US6, FR-021 … FR-024, SC-003, SC-006); `tasks.md` Phase 4 (T052–T063); `research.md` R-12; `quickstart.md` section 6 |
| Branch / PR | `T-001-05-architecture-and-ci` / https://github.com/AxelAxx/tamiz/pull/6 |
| Date | 2026-10-19 |
| Session | Claude Code (Claude Fable 5.1), side session started from the `T-001-04` session |
| Status | done (branch protection on `main` pending Alex's go-ahead, see Pending) |

## What was done

The five layer rules of `CLAUDE.md` section 5 are now enforced by dependency-cruiser from a
root `.dependency-cruiser.cjs` (`domain-imports-nothing`, `application-only-domain`,
`infrastructure-no-presentation`, `presentation-allowed-imports`,
`only-main-imports-infrastructure`, plus `no-circular` and `not-to-unresolvable`, all
`severity: "error"`), run as `pnpm arch` from the root (FR-021). A violation fails with the
offending file, the target and the rule name; the clean tree passes with zero violations
(FR-022, SC-003). `apps/gateway/test/arch.test.ts` runs the same configuration through the
`cruise()` API over `apps/gateway/src` (US6-1) and over a fixture tree where each file breaks
exactly one rule (US6-2 … US6-5, nine tests). `.github/workflows/ci.yml` runs one job `ci`
on every pull request and on pushes to `main`: install → commitlint (PRs) → lint → typecheck
→ arch → test → build, failing at the first red step (FR-023, US6-6). Branch protection on
`main` (FR-024, US6-7) is a repository-settings change and waits for Alex's explicit go-ahead
(see Pending).

## Files touched

- `.dependency-cruiser.cjs` — the seven rules and options (`tsConfig` absolute, `tsPreCompilationDeps`, `doNotFollow` node_modules and `dist/`, `exclude` the gateway test tree).
- `package.json` — root script `arch` = `depcruise apps/gateway/src --config .dependency-cruiser.cjs --output-type err`; devDependency `dependency-cruiser` (`catalog:`).
- `pnpm-workspace.yaml` — catalog entry `dependency-cruiser: ^18.6.0`.
- `apps/gateway/package.json` — devDependency `dependency-cruiser` (`catalog:`) so the test imports it explicitly.
- `pnpm-lock.yaml` — dependency-cruiser 18.6.0 and its tree.
- `apps/gateway/test/arch.test.ts` — US6-1 … US6-5 through `cruise()`.
- `apps/gateway/test/arch-fixtures/**` — miniature repository (`apps/gateway/src/<layer>/`): four compliant stubs plus `main.ts`, and six one-line violation files (`domain-to-infra`, `domain-to-npm`, `domain-to-workspace-package`, `application-to-infra`, `presentation-to-infra`, `infra-to-presentation`); `README.md` explains the layout.
- `.github/workflows/ci.yml` — single job `ci`, actions pinned to commit SHAs, commented placeholders for evals (007) and docker build (OPS).
- `CLAUDE.md` — section 12: `pnpm arch` is real; CI sentence added.
- `README.md` — status line (contracts, gateway skeleton, arch + CI in place; next `T-001-06`).
- `docs/tasks/BACKLOG.md` — `T-001-05` row set to `done` (that row only).

## Decisions

- **`arch` is a root script, not a Turborepo task** (`tasks.md` T055 listed a turbo entry).
  Same reasoning as `lint` in `T-001-02`: the cruise is one fast run whose rule paths are
  relative to the repository root (`^apps/gateway/src/…`), and a per-package task would have
  to `cd` back to the root to keep them meaningful. When a second app gets rules, extend the
  root config and the `depcruise` arguments rather than adding a turbo task.
- **`tsConfig.fileName` is absolute** (`path.resolve(__dirname, "apps/gateway/tsconfig.json")`).
  With the relative name TypeScript's `parseJsonConfigFileContent` reported `TS18003: No
  inputs were found` on Windows, and the programmatic test runs with a different cwd and
  `baseDir`, where dependency-cruiser's `tsconfig-paths` plugin resolved the relative name
  against the wrong directory (`apps/gateway/apps/gateway/tsconfig.json`).
- **`doNotFollow` instead of `exclude` for `node_modules` and `dist/`** (`tasks.md` T054 said
  `exclude: "node_modules|dist|test"`). `exclude` removes the dependency *edge*, not only the
  module: with `dist/` excluded the edges to `packages/contracts/dist/index.d.ts` vanished
  from the cruise, so `domain-imports-nothing` could never see a `domain → @tamiz/contracts`
  import (US6-2 lists workspace packages explicitly). `doNotFollow` records the edge without
  descending into it. Only `^apps/gateway/test/` is excluded.
- **`only-main-imports-infrastructure` also excludes `domain/` and `application/` in its
  `from.pathNot`**, so a `domain → infrastructure` import trips exactly `domain-imports-nothing`
  and an `application → infrastructure` import exactly `application-only-domain`, as the
  spec names them. Presentation (and any stray folder) still trips
  `only-main-imports-infrastructure` (US6-4).
- **Fixtures are a miniature repository, cruised with `baseDir`** pointing at
  `apps/gateway/test/arch-fixtures/`. Each fixture path then reads `apps/gateway/src/<layer>/…`,
  so the production rules apply unchanged and the test needs no rule rewriting and no copying
  of files into `src/` (which `tasks.md` T053 suggested). The stubs import each other only in
  allowed directions and a dedicated test asserts they trip nothing.
- **No fixture for `presentation-allowed-imports`**: the only workspace package the gateway
  depends on is `@tamiz/contracts`, which is allowed; importing `@tamiz/test-utils` would
  trip `not-to-unresolvable` instead. Add the fixture when the gateway gains a second
  workspace dependency.
- **CI pins actions to commit SHAs** (`actions/checkout` v7.0.1, `pnpm/action-setup` v6.1.0,
  `actions/setup-node` v7.1.0); Renovate's `helpers:pinGitHubActionDigests` preset (already
  in `renovate.json`) keeps them current. `pnpm/action-setup` has no `version` input so it
  reads `packageManager`.
- **commitlint in CI calls the binary directly** (`pnpm exec commitlint --from <base sha> --to
  <head sha> --verbose`): the root script is `commitlint --edit` for the husky hook and cannot
  take a range. `--to` is the PR head, not `HEAD`, because `HEAD` on a `pull_request` run is
  the synthetic merge commit.
- **`pnpm test` without `--coverage`** in CI: coverage arrives with the root Vitest projects
  of `T-001-06` (R-12 wrote `pnpm test -- --coverage`; the turbo-per-package `test` of today
  has no coverage provider).
- **`concurrency` cancels superseded runs of the same ref** and `permissions: contents: read`
  is the job's only grant. Not in the plan; both are one-line hardening with no effect on
  the required status.
- **Backlog edit kept to the `T-001-05` row only.**

## How it was verified

```bash
pnpm install                    # dependency-cruiser 18.6.0 added; Done in 5.1s
pnpm build                      # Tasks: 3 successful (contracts dist/ needed by the cruise)

pnpm arch                       # T057 / US6-1
# ✔ no dependency violations found (20 modules, 26 dependencies cruised)      exit 0

# T058 / quickstart section 6 — deliberate domain → infrastructure import
echo 'import "../infrastructure/logging/logger";' >> apps/gateway/src/domain/result.ts
pnpm arch
#   error no-circular: apps/gateway/src/domain/result.ts →
#       apps/gateway/src/infrastructure/logging/logger.ts →
#       apps/gateway/src/infrastructure/config/env.ts →
#       apps/gateway/src/domain/result.ts
#   error domain-imports-nothing: apps/gateway/src/domain/result.ts → apps/gateway/src/infrastructure/logging/logger.ts
# x 2 dependency violations (2 errors, 0 warnings). 16 modules, 20 dependencies cruised.
#  ELIFECYCLE  Command failed with exit code 2.                                 exit 2
git checkout apps/gateway/src/domain/result.ts
pnpm arch                       # ✔ no dependency violations found

# Edge dump (depcruise --output-type json) confirms npm, core and workspace edges are recorded:
#   infrastructure/config/env.ts -> fs [core]; -> node_modules/.pnpm/zod@4.6.7/.../index.d.cts [npm]
#   presentation/middlewares/request-id.ts -> crypto [core]
#   presentation/routes/health.ts -> packages/contracts/dist/index.d.ts [not followed]

pnpm --filter @tamiz/gateway exec vitest run test/arch.test.ts      # US6-1 … US6-5
#  Test Files  1 passed (1)      Tests  9 passed (9)
# (first run, before the absolute tsConfig path: 8 failed with ENOENT …/apps/gateway/apps/gateway/tsconfig.json)

pnpm lint        # Checked 66 files in 31ms. No fixes applied.
pnpm typecheck   # Tasks: 4 successful, 4 total
pnpm test        # Tasks: 4 successful; gateway 8 files / 52 tests, contracts 6 files / 95 tests
pnpm build       # Tasks: 3 successful, 3 total
```

The second cycle in the deliberate-violation output is real: `infrastructure/config/env.ts`
imports `domain/result.ts`, so the injected import closes a loop. The spec only requires the
file and `domain-imports-nothing` to be named; both are.

CI on the pull request (US6-6): PR #6 https://github.com/AxelAxx/tamiz/pull/6, workflow run
39243909783 (`pull_request`), job `ci` **success** in 38 s on the first attempt. Steps in order:
Checkout → Set up pnpm → Set up Node.js → Install → Commit messages → Lint → Typecheck →
Architecture check → Test → Build, every one `success`. The PR shows one check, `ci`, and
`mergeStateStatus: CLEAN`.

Branch protection: see Pending.

The engine warning `Unsupported engine: wanted {"node":">=22 <23"} (current: v24.14.0)` is
printed by every pnpm command and is expected.

## Pending / follow-ups

- T059's optional deliberate lint-failure push was not done (the `ci` job already proves the
  step order and the single required status; a red push would only add noise to the history).
- **Branch protection on `main` (T060/T061, FR-024, US6-7)**: a repository-settings change,
  so it waits for Alex's explicit go-ahead in the chat. Command to run from the repository
  root once approved (classic protection, `ci` required with `strict`, PR required, no force
  pushes, no deletions, admins included):

  ```bash
  gh api -X PUT repos/AxelAxx/tamiz/branches/main/protection \
    -H "Accept: application/vnd.github+json" \
    --input - <<'JSON'
  {
    "required_status_checks": { "strict": true, "contexts": ["ci"] },
    "enforce_admins": true,
    "required_pull_request_reviews": { "required_approving_review_count": 0 },
    "restrictions": null,
    "allow_force_pushes": false,
    "allow_deletions": false
  }
  JSON
  gh api repos/AxelAxx/tamiz/branches/main/protection --jq '.required_status_checks.contexts'   # ["ci"]
  git push origin HEAD:main   # must be refused
  ```

  Until it runs, `main` accepts direct pushes; the command, its JSON response and the
  refused push go in this record when done.
- `presentation-allowed-imports` has no fixture (see Decisions); add one with the second
  workspace dependency of the gateway.
- `T-001-06` adds `pnpm test -- --coverage` to CI when the root Vitest projects exist
  (`tasks.md` T070/T072).

## Pitfalls for the next session

- **`pnpm arch` needs `packages/contracts/dist/`**: `@tamiz/contracts` is resolved through
  its `exports` → `dist/`, so on a fresh clone run `pnpm build` (or `pnpm typecheck`, whose
  turbo graph builds dependencies) before `pnpm arch`; otherwise `not-to-unresolvable` fires
  on every contracts import. CI's step order (typecheck before arch) already guarantees it.
- **dependency-cruiser `exclude` drops edges, `doNotFollow` keeps them.** If a rule must see
  a dependency on a library or package, that target must not be in `exclude`.
- **A relative `tsConfig.fileName` fails on Windows** with `TS18003: No inputs were found`;
  keep the `path.resolve(__dirname, …)` form.
- **`cruise()` resolves file arguments and reports paths relative to `options.baseDir`**
  (default `process.cwd()`), but `tsConfig.fileName` is resolved relative to the real cwd by
  the `tsconfig-paths` plugin; hence the absolute name.
- **The API does not read the tsconfig for you**: pass `extractTSConfig(file)` as
  `{ tsConfig }` in the fourth argument of `cruise()`, as the test does; `options.tsConfig`
  alone only feeds the resolver.
- **Vitest's gateway run has cwd `apps/gateway`**; the test derives the repository root from
  `import.meta.url` and never relies on cwd, so the root Vitest projects of `T-001-06` will
  run it unchanged.
- **Biome `organizeImports` reflows long import lines** (`import { cruise, type … }`); run
  `pnpm exec biome check --write <path>` before `pnpm lint`.
- The workflow's job is named `ci` (`jobs.ci.name: ci`): that string is the status-check
  context branch protection requires. Renaming the job breaks the protection silently.

## Links

- Spec / plan / tasks: `specs/001-contracts-and-skeleton/{spec,plan,tasks}.md` (Phase 4), `research.md` R-12, `quickstart.md` section 6
- ADRs: none added (the layering rule itself is constitution I / ADR-0001)
- Related task records: `docs/tasks/done/T-001-04-gateway-skeleton.md` (the tree under test, import directions checked by hand there), `docs/tasks/done/T-001-02-monorepo-tooling.md` (root `lint` decision mirrored by `arch`, machine pitfalls), `docs/tasks/done/T-OPS-00-github-remote.md` (branch protection deferred here)
