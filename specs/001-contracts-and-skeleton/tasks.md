---

description: "Task list for feature 001-contracts-and-skeleton"
---

# Tasks: Contracts and Skeleton

**Input**: Design documents from `specs/001-contracts-and-skeleton/`

**Prerequisites**: `plan.md`, `spec.md`, `research.md` (R-01 … R-12), `data-model.md`,
`contracts/openapi.yaml`, `quickstart.md`

**Tests**: Mandatory. Constitution III requires every Given/When/Then of `spec.md` to map
one-to-one to a test or pipeline step; the "Scenario" column below is that mapping. Write
each test before the code it covers and watch it fail first.

**Organization**: Phases are the backlog tasks `T-001-02` … `T-001-06` of
`docs/tasks/BACKLOG.md`, because a backlog task is the session-sized unit and one pull
request. The `[USn]` label keeps the mapping to the spec's user stories. Within a phase,
the order is tests → implementation → verification.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel with its neighbours (different files, no dependency on an
  unfinished task).
- **[Story]**: user story of `spec.md` (`US1` … `US7`).
- Paths are repository-relative.

## Scenario coverage

| Spec scenario | Task | Spec scenario | Task |
|---|---|---|---|
| US1-1 install | T014 | US4-1 invalid env exits | T040 |
| US1-2 lint/typecheck/test green | T014 | US4-2 defaults | T039 |
| US1-3 bad commit refused | T015 | US4-3 `loadConfig` Result | T039 |
| US1-4 good commit accepted | T015 | US5-1 top-level redaction | T041 |
| US1-5 root manifest fields | T014 | US5-2 nested redaction | T041 |
| US2-1 valid request accepted | T020 | US5-3 JSON line + level filter | T041 |
| US2-2 unknown field rejected | T020 | US6-1 compliant tree passes | T057 |
| US2-3 wrong type rejected | T020 | US6-2 domain rule | T058 |
| US2-4 `stream: true` rejected | T020 | US6-3 application rule | T058 |
| US2-5 valid response accepted | T021 | US6-4 presentation / main rule | T058 |
| US2-6 health statuses | T022 | US6-5 infrastructure rule | T058 |
| US2-7 error envelope types | T023 | US6-6 pipeline order + single status | T062 |
| US2-8 brand assignability | T024 | US6-7 branch protection | T063 |
| US2-9 package builds | T030 | US7-1 fake clock | T066 |
| US3-1 `/health` 200 + contract | T037 | US7-2 builders | T067 |
| US3-2 in-process `app.request` | T037 | US7-3 root test run + coverage | T072 |
| US3-3 404 envelope | T038 | Edge cases (contracts) | T020, T021, T022 |
| US3-4 `x-request-id` echo / generate | T038 | Edge cases (request id malformed) | T038 |

---

## Phase 1: `T-001-02` — Monorepo tooling (US1)

**Goal**: one workspace, one command per gate, commit convention enforced, dependency bot
configured. Deliverables and definition of done: backlog row `T-001-02`.

**Independent test**: `quickstart.md` section 1.

**Branch**: `T-001-02-monorepo-tooling`.

### Setup

- [ ] T001 Install pnpm 10 through Corepack (`corepack enable pnpm`) and confirm
  `pnpm --version`; record the exact version for `packageManager` (R-01)
- [ ] T002 Create root `package.json`: `"name": "tamiz"`, `"private": true`,
  `"license": "Apache-2.0"`, `"type": "module"`, `"packageManager": "pnpm@10.x.y"`,
  `"engines": { "node": ">=22 <23" }`, scripts `lint`, `format`, `typecheck`, `arch`
  (placeholder `echo "arch: configured in T-001-05"`), `test`, `build`, `prepare: husky`,
  `commitlint` (FR-001, FR-002)
- [ ] T003 [P] Create `pnpm-workspace.yaml` with `packages: ["apps/*", "packages/*"]`
  and `.npmrc` with `auto-install-peers=true`, `strict-peer-dependencies=false` (R-01)
- [ ] T004 [P] Create `.nvmrc` containing `22` (FR-002)
- [ ] T005 [P] Create `turbo.json` (Turborepo 2 `tasks`): `lint`, `typecheck`, `test`
  (`outputs: ["coverage/**"]`), `build` (`dependsOn: ["^build"]`, `outputs: ["dist/**"]`);
  install `turbo` as a root devDependency (R-02)
- [ ] T006 [P] Create `biome.json`: `"root": true`, recommended rules,
  `suspicious.noExplicitAny: "error"`, `style.noNonNullAssertion: "error"`, formatter
  2 spaces / line width 100 / double quotes, ignore `dist`, `coverage`, `node_modules`,
  `.turbo`; install `@biomejs/biome` (R-03, FR-003)
- [ ] T007 [P] Create `packages/tsconfig/package.json` (`@tamiz/tsconfig`, private) and
  `packages/tsconfig/{base,library,node-app}.json` with the flags of R-04 (`strict`,
  `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`,
  `resolveJsonModule`, `module`/`moduleResolution: NodeNext`, `target: ES2022`); install
  `typescript` at the root (FR-003)
- [ ] T008 [P] Create `commitlint.config.ts` extending `@commitlint/config-conventional`
  with `type-enum` = `feat, fix, chore, docs, test, refactor, ci, build, perf, style,
  revert`; install `@commitlint/cli`, `@commitlint/config-conventional`, `husky`; create
  `.husky/commit-msg` running `pnpm commitlint --edit "$1"` (R-05, FR-004)
- [ ] T009 [P] Create `renovate.json`: `extends: ["config:recommended", ":semanticCommits",
  "group:allNonMajor", "helpers:pinGitHubActionDigests"]`, `schedule: ["before 6am on
  monday"]`, `rangeStrategy: "bump"`, `lockFileMaintenance.enabled: true` (R-06, FR-005)
- [ ] T010 Create empty-but-valid workspace members so the gates have something to run:
  `packages/contracts/package.json` (`@tamiz/contracts`, scripts `lint`, `typecheck`,
  `test` placeholder `vitest run --passWithNoTests`, `build`), `packages/test-utils/package.json`
  (`@tamiz/test-utils`), `apps/gateway/package.json` (`@tamiz/gateway`), each with a
  `tsconfig.json` extending `@tamiz/tsconfig` and an empty `src/index.ts`; install `vitest`
  at the root (filled in by later phases)
- [ ] T011 Update the README of each new workspace package (`packages/contracts/README.md`,
  `packages/test-utils/README.md`, `packages/tsconfig/README.md`, `apps/gateway/README.md`)
  with the scripts they expose
- [ ] T012 Add `.gitignore` entries for `node_modules`, `dist`, `coverage`, `.turbo`,
  `*.tsbuildinfo` (keep the existing entries from `T-000-01`)
- [ ] T013 Run `pnpm install` and commit `pnpm-lock.yaml`

### Verification (tests for US1)

- [ ] T014 [US1] Run `pnpm install && pnpm lint && pnpm typecheck && pnpm test && pnpm build`
  on the fresh tree; every command exits 0 and Turborepo lists the three packages with
  scripts (US1-1, US1-2); assert the root manifest fields of US1-5 with a Vitest test
  `apps/gateway/test/root-manifest.test.ts` that reads `../../../package.json` (private,
  licence, engines); a root-level test file would not run until T070
- [ ] T015 [US1] Verify the hook: `git commit --allow-empty -m "wip"` is refused;
  `git commit --allow-empty -m "chore: verify hook"` is accepted (then reset) (US1-3,
  US1-4); paste both outputs in the task record
- [ ] T016 Write `docs/tasks/done/T-001-02-monorepo-tooling.md` (from
  `docs/tasks/TEMPLATE.md`), including the Renovate app installation as a manual step for
  Alex, and set `T-001-02` to `done` in `docs/tasks/BACKLOG.md` in the same commit

**Checkpoint**: fresh clone → all gates green on an empty workspace.

---

## Phase 2: `T-001-03` — `@tamiz/contracts` (US2)

**Goal**: the four Zod 4 schemas and the four branded types, with tests for every
scenario and a consumable build. Field rules: `data-model.md` sections 1–5.

**Independent test**: `quickstart.md` section 2.

**Branch**: `T-001-03-contracts-package`. Depends on Phase 1.

### Tests first

- [ ] T017 [P] [US2] Add `zod` (v4) as the only runtime dependency of
  `packages/contracts`; set `"exports": { ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" } }`
  and `tsconfig.build.json` extending `@tamiz/tsconfig/library.json` (FR-012)
- [ ] T018 [P] [US2] Create fixtures `packages/contracts/test/fixtures/chat-completion.ts`
  with one valid request, one valid response and the invalid corpus of SC-004: unknown
  top-level field, `temperature: "hot"`, `messages: "hello"`, empty `messages`, role
  `"tool"`, `stream: true`, `temperature: 2.5`, `max_tokens: 0`, `choices: []`
- [ ] T019 [P] [US2] Create `packages/contracts/vitest.config.ts` (node environment,
  `typecheck.enabled: true` for `*.test-d.ts`)
- [ ] T020 [P] [US2] Write `packages/contracts/test/chat-completion-request.test.ts`:
  valid request accepted and typed (US2-1); unknown field rejected and the issue path
  names it (US2-2); wrong types rejected with path and expected type (US2-3);
  `stream: true` rejected (US2-4); edge cases empty `messages`, unknown `role`,
  `temperature` outside `[0, 2]`, `max_tokens` not a positive integer rejected
- [ ] T021 [P] [US2] Write `packages/contracts/test/chat-completion-response.test.ts`:
  valid response accepted (US2-5); `choices: []` rejected; unknown field rejected
- [ ] T022 [P] [US2] Write `packages/contracts/test/health.test.ts`: `{ status: "ok",
  version, uptimeMs }` accepted; `status: "degraded"` with non-empty `checks` accepted;
  `status: "degraded"` without `checks` rejected; `status: "meh"` rejected (US2-6)
- [ ] T023 [P] [US2] Write `packages/contracts/test/error.test.ts`: each of the seven
  `error.type` values accepted, unknown type rejected, optional `requestId` must be a
  valid `RequestId` (US2-7)
- [ ] T024 [P] [US2] Write `packages/contracts/test/branded.test-d.ts` with
  `expectTypeOf` / `// @ts-expect-error`: `Usd` not assignable to `Milliseconds`,
  `RequestId` not assignable to `PolicyId`, plain `string` not assignable to `RequestId`
  (US2-8); and `packages/contracts/test/branded.test.ts` for the runtime constraints of
  `data-model.md` section 1 (`requestId("")` throws, `usd(-1)` throws,
  `milliseconds(1.5)` throws, `safeRequestId("bad id")` returns `success: false`)

### Implementation

- [ ] T025 [P] [US2] Implement `packages/contracts/src/branded.ts`: `RequestIdSchema`
  (`z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/).brand<"RequestId">()`),
  `PolicyIdSchema` (max 64, same regex), `UsdSchema` (`z.number().finite().min(0)`),
  `MillisecondsSchema` (`z.number().int().finite().min(0)`), inferred types, constructors
  `requestId`, `policyId`, `usd`, `milliseconds` and `safe*` variants (FR-011, R-07)
- [ ] T026 [P] [US2] Implement `packages/contracts/src/chat-completion.ts`:
  `ChatMessageSchema` (`role: z.enum(["system","user","assistant"])`, `content: z.string()`),
  `ChatCompletionRequestSchema` (`z.strictObject`; `model` min 1; `messages` min 1;
  `temperature` optional `min(0).max(2)`; `max_tokens` optional `int().positive()`;
  `stream` optional `z.literal(false)`; `user` optional `max(256)`),
  `ChatCompletionChoiceSchema`, `ChatCompletionUsageSchema`,
  `ChatCompletionResponseSchema` (`object: z.literal("chat.completion")`, `created`
  `int().min(0)`, `choices` min 1) and inferred types (FR-006, FR-007, FR-008)
- [ ] T027 [P] [US2] Implement `packages/contracts/src/health.ts`: `HealthCheckSchema`,
  `HealthResponseSchema` (`strictObject`, `status: z.enum(["ok","degraded"])`, `version`
  min 1, `uptimeMs: MillisecondsSchema`, `checks` optional min 1) with a `superRefine`
  that requires `checks` when `status === "degraded"` (FR-009)
- [ ] T028 [P] [US2] Implement `packages/contracts/src/error.ts`: `ErrorTypeSchema`
  (`z.enum([...])` with the seven values of `data-model.md` section 5),
  `ErrorEnvelopeSchema` (`strictObject`, `error: { type, message: z.string(), requestId?:
  RequestIdSchema }`) and the `errorTypeToHttpStatus` map (FR-010)
- [ ] T029 [US2] Implement `packages/contracts/src/index.ts` re-exporting every schema,
  type, constructor and the status map
- [ ] T030 [US2] Build (`pnpm --filter @tamiz/contracts build`) and verify the `dist/`
  entry point exports schemas and types (US2-9); run `pnpm lint typecheck test` from the
  root
- [ ] T031 Write `docs/tasks/done/T-001-03-contracts-package.md` and set `T-001-03` to
  `done` in `docs/tasks/BACKLOG.md`

**Checkpoint**: `pnpm --filter @tamiz/contracts test` green, including type tests.

---

## Phase 3: `T-001-04` — Gateway skeleton (US3, US4, US5)

**Goal**: Clean Architecture folders with real modules, `Result`, `DomainError`,
validated config, redacting logger, `GET /health`, 404/500 envelopes, request id.

**Independent test**: `quickstart.md` sections 3, 4, 5.

**Branch**: `T-001-04-gateway-skeleton`. Depends on Phase 2.

### Setup

- [ ] T032 Add dependencies to `apps/gateway/package.json`: `hono`, `@hono/node-server`,
  `@hono/zod-validator`, `zod`, `pino`, `@tamiz/contracts` (`workspace:*`); dev: `tsx`,
  `pino-pretty` (dev only), `@types/node`; scripts `dev: tsx watch src/main.ts`,
  `start: node dist/main.js`, `build: tsc -p tsconfig.build.json`, `test: vitest run`
  (R-08, R-10)
- [ ] T033 [P] Create the layer folders with a README each:
  `apps/gateway/src/{domain,application,infrastructure,presentation}/README.md`, one
  paragraph per folder stating what may be imported (FR-013)

### Tests first

- [ ] T034 [P] [US3] Write `apps/gateway/test/result.test.ts` for `ok`, `err`, `isOk`,
  `isErr`, `map`, `mapErr`, `andThen`, `unwrapOr` and an exhaustive `switch` over
  `DomainError.kind` (FR-014)
- [ ] T035 [P] [US4] Write `apps/gateway/test/env.test.ts`: `loadConfig({})` returns
  `ok` with the defaults `port 3000`, `host "0.0.0.0"`, `logLevel "info"`, `nodeEnv
  "development"` (US4-2); `loadConfig({ PORT: "abc", LOG_LEVEL: "loud" })` returns `err`
  with a `configuration` error listing both paths and expected formats, and the issue
  messages contain no variable *values* (US4-3); `APP_VERSION` overrides the package
  version
- [ ] T036 [P] [US5] Write `apps/gateway/test/logger.test.ts` capturing output through an
  in-memory destination: top-level `prompt`, `messages`, `authorization` become
  `"[REDACTED]"` and sibling fields survive (US5-1); `req.headers.authorization`,
  `body.prompt`, `body.messages` redacted (US5-2); each line parses as one JSON object
  with `level`, `time`, `msg`; a `debug` line is dropped when level is `info` (US5-3)
- [ ] T037 [P] [US3] Write `apps/gateway/test/health.test.ts` using
  `createApp({ clock, version: "9.9.9", startedAt })` and `app.request("/health")`:
  status 200, body validates with `HealthResponseSchema` from `@tamiz/contracts`,
  `status === "ok"`, `version === "9.9.9"`, `uptimeMs` equals the fake clock delta
  (US3-1, US3-2); response time under 50 ms (SC-007)
- [ ] T038 [P] [US3] Write `apps/gateway/test/not-found-and-request-id.test.ts`:
  `GET /nope` → 404 and body validates with `ErrorEnvelopeSchema`, `type ===
  "not_found"` (US3-3); every response carries `x-request-id`; a client value
  `abc-123` is echoed; a 200-character or control-character value is replaced by a
  generated one (US3-4 and edge case); a route that throws → 500 envelope `internal`
  without a stack trace (FR-019)

### Implementation

- [ ] T039 [P] [US3] Implement `apps/gateway/src/domain/result.ts` and
  `apps/gateway/src/domain/errors.ts` per `data-model.md` section 6 (pure functions, no
  imports) (FR-014)
- [ ] T040 [P] [US4] Implement `apps/gateway/src/infrastructure/config/env.ts`:
  `EnvSchema` of R-11, `loadConfig(env): Result<GatewayConfig, ConfigurationError>`,
  `version = APP_VERSION ?? packageJson.version` (import `../../../package.json` with
  `{ type: "json" }`), frozen result (FR-015)
- [ ] T041 [P] [US5] Implement `apps/gateway/src/infrastructure/logging/logger.ts`:
  `createLogger({ level, destination? })` with the redact paths and censor of R-10,
  `base: { service: "tamiz-gateway" }`, ISO time (FR-016)
- [ ] T042 [P] [US3] Implement `apps/gateway/src/application/ports/clock.port.ts`
  (`ClockPort = { now(): Date }`) and
  `apps/gateway/src/infrastructure/clock/system-clock.ts` (R-09)
- [ ] T043 [US3] Implement `apps/gateway/src/presentation/mappers/error-envelope.ts`:
  `toErrorEnvelope(type, message, requestId?)` and `domainErrorToEnvelope(DomainError)`
  using `errorTypeToHttpStatus` from `@tamiz/contracts`
- [ ] T044 [US3] Implement `apps/gateway/src/presentation/middlewares/request-id.ts`
  wrapping Hono's `requestId()` with a validator that accepts only
  `^[A-Za-z0-9_-]{1,128}$` (the `RequestId` charset of `data-model.md` §1) and generates a
  UUID otherwise, and that sets the id on the response header (FR-018); the error mapper
  (T043) omits `requestId` when `safeRequestId` fails
- [ ] T045 [US3] Implement `apps/gateway/src/presentation/routes/health.ts`:
  `GET /health` building `{ status: "ok", version, uptimeMs: milliseconds(now − startedAt) }`
  and validating it with `HealthResponseSchema` before sending (FR-017)
- [ ] T046 [US3] Implement `apps/gateway/src/presentation/app.ts`:
  `createApp({ clock, version, startedAt, logger })` → `Hono` with request-id middleware,
  a request log line at `info` (method, path, status, duration, requestId; never body),
  `app.notFound` → 404 envelope, `app.onError` → 500 envelope and `logger.error` with the
  error (FR-019)
- [ ] T047 [US4] Implement `apps/gateway/src/main.ts`: `loadConfig(process.env)`; on `err`
  print each issue (`path: message`) to stderr and `process.exit(1)`; on `ok` create
  logger, clock, app and `serve({ fetch: app.fetch, port, hostname })`, then log one
  `info` line `gateway listening` with `host`, `port`, `version` (FR-015, FR-020)
- [ ] T048 [US4] Write `apps/gateway/test/boot.integration.test.ts`: spawn
  `node --import tsx src/main.ts` with `PORT=abc` and assert exit code 1 and stderr
  mentioning `PORT` (US4-1); spawn with a free port, poll `/health` until 200, assert the
  body validates, then kill (FR-020). Name the file so Vitest can run it with
  `--project gateway` and give it a 15 s timeout
- [ ] T049 [US3] Add `apps/gateway/vitest.config.ts` (node environment, `include:
  ["test/**/*.test.ts"]`) and `apps/gateway/tsconfig.build.json` extending
  `@tamiz/tsconfig/node-app.json`
- [ ] T050 Run `pnpm lint typecheck test build` from the root and the manual checks of
  `quickstart.md` sections 3–5 (`curl` outputs go in the task record)
- [ ] T051 Write `docs/tasks/done/T-001-04-gateway-skeleton.md` and set `T-001-04` to
  `done` in `docs/tasks/BACKLOG.md`

**Checkpoint**: `pnpm --filter @tamiz/gateway dev` serves `/health`; invalid env exits 1.

---

## Phase 4: `T-001-05` — Architecture limits and CI (US6)

**Goal**: dependency-cruiser rules that fail on a deliberate violation; one GitHub
Actions job `ci`; branch protection on `main`.

**Independent test**: `quickstart.md` section 6.

**Branch**: `T-001-05-architecture-and-ci`. Depends on Phase 3.

### Tests first

- [ ] T052 [P] [US6] Create violation fixtures under
  `apps/gateway/test/arch-fixtures/` (excluded from `tsconfig.build.json` and from the
  normal cruise): `domain-to-infra.ts`, `application-to-infra.ts`,
  `presentation-to-infra.ts`, `infra-to-presentation.ts`, `domain-to-npm.ts`, each a
  one-line import that breaks exactly one rule
- [ ] T053 [P] [US6] Write `apps/gateway/test/arch.test.ts` that runs dependency-cruiser
  programmatically (`cruise()` from `dependency-cruiser`) over `src/` and asserts zero
  violations (US6-1); then over each fixture copied into a temp layer folder and asserts
  the expected rule name and the offending path appear (US6-2 … US6-5)

### Implementation

- [ ] T054 [US6] Install `dependency-cruiser` at the root; create `.dependency-cruiser.cjs`
  with the five rules of R-12 (`domain-imports-nothing`, `application-only-domain`,
  `infrastructure-no-presentation`, `presentation-allowed-imports`,
  `only-main-imports-infrastructure`), plus `no-circular` and `not-to-unresolvable`,
  all `severity: "error"`; options `tsConfig: { fileName: "apps/gateway/tsconfig.json" }`,
  `tsPreCompilationDeps: true`, `exclude: "node_modules|dist|test"` (FR-021, FR-022)
- [ ] T055 [US6] Set the root script `arch` to
  `depcruise apps/gateway/src --config .dependency-cruiser.cjs --output-type err` and add
  `arch` to `turbo.json` (no outputs, inputs `apps/gateway/src/**`,
  `.dependency-cruiser.cjs`)
- [ ] T056 [P] [US6] Create `.github/workflows/ci.yml`: triggers `pull_request` and
  `push` to `main`; single job `ci` on `ubuntu-latest`, `timeout-minutes: 15`;
  `actions/checkout` with `fetch-depth: 0`; `pnpm/action-setup` (version from
  `packageManager`); `actions/setup-node` with `node-version-file: .nvmrc` and
  `cache: pnpm`; `pnpm install --frozen-lockfile`; steps in order `pnpm lint`,
  `pnpm typecheck`, `pnpm arch`, `pnpm test -- --coverage`, `pnpm build`; on PRs
  `pnpm commitlint --from ${{ github.event.pull_request.base.sha }} --to HEAD`;
  commented placeholders `# evals (feature 007)` and `# docker build (OPS)` (FR-023)

### Verification

- [ ] T057 [US6] Run `pnpm arch` on the clean tree → `no dependency violations found`,
  exit 0 (US6-1)
- [ ] T058 [US6] Append `import "../infrastructure/logging/logger";` to
  `apps/gateway/src/domain/result.ts`, run `pnpm arch`, confirm it fails naming the file
  and `domain-imports-nothing`, then `git checkout` the file (US6-2); run
  `pnpm --filter @tamiz/gateway test -- arch` for US6-3 … US6-5
- [ ] T059 [US6] Push the branch, open the PR, confirm the `ci` job runs the five steps in
  order and is green; deliberately push a commit with a lint error, confirm the job fails
  at `lint` and the PR shows not mergeable, then fix it (US6-6)
- [ ] T060 [US6] Configure branch protection on `main` with the GitHub CLI (classic
  protection: required status check `ci` with `strict: true`, require a pull request,
  no force pushes, no deletions, `enforce_admins: true`); paste the exact `gh api` command
  and the JSON response in the task record (FR-024)
- [ ] T061 [US6] Verify protection: `gh api repos/AxelAxx/tamiz/branches/main/protection
  --jq '.required_status_checks.contexts'` → `["ci"]`; attempt
  `git push origin HEAD:main` from the branch and confirm the refusal (US6-7)
- [ ] T062 [US6] Merge the PR only through the GitHub UI once `ci` is green (this is the
  first PR that goes through the gate); confirm `main` CI is green afterwards
- [ ] T063 Write `docs/tasks/done/T-001-05-architecture-and-ci.md` (include the branch
  protection command and the Renovate/GitHub settings that are manual) and set `T-001-05`
  to `done` in `docs/tasks/BACKLOG.md`

**Checkpoint**: a layering violation cannot reach `main`.

---

## Phase 5: `T-001-06` — `@tamiz/test-utils` and Vitest root config (US7)

**Goal**: `FakeClock`, builders, one root test command with coverage.

**Independent test**: `quickstart.md` section 7.

**Branch**: `T-001-06-test-utils`. Depends on Phase 3; may run in parallel with Phase 4
(different files).

### Tests first

- [ ] T064 [P] [US7] Add `@tamiz/contracts` (`workspace:*`) as a dependency of
  `packages/test-utils`; dev `vitest`; `exports` and `tsconfig.build.json` like the
  contracts package
- [ ] T065 [P] [US7] Write `packages/test-utils/test/fake-clock.test.ts`: two `now()`
  reads identical; `advance(1500)` moves `now()` by exactly 1500 ms; `set(date)` jumps;
  the object satisfies `{ now(): Date }` (US7-1)
- [ ] T066 [P] [US7] Write `packages/test-utils/test/builders.test.ts`:
  `chatCompletionRequest()` validates with `ChatCompletionRequestSchema`;
  `chatCompletionRequest({ model: "x" })` keeps defaults and applies the override;
  `healthResponse()` validates with `HealthResponseSchema`; `chatCompletionResponse()`
  validates with `ChatCompletionResponseSchema` (US7-2)

### Implementation

- [ ] T067 [P] [US7] Implement `packages/test-utils/src/fake-clock.ts`:
  `createFakeClock(start = new Date("2026-01-01T00:00:00Z"))` returning `{ now, advance,
  set }`; no class (R-09, FR-025)
- [ ] T068 [P] [US7] Implement `packages/test-utils/src/builders.ts`:
  `chatCompletionRequest(overrides?)`, `chatCompletionResponse(overrides?)`,
  `healthResponse(overrides?)`, each parsing the merged object with the contract schema so
  a bad override fails loudly (FR-025)
- [ ] T069 [US7] Implement `packages/test-utils/src/index.ts` re-exports
- [ ] T070 [US7] Create root `vitest.config.ts` with
  `test.projects: ["packages/*", "apps/*"]`, `coverage: { provider: "v8", include:
  ["packages/*/src/**", "apps/*/src/**"], reporter: ["text", "lcov"] }`; install
  `@vitest/coverage-v8`; make the root `test` script `vitest run` (not `turbo run test`)
  so one process reports every project, and keep `turbo run test` as `test:packages` for
  cached per-package runs (R-02, FR-026)
- [ ] T071 [US7] Replace the `apps/gateway/test/health.test.ts` hand-made clock with
  `createFakeClock` from `@tamiz/test-utils` (add it as a devDependency of the gateway)

### Verification

- [ ] T072 [US7] Run `pnpm test -- --coverage` from the root: the three projects are
  reported, coverage table printed (US7-3); `pnpm lint typecheck arch build` green
- [ ] T073 Write `docs/tasks/done/T-001-06-test-utils.md` (note the R-09 decision about
  `ClockPort` being structural and when to revisit it) and set `T-001-06` to `done` in
  `docs/tasks/BACKLOG.md`

**Checkpoint**: feature 001 complete; `T-002-02` can start.

---

## Phase 6: Polish and cross-cutting

- [ ] T074 [P] Update `README.md` "Status" section: feature 001 done, how to run the
  gates, link to `specs/001-contracts-and-skeleton/quickstart.md`
- [ ] T075 [P] Update `CLAUDE.md` section 12 (commands now real) and remove the "until
  then only Spec Kit and git exist" sentence; note `pnpm test` runs Vitest projects from
  the root
- [ ] T076 [P] Delete `specs/001-contracts-and-skeleton/contracts/openapi.yaml` once the
  generated OpenAPI document exists (feature 002) — tracked here, executed in 002
- [ ] T077 Run `quickstart.md` end to end on a fresh clone and record the timing
  (SC-001) in the `T-001-06` task record

Tasks T074 and T075 belong to the `T-001-06` PR (last of the feature); T076 is a note
for feature 002; T077 closes the feature.

---

## Dependencies

```text
Phase 1 (T-001-02) ─▶ Phase 2 (T-001-03) ─▶ Phase 3 (T-001-04) ─┬─▶ Phase 4 (T-001-05)
                                                                 └─▶ Phase 5 (T-001-06) ─▶ Phase 6
```

- Phases 4 and 5 touch disjoint files (`.dependency-cruiser.cjs`, `.github/`,
  `apps/gateway/test/arch*` vs `packages/test-utils/`, root `vitest.config.ts`) and can run
  as two sessions. If both are open, Phase 5 rebases after Phase 4 merges because Phase 4
  changes the root `package.json` scripts and `turbo.json`.
- Within a phase, `[P]` tasks are independent files; unmarked tasks depend on the ones
  above them.

## Parallel execution examples

- Phase 1: T003 … T009 together (seven config files), then T010 → T013 sequentially.
- Phase 2: T020 … T024 (five test files) together, then T025 … T028 (four schema files)
  together, then T029 → T031.
- Phase 3: T034 … T038 together; T039 … T042 together; T043 → T049 sequentially.
- Phase 4 ∥ Phase 5 as two sessions.

## Implementation strategy

1. **MVP** = Phases 1–3: a reviewer can clone, run the gates, and hit `/health`.
2. Phase 4 makes the architecture claim enforceable and closes the deferred branch
   protection of `T-OPS-00`.
3. Phase 5 is what feature 002 needs first (`FakeClock`, builders, root test run).
4. Each phase is one PR, one backlog row flipped to `done`, one task record under
   `docs/tasks/done/`. Never merge two phases in one PR.

## Totals

| Phase | Backlog | Tasks | Stories |
|---|---|---|---|
| 1 | `T-001-02` | T001–T016 (16) | US1 |
| 2 | `T-001-03` | T017–T031 (15) | US2 |
| 3 | `T-001-04` | T032–T051 (20) | US3, US4, US5 |
| 4 | `T-001-05` | T052–T063 (12) | US6 |
| 5 | `T-001-06` | T064–T073 (10) | US7 |
| 6 | polish | T074–T077 (4) | — |
| **Total** | | **77** | |
