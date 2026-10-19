# T-001-03 — `packages/contracts`: chat completions, health and error schemas + branded types

| Field | Value |
|---|---|
| Task | `T-001-03` (see `docs/tasks/BACKLOG.md`) |
| Feature | `001-contracts-and-skeleton` |
| Spec | `specs/001-contracts-and-skeleton/spec.md` (US2, FR-006 … FR-012, SC-004); `tasks.md` Phase 2 (T017–T031); `data-model.md` sections 1–5; `research.md` R-07 |
| Branch / PR | `T-001-03-contracts-package` / PR opened after this commit |
| Date | 2026-10-18 |
| Session | Claude Code (Claude Fable 5.1), side session started from the `T-001-02` session |
| Status | done |

## What was done

`@tamiz/contracts` now holds the four Zod 4 contracts of feature 001 and the four branded
types, with `zod` as its only runtime dependency (FR-012). `src/branded.ts` defines
`RequestId`, `PolicyId`, `Usd` and `Milliseconds` with parse-and-throw constructors and
`safe*` variants (FR-011); `src/chat-completion.ts` the OpenAI-compatible non-streaming
request and response subset (FR-006 … FR-008); `src/health.ts` the health response with
`checks` required when degraded (FR-009); `src/error.ts` the seven-value `ErrorType`, the
`ErrorEnvelope` and the `errorTypeToHttpStatus` map (FR-010). Every object is a
`z.strictObject`, so unknown fields are rejected and named (FR-007). Spec scenarios US2-1 …
US2-9 map to tests: 89 runtime tests plus 6 type-level tests in `test/branded.test-d.ts`,
run by Vitest's typecheck mode; the SC-004 invalid corpus lives in
`test/fixtures/chat-completion.ts` and every sample is asserted rejected with its issue path.

## Files touched

- `packages/contracts/package.json` — `dependencies.zod ^4.6.7`; `test` script is now `vitest run` (no `--passWithNoTests`).
- `packages/contracts/vitest.config.ts` — node environment, `include: test/**/*.test.ts`, `typecheck.enabled` for `test/**/*.test-d.ts` against `tsconfig.json`.
- `packages/contracts/src/branded.ts` — schemas, types, `requestId` / `policyId` / `usd` / `milliseconds` and `safe*` variants.
- `packages/contracts/src/chat-completion.ts` — `ChatMessage`, `ChatCompletionRequest`, `ChatCompletionChoice`, `ChatCompletionUsage`, `ChatCompletionResponse`.
- `packages/contracts/src/health.ts` — `HealthCheck`, `HealthResponse` with the degraded-requires-checks refinement.
- `packages/contracts/src/error.ts` — `ErrorType`, `ErrorEnvelope`, frozen `errorTypeToHttpStatus`.
- `packages/contracts/src/index.ts` — explicit named re-exports of every schema, type, constructor and the status map (placeholder constant removed).
- `packages/contracts/test/fixtures/chat-completion.ts` — valid request/response and the SC-004 corpus (`invalidRequests`, `invalidResponses`), each with its expected issue path.
- `packages/contracts/test/{chat-completion-request,chat-completion-response,health,error,branded}.test.ts` — runtime tests named after the spec scenarios.
- `packages/contracts/test/branded.test-d.ts` — type tests (`expectTypeOf().not.toExtend`, `// @ts-expect-error`).
- `packages/contracts/README.md` — module table replaces the "arrives in T-001-03" note.
- `pnpm-lock.yaml` — `zod@4.6.7`.
- `docs/tasks/BACKLOG.md` — `T-001-03` row set to `done` (that row only).

## Decisions

- **Zod 4.6.7**, imported as `import { z } from "zod"` (R-07). `.brand<"X">()` gives the
  nominal types; `z.ZodSafeParseResult<T>` is the return type of the `safe*` variants.
  Constructors take the primitive (`string` / `number`) and throw a `ZodError`; `safe*`
  take `unknown` so callers can hand them raw input.
- **`Choice.message` reuses `ChatMessageSchema`** (any of the three roles) as `tasks.md`
  T026 and `contracts/openapi.yaml` specify. `data-model.md` section 3 says *(role
  "assistant")*; narrowing the role is a one-line `extend` when feature 002 builds the
  response mapper. Recorded here so the mismatch is not rediscovered.
- **Health refinement via `.superRefine`** adding a `custom` issue at path `["checks"]`
  when `status === "degraded"` and `checks` is absent; the `min(1)` on the array covers the
  empty-list case with the same path, so tests assert one path for both.
- **`errorTypeToHttpStatus` is `Object.freeze`d** and typed `Readonly<Record<ErrorType,
  number>>`, so adding an enum value without a mapping is a compile error.
- **Issue-shape assertions** use Zod 4 codes: `unrecognized_keys` (with `keys`),
  `invalid_type` (with `expected`), `invalid_format` for the regex. The unknown-key issue
  has path `[]` and names the key in `keys` and `message`; nested unknown keys carry the
  parent path (`["messages", 0]`).
- **`vitest.config.ts` limits runtime `include` to `test/**/*.test.ts`** so the `-d`
  files are only type-checked, never executed; `typecheck.tsconfig` points at the
  package `tsconfig.json` (which already includes `test/`). `vitest.config.ts` itself is
  outside `tsconfig.json`'s `include`, so `pnpm typecheck` does not check it; Biome does.
- **Backlog edit kept to the `T-001-03` row only**, as instructed: a parallel session
  (`T-002-01`) edits the same file in its own worktree.

## How it was verified

```bash
pnpm --filter @tamiz/contracts test
#  Test Files  6 passed (6)      Tests  95 passed (95)      Type Errors  no errors
# (before implementing src/: 6 failed, 85 failed | 10 passed, Type Errors 4 failed)
# Removing one "// @ts-expect-error" in branded.test-d.ts:
#  TypeCheckError: Type 'number & $brand<"Usd">' is not assignable to type 'number & $brand<"Milliseconds">'
#  Type Errors  1 failed                              (restored afterwards)
pnpm lint        # Checked 34 files in 18ms. No fixes applied.
pnpm typecheck   # Tasks: 3 successful, 3 total
pnpm test        # Tasks: 3 successful; contracts 95 passed, gateway 4 passed
pnpm build       # Tasks: 3 successful; packages/contracts/dist/{index,branded,chat-completion,health,error}.{js,d.ts,*.map}
node --input-type=module -e "import('./dist/index.js').then(m => ...)"   # from packages/contracts
# 22 named exports; ChatCompletionRequestSchema rejects stream:true; errorTypeToHttpStatus.policy_blocked === 451
```

The engine warning `Unsupported engine: wanted {"node":">=22 <23"} (current: v24.14.0)`
is printed by every pnpm command and is expected (spec Assumptions).

## Pending / follow-ups

- `Choice.message` role is not narrowed to `assistant` (see Decisions); feature 002 decides
  when it writes the response mapper. No backlog entry: it is part of `T-002-06`'s scope.
- `T-001-04` can start: `HealthResponseSchema`, `MillisecondsSchema`, `ErrorEnvelopeSchema`
  and `errorTypeToHttpStatus` are what the gateway skeleton consumes.

## Pitfalls for the next session

- **A fresh worktree has no `node_modules`.** `pnpm --filter @tamiz/contracts add zod`
  installs only that package's tree; `pnpm typecheck` / `pnpm build` then fail in
  `@tamiz/test-utils` and `@tamiz/gateway` with `File '@tamiz/tsconfig/library.json' not
  found`. Run `pnpm install` at the root first.
- **Biome `organizeImports` sorts case-sensitively** (`MillisecondsSchema` before
  `milliseconds`) and reflows long `it.each(...)(` calls; run
  `pnpm exec biome check --write packages/<pkg>` before `pnpm lint` instead of guessing.
- **Vitest typecheck prints "Testing types with tsc … is an experimental feature"** on
  every run; harmless. Pin Vitest (the catalog does) because its typecheck output format
  may change.
- **Zod 4 issue codes differ from Zod 3**: `invalid_format` (not `invalid_string`) for
  regex failures, `invalid_value` for a failed `z.literal`, `too_small` for `min`. Tests
  that assert codes must use the v4 names.
- **Long heredoc scripts in the Bash tool can fail to parse on this machine** (an
  "unexpected EOF" that left no files written). Write files with the dedicated Write tool
  and use Bash for commands.
- **`node -e "import('@tamiz/contracts')"` from the repository root fails** because the
  root package does not depend on it; import `./dist/index.js` from inside the package
  (or from a workspace consumer) to smoke-test the build.

## Links

- Spec / plan / tasks: `specs/001-contracts-and-skeleton/{spec,plan,tasks}.md` (Phase 2), `data-model.md` sections 1–5, `research.md` R-07, `contracts/openapi.yaml`, `quickstart.md` section 2
- ADRs: none added
- Related task records: `docs/tasks/done/T-001-02-monorepo-tooling.md` (tooling and machine pitfalls), `docs/tasks/done/T-001-01-spec-plan-tasks-001.md`
