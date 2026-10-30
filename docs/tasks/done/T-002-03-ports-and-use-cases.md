# T-002-03 — Ports, use cases and test doubles

| Field | Value |
|---|---|
| Task | `T-002-03` (see `docs/tasks/BACKLOG.md`) |
| Feature | `002-provider-routing` |
| Spec | `specs/002-provider-routing/spec.md` (US6-6, US6-7 at the use-case level, edge case "fallback chain beyond the first target"; FR-009 … FR-013, FR-018); `tasks.md` Phase 2 (T015–T024); `research.md` R-08, R-14; `data-model.md` §3.7, §4 |
| Branch / PR | `T-002-03-application-ports-use-cases` / PR opened after this commit |
| Date | 2026-10-30 |
| Session | Claude Code (Claude Opus 5.5), side session |
| Status | done |

## What was done

The application layer of feature 002 now exists and imports only `domain/`.
`ports/llm-provider.port.ts` declares `LlmProviderPort`, its input and normalised
completion, and `FINISH_REASONS` (FR-009). `ports/policy-repository.port.ts` declares
`PolicyRepositoryPort` (FR-010), and `provider-registry.ts` holds the `ProviderRegistry`
type (FR-018). `ClockPort` from 001 is reused. `classifyTask` wraps the domain classifier
and sets `sensitivity: "unknown"` (FR-011). `routeInference(deps)(request)` runs classify
→ `getActive` → `decide` → `chain[0]` → effective timeout → `complete` → `createdAt`, and
returns `Result<RoutedCompletion, RoutingFailure>` (FR-012, US6-6). `DomainError` gains
`ProviderError` and `UnauthorizedError` with constructors (FR-013). `@tamiz/test-utils`
gains the generic doubles `createScriptedPort` and `createInMemoryPolicyRepository`
(R-14). All tests were written first and failed on missing modules.

## Files touched

- `apps/gateway/src/application/ports/llm-provider.port.ts` — `LlmProviderPort`, `ProviderCompletionInput`, `ProviderCompletion`, `ProviderUsage`, `FINISH_REASONS` (T019).
- `apps/gateway/src/application/ports/policy-repository.port.ts` — `PolicyRepositoryPort` (T020).
- `apps/gateway/src/application/provider-registry.ts` — `ProviderRegistry`, type only (T021).
- `apps/gateway/src/application/use-cases/classify-task.ts` — `classifyTask` (T022).
- `apps/gateway/src/application/use-cases/route-inference.ts` — `routeInference`, `effectiveTimeoutMs`, `RoutedCompletion`, `RoutingFailure`, `RouteInferenceDeps` (T023).
- `apps/gateway/src/domain/errors.ts` — `PROVIDER_ERROR_CAUSES`, `ProviderError`, `UnauthorizedError`, `providerError`, `unauthorizedError`, union widened (T018).
- `apps/gateway/src/domain/model/brands.ts` — new: the brand types, moved out of `units.ts` (see Decisions).
- `apps/gateway/src/domain/model/units.ts` — imports and re-exports the brand types; constructors unchanged.
- `apps/gateway/src/domain/model/model-target.ts` — imports its brand types from `brands.ts`.
- `apps/gateway/src/presentation/mappers/error-envelope.ts` — `provider` → `provider_error`, `unauthorized` → `unauthorized`, so the exhaustive switch still compiles.
- `packages/test-utils/src/{scripted-port,in-memory-policy-repository}.ts`, `src/index.ts` — the R-14 doubles (T015).
- `packages/test-utils/test/{scripted-port,in-memory-policy-repository}.test.ts` — T015.
- `apps/gateway/test/application/{route-inference,classify-task,llm-provider.port}.test.ts` — T016 and the use-case and port tests.
- `apps/gateway/test/domain/errors.test.ts` — T017 (new file, see Decisions); `apps/gateway/test/result.test.ts` — its exhaustive switch gains the two kinds.
- `apps/gateway/test/error-envelope.test.ts` — the mapper's five kinds.
- `apps/gateway/src/{application,domain}/README.md`, `packages/test-utils/README.md` — module lists.
- `docs/tasks/BACKLOG.md` — `T-002-03` row set to `done` (that row only).

## Decisions

- **The fakes live in `packages/test-utils`, and no `@tamiz/ports` package is needed.**
  `PolicyRepositoryPort` is the second shared port, the trigger that R-09 named. R-14
  already settled the shape: the doubles are generic over their types.
  `createInMemoryPolicyRepository<P>` never needs to know what a `RoutingPolicy` is, and
  `createScriptedPort<I, O>` becomes a fake LLM provider when the gateway test types its
  handler. So `test-utils` still imports nothing from the app, and the port types stay
  in `application/ports/`. A `@tamiz/ports` package would only pay off when a fake needs
  to read a gateway type to work, and none does. No backlog row was added.
- **`brands.ts` was split out of `units.ts` to avoid an import cycle.** `ProviderError`
  needs `TargetId` and `ProviderName`. `units.ts` imports `errors.ts` for
  `ValidationError`, and `model-target.ts` imported `units.ts`. With
  `tsPreCompilationDeps: true`, dependency-cruiser counts type-only imports, so
  `errors → units → errors` fails `no-circular`. The brand types moved to an import-free
  `brands.ts`. `units.ts` re-exports them, so every other importer is unchanged.
  `model-target.ts` imports `brands.ts` directly, because `errors.ts` imports it. The
  T-002-02 pitfall about shared closed lists applies to types too.
- **The error mapper got two cases, outside the strict T058 scope.** Widening the union
  breaks the `assertNever` switch in `presentation/mappers/error-envelope.ts`. I added the
  two mappings that already exist in the 001 contract. The `cause === "timeout"` →
  `provider_timeout` (504) case needs the contract enum from data-model §2.2 and stays in
  `T-002-06` (T058), along with `fromZodIssues`.
- **T017 named `test/domain/errors.test.ts (001)`, but 001 put its `DomainError` tests in
  `test/result.test.ts`.** I created `errors.test.ts` for the new variants and extended
  the switch in `result.test.ts` so that it compiles.
- **An empty `chain` throws** in `routeInference` instead of returning a `Result`. It
  cannot happen for a validated policy (R-08), and it follows `targetById`: an
  unvalidated policy is a programming error. One test pins the throw and checks that no
  provider is called.
- **`RoutedCompletion.usage` is optional and copied from the completion**, as T023 asks.
  `T-002-07` makes it the required reported-or-estimated `Usage` and adds `cost`.
- **`providerError` takes one object**, `Omit<ProviderError, "kind">`, not positional
  arguments, because there are six fields, one of them optional.
- **The messages are forwarded by reference** and the sampling parameters are spread
  only when present (`exactOptionalPropertyTypes`). The domain `InferenceRequest` has no
  `user` field, so US6-7's "never forward `user`" is the mapper's job in `T-002-06`.
- **Branch name.** The brief named it `T-002-03-application-ports-use-cases`. `tasks.md`
  says `T-002-03-ports-and-use-cases`, and this record uses the `tasks.md` slug.

## How it was verified

```bash
pnpm --filter @tamiz/gateway exec vitest run test/application test/domain/errors.test.ts   # before src existed
#  Test Files  3 failed (3)   (modules not found)
pnpm --filter @tamiz/gateway exec vitest run test/application test/domain test/error-envelope.test.ts
#  Test Files  9 passed (9)   Tests  128 passed (128)

pnpm lint                 # Checked 100 files. No fixes applied.
pnpm typecheck            # exit 0 (5 tasks)
pnpm arch                 # ✔ no dependency violations found (33 modules, 67 dependencies cruised)
pnpm test --coverage      # Test Files 28 passed (28)   Tests 302 passed (302)   Type Errors no errors
#  All files | 95.04 | 95.62 | 97.47 | 94.71
#  every new application, domain and test-utils file is fully covered (absent from the
#  agent-shortened table); remaining gaps are main.ts, system-clock.ts, env.ts:66,
#  logger.ts:47 and the untested 001 helper domainErrorToEnvelope
pnpm build                # Tasks: 3 successful, 3 total
```

## Pending / follow-ups

- `T-002-04` implements `ProviderRegistry` and the adapters against `LlmProviderPort`.
- `T-002-05` implements `PolicyRepositoryPort` (file adapter).
- `T-002-06` (T058) adds `provider_timeout` to the contract and to the mapper,
  `fromZodIssues`, and wires `routeInference` in `main.ts`.
- `T-002-07` adds usage estimation and cost to `RoutedCompletion`.
- No new backlog rows.

## Pitfalls for the next session

- **dependency-cruiser counts `import type` (`tsPreCompilationDeps: true`).** A type-only
  import can still close a cycle. Anything `errors.ts` imports must not import `units.ts`
  or `errors.ts` back. Import brand types from `brands.ts` in such modules.
- **Widening `DomainError` breaks every exhaustive switch**: the mapper and the test in
  `result.test.ts`. Grep for `assertNever(` before you add a kind.
- **The gateway resolves `@tamiz/test-utils` through `dist`.** After you change
  `packages/test-utils/src`, run `pnpm --filter @tamiz/test-utils build` before a
  gateway-only Vitest run. A root `pnpm test` builds it through turbo.
- The engine warning (Node 24 vs 22) shows on every pnpm command. It is expected.

## Links

- Spec / plan / tasks: `specs/002-provider-routing/{spec,plan,tasks}.md` (Phase 2), `research.md` R-08, R-09 (001), R-14, `data-model.md` §3.7, §4
- ADRs: none added
- Related task records: `docs/tasks/done/T-002-02-domain-routing-model.md`, `docs/tasks/done/T-001-06-test-utils.md`, `docs/tasks/done/T-001-04-gateway-skeleton.md`, `docs/tasks/done/T-001-05-architecture-and-ci.md`
