# Research: Contracts and Skeleton

**Feature**: `001-contracts-and-skeleton` · **Date**: 2026-10-18

Each entry: decision, rationale, alternatives. Versions were checked against the
libraries' current documentation on 2026-10-18 (Context7). Exact minor versions are
pinned by `pnpm install` at implementation time and kept current by Renovate.

## R-01 Package manager and runtime pinning

**Decision**: pnpm 10 via the `packageManager` field (`"pnpm@10.x"`) and Corepack
(`corepack enable pnpm`), `.nvmrc` = `22`, `engines.node` = `>=22 <23`. No
`engine-strict` in `.npmrc`.

**Rationale**: pnpm is not installed on the development machine (T-000-01 record);
Corepack ships with Node 22 and honours `packageManager`, so one command installs the
right pnpm. The machine runs Node 24; `engines` makes the mismatch visible as a warning
without blocking local work, while CI runs on 22 and is authoritative (FR-002).

**Alternatives**: `npm i -g pnpm` (works, but not pinned per repository);
`engine-strict=true` (would block the maintainer's Node 24 until nvm/fnm is set up;
can be enabled later).

## R-02 Workspace orchestration

**Decision**: Turborepo 2 with `turbo.json` `tasks`: `lint`, `typecheck`, `arch`,
`test` (`outputs: ["coverage/**"]`), `build` (`dependsOn: ["^build"]`,
`outputs: ["dist/**"]`). Root scripts call `turbo run <task>` with two exceptions: `pnpm arch` runs
dependency-cruiser once at the root (not per package) because the rules only cover
`apps/gateway/src`, and `pnpm test` runs `vitest run` with `test.projects` so one process
reports every package and a single coverage table (`pnpm test:packages` keeps the cached
per-package Turborepo run).

**Rationale**: the stack of `CLAUDE.md` section 4; caching keeps CI under the 10 min
target. Running each step on every PR is guaranteed by Turborepo's hashing: a cache hit
replays the recorded success, a changed input re-runs.

**Alternatives**: plain `pnpm -r run` (no caching, fine for 4 packages but the project
grows to 8); Nx (heavier, no need).

## R-03 Lint and format

**Decision**: Biome 2, single root `biome.json` with `"root": true`,
`linter.rules.recommended: true`, `suspicious.noExplicitAny: "error"`,
`style.noNonNullAssertion: "error"`, formatter 2-space / 100 columns / double quotes.
Packages do not need nested configs; if one ever does, it uses `"extends": "//"`.

**Rationale**: one binary for lint + format; `noExplicitAny` enforces constitution VII
at lint time in addition to `tsc`.

**Alternatives**: ESLint + Prettier (two tools, slower; rejected by the stack).

## R-04 TypeScript configuration

**Decision**: `packages/tsconfig/base.json` with `strict`, `noUncheckedIndexedAccess`,
`exactOptionalPropertyTypes`, `noImplicitOverride`, `noFallthroughCasesInSwitch`,
`verbatimModuleSyntax`, `module: NodeNext`, `moduleResolution: NodeNext`,
`target: ES2022`, `isolatedModules`, `resolveJsonModule` (the gateway imports its
`package.json` for the version), `skipLibCheck`. `library.json` adds `declaration`,
`declarationMap`, `sourceMap`, `composite`. `node-app.json` for the gateway (no
`declaration`). Every package is ESM (`"type": "module"`). Builds use `tsc -p
tsconfig.build.json` into `dist/`; the gateway runs `tsx src/main.ts` in dev and
`node dist/main.js` in production.

**Rationale**: constitution VII flags; NodeNext matches Node 22 ESM resolution;
`verbatimModuleSyntax` keeps type-only imports explicit, which also helps
dependency-cruiser classify `type-only` dependencies.

**Alternatives**: `tsup`/`esbuild` bundling (unneeded for libraries consumed inside the
workspace; revisit for Docker images in OPS).

## R-05 Commit convention enforcement

**Decision**: `@commitlint/cli` + `@commitlint/config-conventional` with husky 9:
`.husky/commit-msg` runs `pnpm commitlint --edit "$1"`; root script
`"prepare": "husky"`. `commitlint.config.ts` extends the conventional preset and allows
the types listed in the constitution. CI additionally runs
`commitlint --from <base> --to HEAD` on pull requests so platform-generated merge
messages (which commitlint ignores by default via `defaultIgnores`) and squash messages
are both covered.

**Rationale**: the documented, most common pairing; `defaultIgnores` already accepts
merge/revert messages (FR-004 edge case).

**Alternatives**: `simple-git-hooks` or `lefthook` (smaller, but husky is what commitlint
documents and what reviewers expect); `commitizen` (interactive, unnecessary).

## R-06 Dependency updates

**Decision**: `renovate.json` extending `config:recommended`, `:semanticCommits`,
`group:allNonMajor` with a weekly schedule, `rangeStrategy: "bump"`, and pinning of
GitHub Actions digests. The Renovate GitHub App must be installed by Alex on
`AxelAxx/tamiz` (one-time manual step, recorded in the `T-001-02` task record).

**Rationale**: FR-005 asks for grouped non-major updates; semantic commits keep the
commit convention intact for bot PRs.

**Alternatives**: Dependabot (built in, but weaker grouping and no monorepo-aware
pnpm lockfile maintenance).

## R-07 Schema library

**Decision**: Zod 4 (`import { z } from "zod"`). Objects are declared with
`z.strictObject` so unknown keys are rejected (FR-007). Branded types use
`z.string().brand<"RequestId">()` / `z.number().brand<"Usd">()` plus small constructor
functions (`requestId(value)`, `usd(value)`) that parse and return the branded value
(FR-011). Inferred types via `z.infer`.

**Rationale**: Zod 4 is the current major, is supported by `@hono/zod-validator` and by
AI SDK 6 (feature 002), and its `.brand()` gives nominal typing without a hand-rolled
`unique symbol` pattern. Branding is static only; the runtime schema still validates
the primitive.

**Alternatives**: hand-written `type RequestId = string & { readonly __brand: unique
symbol }` (works, but duplicates the runtime check); Valibot (smaller, but not the
chosen stack).

## R-08 HTTP framework and request id

**Decision**: Hono 4 with `@hono/node-server`'s `serve()`. `createApp(deps)` in
`presentation/app.ts` returns a `Hono` instance so tests call `app.request("/health")`
without sockets (US3 scenario 2). Request ids use Hono's built-in `requestId()`
middleware configured with `limitLength: 128` and the default header `X-Request-Id`;
malformed client values are replaced by a generated UUID (edge case in spec). `app.notFound`
and `app.onError` map to `ErrorEnvelope` via `presentation/mappers/error-envelope.ts`
(FR-019). `@hono/zod-validator` is added now as a dependency but first used by the chat
endpoint in feature 002.

**Rationale**: in-process testing is the constitution's presentation-layer test type;
the built-in middleware already validates the header's charset and length.

**Alternatives**: Fastify (has its own schema story that competes with Zod);
Express (no Web-standard `Request`, harder to test in-process).

## R-09 Where `ClockPort` lives and how `FakeClock` implements it

**Decision**: `ClockPort` is declared in `apps/gateway/src/application/ports/clock.port.ts`
as `{ now(): Date }`. `@tamiz/test-utils` exports `createFakeClock(start: Date)` returning
`{ now(): Date; advance(ms: number): void; set(date: Date): void }`. The fake satisfies
the port structurally; `test-utils` does not import from `apps/gateway` (an app is not a
dependency of a library).

**Rationale**: constitution X forbids a package just to share one interface; TypeScript
structural typing makes the shape contract explicit enough. If a second port needs
sharing (feature 002 `InMemoryPolicyRepository`), revisit by moving port *types* into a
`@tamiz/ports` package (tracked as a note in the `T-001-06` record, not done now).

**Alternatives**: `test-utils` depending on `apps/gateway` via workspace (inverts the
dependency direction and pulls the app into every library test); a `@tamiz/ports`
package now (speculative).

## R-10 Logger and redaction

**Decision**: pino 10 with
`redact: { paths: ["prompt", "messages", "authorization", "req.headers.authorization", "body.prompt", "body.messages", "*.prompt", "*.messages", "*.authorization"], censor: "[REDACTED]" }`,
`level` from config, `base: { service: "tamiz-gateway" }`, ISO timestamps. The logger is
created in `infrastructure/logging/logger.ts` and injected; tests capture output with a
pino `destination` stream in memory.

**Rationale**: FR-016 paths; pino's path syntax supports single-level wildcards
(`*.messages`) but not deep (`**`), so the covered depths are listed explicitly and the
spec's "depth the project agrees to cover" is exactly this list.

**Alternatives**: winston (slower, no built-in redaction); a custom serializer
(reinventing pino's fast-redact).

## R-11 Environment configuration

**Decision**: `infrastructure/config/env.ts` declares
`EnvSchema = z.object({ PORT: z.coerce.number().int().min(1).max(65535).default(3000), HOST: z.string().default("0.0.0.0"), LOG_LEVEL: z.enum([...]).default("info"), NODE_ENV: z.enum(["development","test","production"]).default("development"), APP_VERSION: z.string().optional() })`
and `loadConfig(env: NodeJS.ProcessEnv): Result<GatewayConfig, ConfigurationError>`.
`main.ts` prints `issue.path` + `issue.message` for each issue to stderr and exits with
code 1 before `serve()`. Secret-looking values are never echoed (only paths and the
expected format). `version` resolves to `APP_VERSION ?? package.json version`.

**Rationale**: FR-015, constitution VI. Returning `Result` makes scenario US4-3 a unit
test; the child-process test covers the exit code once.

**Alternatives**: `dotenv` + manual checks (no schema); `envalid`/`t3-env` (another
dependency doing what Zod already does).

## R-12 Architecture rules and CI

**Decision**: one root `.dependency-cruiser.cjs` run as
`depcruise apps/gateway/src --config .dependency-cruiser.cjs --output-type err` with
`tsConfig: { fileName: "apps/gateway/tsconfig.json" }` and `tsPreCompilationDeps: true`.
Rules (all `severity: "error"`):

| Rule | from | to (forbidden) |
|---|---|---|
| `domain-imports-nothing` | `^apps/gateway/src/domain/` | anything not under `^apps/gateway/src/domain/` (including npm and core) |
| `application-only-domain` | `^apps/gateway/src/application/` | `^apps/gateway/src/(infrastructure|presentation)/` or `^apps/gateway/src/main\.ts$` |
| `infrastructure-no-presentation` | `^apps/gateway/src/infrastructure/` | `^apps/gateway/src/presentation/` or `main.ts` |
| `presentation-allowed-imports` | `^apps/gateway/src/presentation/` | `main.ts`, or any `@tamiz/*` other than `@tamiz/contracts` (infrastructure is covered by the rule below, so a violation trips exactly one rule) |
| `only-main-imports-infrastructure` | `pathNot: ^apps/gateway/src/(main\.ts$|infrastructure/)` | `^apps/gateway/src/infrastructure/` |

Plus the stock `no-circular` and `not-to-unresolvable` rules. Exit code equals the number
of violations, so `pnpm arch` fails CI.

CI: `.github/workflows/ci.yml`, one job named `ci` on `ubuntu-latest`, Node 22 from
`.nvmrc`, pnpm from `packageManager` via `pnpm/action-setup`, pnpm store cache, steps in
order `pnpm lint` → `pnpm typecheck` → `pnpm arch` → `pnpm test -- --coverage` →
`pnpm build`, plus `commitlint --from ${{ github.event.pull_request.base.sha }}` on PRs.
Commented placeholders mark where `evals` (007) and `docker build` (OPS) go. Branch
protection is configured with `gh api` (classic protection on `main`: require the `ci`
status check, require PR, no force pushes, admins included) and the exact command goes in
the `T-001-05` record.

**Rationale**: FR-021 … FR-024; one job means one required status, which keeps branch
protection simple and matches SC-006.

**Alternatives**: `eslint-plugin-boundaries` (ties us to ESLint); a matrix of jobs (more
statuses to require, slower cold start); GitHub rulesets instead of classic protection
(equivalent; classic is enough for a single-maintainer repository and has a simpler API).
