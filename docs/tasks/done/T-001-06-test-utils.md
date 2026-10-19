# T-001-06 — `packages/test-utils` and the root Vitest projects config

| Field | Value |
|---|---|
| Task | `T-001-06`, plus `T-001-07` folded in (see `docs/tasks/BACKLOG.md`) |
| Feature | `001-contracts-and-skeleton` |
| Spec | `specs/001-contracts-and-skeleton/spec.md` (US7, FR-025, FR-026, SC-001); `tasks.md` Phase 5 (T064–T073) and Phase 6 (T074, T075, T077); `research.md` R-02, R-09; `quickstart.md` section 7 |
| Branch / PR | `T-001-06-test-utils` / https://github.com/AxelAxx/tamiz/pull/7 |
| Date | 2026-10-19 |
| Session | Claude Code, side session started from the `T-001-04` session (began on Claude Fable 5.1, finished on Claude Opus 5.5 after Alex switched the model) |
| Status | done |

## What was done

`@tamiz/test-utils` now exports `createFakeClock(start = 2026-01-01T00:00:00Z)`, a plain
object with `now`, `advance` and `set` whose time only moves when the test says so, and
three builders (`chatCompletionRequest`, `chatCompletionResponse`, `healthResponse`) that
merge per-field overrides into valid defaults and parse the result with the contract
schema, so a bad override throws (FR-025). A root `vitest.config.ts` declares
`test.projects: ["packages/*", "apps/*"]` with v8 coverage (text + lcov), and the root
`pnpm test` runs every package in one Vitest process (FR-026). The gateway's `/health`
test uses the shared fake clock instead of its local one. US7-1 and US7-2 map to named
tests in `fake-clock.test.ts` and `builders.test.ts`, written before the implementation.
US7-3 is the root run below: three projects reported and a coverage table printed.

## Files touched

- `packages/test-utils/package.json` — dependency `@tamiz/contracts` (`workspace:*`); `test` no longer passes `--passWithNoTests`.
- `packages/test-utils/src/fake-clock.ts` — `createFakeClock`, `FakeClock` type.
- `packages/test-utils/src/builders.ts` — three builders and their override types.
- `packages/test-utils/src/index.ts` — re-exports; the placeholder constant is gone.
- `packages/test-utils/vitest.config.ts` — node environment, `test/**/*.test.ts`.
- `packages/test-utils/test/{fake-clock,builders}.test.ts` — US7-1, US7-2 and the failure cases.
- `packages/test-utils/README.md` — export table and the R-09 note.
- `vitest.config.ts` (root) — projects and coverage.
- `package.json` (root) — `test` and `test:packages` scripts; dev `vitest`, `@vitest/coverage-v8`.
- `pnpm-workspace.yaml` — `@vitest/coverage-v8` in the catalog next to `vitest`.
- `apps/gateway/package.json` — dev `@tamiz/test-utils`.
- `apps/gateway/test/health.test.ts` — `createFakeClock` replaces `fixedClock`.
- `README.md` — Status and Developing sections (T074).
- `CLAUDE.md` — section 12 test commands (T075).
- `specs/001-contracts-and-skeleton/quickstart.md` — section 7 uses `pnpm test --coverage`.
- `pnpm-lock.yaml`.
- `.github/workflows/ci.yml` — Test step is `pnpm test --coverage` (`T-001-07`, T056/T072).
- `docs/tasks/BACKLOG.md` — `T-001-06` row set to `done`; row `T-001-07` added and set to `done`. The merge from `main` also carries `T-001-05`'s own `done`.

## Decisions

- **`ClockPort` stays structural (research R-09).** `ClockPort` is declared in
  `apps/gateway/src/application/ports/clock.port.ts` as `{ now(): Date }`; the fake clock
  satisfies it by shape, and `test-utils` never imports from an app. A test asserts the
  shape without importing the port. **Revisit when a second port needs sharing between
  the gateway and this package**, most likely `PolicyRepositoryPort` for
  `InMemoryPolicyRepository` in feature 002 (`T-002-02` onwards): then move port *types*
  into a `@tamiz/ports` package instead of importing the app. Not done now
  (constitution X).
- **The fake clock stores milliseconds and returns a fresh `Date` on every read.** The
  hand-made gateway clock returned the same `Date` object, so a caller could mutate the
  clock by mutating what it read. A test pins this, and another that the `Date` passed in
  is never mutated.
- **Root `test` is `turbo run build && vitest run`, not bare `vitest run`.** Workspace
  packages resolve `@tamiz/contracts` and `@tamiz/test-utils` through their `dist/`
  entry points, so a bare `vitest run` on a fresh clone fails with *Failed to resolve
  entry for package*. The Turborepo build is cached, so a warm run adds well under a
  second. `test:packages` keeps the cached per-package run (R-02).
- **`pnpm test --coverage`, not `pnpm test -- --coverage`.** pnpm 10 forwards the literal
  `--` to the script (`vitest run "--" "--coverage"`), and Vitest then treats
  `--coverage` as a positional argument: tests run, no coverage. Quickstart section 7 now
  says `pnpm test --coverage`. `research.md` line 202 and `tasks.md` T056/T072 keep the
  old wording as written history; the CI step uses the working form.
- **Coverage `include` is `packages/*/src/**/*.ts` and `apps/*/src/**/*.ts`**, not
  `src/**` as `tasks.md` T070 wrote. The gateway's layer `README.md` files live under
  `src/`, and v8 coverage tried to parse them as JavaScript and printed a parse error per
  file.
- **Coverage is configured only at the root.** Each package keeps its own
  `vitest.config.ts` (include patterns, contracts' type tests); Vitest collects coverage
  once for all projects, so a per-package coverage block would be dead config.
- **Builder overrides are the contract types, except `uptimeMs` as a plain `number`.** The
  schema brands it on the way out, so tests write `healthResponse({ uptimeMs: 10 })`
  without calling the `milliseconds()` constructor.
- **`InMemoryPolicyRepository` placeholder from the backlog row not created.** `tasks.md`
  Phase 5 does not list it and there is no `PolicyRepositoryPort` yet; an empty fake would
  be the speculative abstraction constitution X forbids. It arrives with its port in
  feature 002.
- **Coverage thresholds not set.** The spec asks for a coverage summary, not a gate.
  Current totals: statements 84.37 %, branches 75 %, functions 92.45 %, lines 84.12 %;
  the gaps are `main.ts`, `system-clock.ts` (exercised only by the spawned boot test, which
  v8 does not instrument) and `error-envelope.ts` mappers for domain errors that no route
  returns yet.

## How it was verified

```bash
pnpm --filter @tamiz/test-utils test
# before src/: Test Files 2 failed (2)  — module not found for ../src/fake-clock.js, ../src/builders.js
# after:       Test Files 2 passed (2)   Tests 17 passed (17)

pnpm test --coverage            # from the root
#  Test Files 15 passed (15)   Tests 155 passed (155)   Type Errors no errors
#  % Coverage report from v8
#  All files | 84.37 | 75 | 92.45 | 84.12
#  coverage/lcov.info lists 20 source files across apps/gateway, packages/contracts, packages/test-utils

pnpm exec vitest run --reporter=verbose | grep -o "|@tamiz/[a-z-]*|" | sort | uniq -c
#   95 |@tamiz/contracts|   43 |@tamiz/gateway|   17 |@tamiz/test-utils|      (US7-3)

pnpm test:packages   # Tasks: 5 successful; test-utils 17, contracts 95, gateway 43
pnpm lint            # Checked 59 files. No fixes applied.
pnpm typecheck       # Tasks: 5 successful
pnpm build           # Tasks: 3 successful
pnpm arch            # after merging main (T-001-05): no dependency violations found (20 modules, 26 dependencies cruised)
pnpm test --coverage # after merging main: Test Files 16 passed, Tests 164 passed (arch.test.ts runs in the gateway project)
```

**SC-001 timing (T077).** Fresh `git clone` of this branch into a short temporary folder,
then the quickstart sequence:

```bash
time (pnpm install && pnpm lint && pnpm typecheck && pnpm arch && pnpm test --coverage && pnpm build)
# before T-001-05 merged: exit 0, 12 s (install 3.3 s, arch a placeholder)
# after merging main:     exit 0, 13 s (install 3.5 s, arch real, 164 tests)
```

The pnpm content store on this machine was warm, so the install is a best case; a cold
store adds the download time. Both are well inside the 5-minute target. The CI-side number
(under 10 minutes) is measured on `T-001-05`'s PR #6: 38 s.

## Pending / follow-ups

- **`T-001-07` was folded into this PR.** It was split out while `T-001-05` (PR #6) was
  open, because `.github/workflows/ci.yml` did not exist on this branch's base. Alex then
  approved merging PR #6 (squash, `e41129f`); this branch merged `main`, resolved
  conflicts in `README.md`, `CLAUDE.md` section 12, `BACKLOG.md`, `package.json` and the
  lockfile, and changed the CI Test step. The row is `done` in the same PR.
- Fakes for the remaining ports (`FakeLlmProvider`, `FakePiiDetector`, `InMemoryAuditLog`,
  `InMemoryCircuitState`, `InMemoryPolicyRepository`) arrive with their ports.

## Pitfalls for the next session

- **Vitest shortens the coverage table when it detects an AI agent.** Under Claude Code
  the `text` reporter switches to `skipFull: true` and adds `text-summary`, so fully
  covered files disappear from the table. In a normal terminal and in CI every file is
  listed. Check `coverage/lcov.info` (`grep ^SF:`) for the real file list.
- **`pnpm <script> -- --flag` passes a literal `--`** with pnpm 10; put flags straight
  after the script name.
- **Windows MAX_PATH breaks a clone under the session scratchpad.** The scratchpad path is
  long enough that `biome.exe` inside `node_modules/.pnpm/...` exceeds 260 characters and
  `pnpm lint` fails with `spawnSync ... ENOENT`. Clone into a short folder (for example
  `%TEMP%\t006`) for fresh-clone checks.
- **Coverage `include` with `src/**` picks up Markdown** under `src/`; keep the `*.ts`
  suffix.
- **Vitest reports projects by `package.json` name** (`|@tamiz/gateway|`), not by folder.
- The `apps/dashboard` and `apps/mcp-server` folders only hold a README; Vitest skips a
  glob match without a `package.json` or config, so they need no exclusion until they gain
  one. When they do, they become projects automatically.

## Links

- Spec / plan / tasks: `specs/001-contracts-and-skeleton/{spec,plan,tasks}.md` (Phases 5 and 6), `research.md` R-02, R-09, `quickstart.md` section 7
- ADRs: none added
- Related task records: `docs/tasks/done/T-001-04-gateway-skeleton.md` (clock port, `health.test.ts`), `docs/tasks/done/T-001-03-contracts-package.md` (schemas the builders parse), `docs/tasks/done/T-001-02-monorepo-tooling.md` (catalog, turbo `test.outputs`); `docs/tasks/done/T-001-05-architecture-and-ci.md`
