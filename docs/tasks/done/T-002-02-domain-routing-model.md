# T-002-02 — Domain model and the pure `decide()`

| Field | Value |
|---|---|
| Task | `T-002-02` (see `docs/tasks/BACKLOG.md`) |
| Feature | `002-provider-routing` |
| Spec | `specs/002-provider-routing/spec.md` (US3, US4; FR-001 … FR-008; SC-003, SC-007); `tasks.md` Phase 1 (T001–T014); `research.md` R-01, R-02, R-03, R-07, R-08; `data-model.md` sections 1 and 3.1–3.5 |
| Branch / PR | `T-002-02-domain-routing-policy` / PR opened after this commit |
| Date | 2026-10-19 |
| Session | Claude Code (Claude Opus 5.5), side session started from the `T-001-06` session |
| Status | done |

## What was done

`apps/gateway/src/domain/model/` now holds the routing domain of feature 002, with zero
imports outside `domain/`. `units.ts` declares the domain's own branded `Usd`,
`Milliseconds`, `PolicyId`, `TargetId`, `RuleId`, `RequestId` and `ClientId` with
validating constructors that return `Result` and `*Unchecked` variants (R-01).
`inference-request.ts`, `model-target.ts` and `sensitivity.ts` hold the request, the target
(FR-001) and the closed lists. `task-classifier.ts` is the bilingual rule-based classifier
(FR-002, FR-008, US4-1 … US4-6). `routing-policy.ts` has `validatePolicy`, which applies
every cross-field rule of FR-004 and reports a path for each issue, plus `targetById`.
`routing-decision.ts` has `matches`, `orderTargets` and a total, pure
`decide(policy, request)` that returns the ordered chain, the rule id or `default`, the
optional rule timeout, `sensitivity: "unknown"` and `privacyAction: "allow"` (FR-005 …
FR-007, US3-1 … US3-7). The tests were written first: 103 domain tests, including six
fast-check properties at 1 000 runs each (SC-003) and the SC-007 micro-benchmark.

## Files touched

- `apps/gateway/src/domain/model/units.ts` — domain brands and constructors (T006).
- `apps/gateway/src/domain/model/inference-request.ts` — `MESSAGE_ROLES`, `Message`, `InferenceRequest` (T007).
- `apps/gateway/src/domain/model/model-target.ts` — `PROVIDER_NAMES`, `RESIDENCIES`, `Pricing`, `ModelTarget` (T008).
- `apps/gateway/src/domain/model/sensitivity.ts` — `SENSITIVITIES = ["unknown"]` (see Decisions).
- `apps/gateway/src/domain/model/task-classifier.ts` — `TASK_TYPES`, `TASK_SIZES`, `SIZE_THRESHOLDS`, `TYPE_PRECEDENCE`, **`CUES` (the R-07 cue table)**, `estimateTokens`, `classify`, `ClassifiedRequest` (T009).
- `apps/gateway/src/domain/model/routing-policy.ts` — `RoutingPolicy`, `RoutingRule`, `RuleCondition`, unbranded `*Input` types, `validatePolicy`, `targetById`, `DEFAULT_RULE_ID`, `DEFAULT_POLICY_TIMEOUT_MS` (T010).
- `apps/gateway/src/domain/model/routing-decision.ts` — `PRIVACY_ACTIONS`, `DecisionInput`, `RoutingDecision`, `matches`, `orderTargets`, `decide` (T011).
- `apps/gateway/src/domain/README.md` — module list.
- `apps/gateway/test/domain/{units,task-classifier,routing-policy,routing-decision,routing-decision.property}.test.ts` — T001–T005.
- `apps/gateway/test/domain/helpers/policies.ts` — `examplePolicyInput()` (the `contracts/policy.example.yaml` policy as an object) and `validPolicy()`.
- `apps/gateway/package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml` — dev `fast-check` from the catalog, pinned `^4.10.2` (T012).
- `docs/tasks/BACKLOG.md` — `T-002-02` row set to `done` (that row only).

## Decisions

- **R-01 stands: the domain owns its brands.** `units.ts` uses `unique symbol` brands, so a
  domain `Usd` is not assignable to the contracts `Usd`, and mappers in presentation and
  infrastructure convert between the two (`T-002-05`, `T-002-06`). The rules match the
  contract brands: `Usd` finite ≥ 0; `Milliseconds` integer ≥ 0; `PolicyId` 1–64 and
  `RequestId` 1–128 characters of `[A-Za-z0-9_-]`; `TargetId`/`RuleId`
  `^[a-z0-9][a-z0-9-]{0,63}$`. Feature 001 has no `ClientId` contract brand, so I chose
  `ClientId` = 1–64 characters of the 001 charset. `T-002-06` must keep the `TAMIZ_API_KEYS`
  client ids inside that rule, or relax it. Constructors take an optional `path` so
  `validatePolicy` reuses them and reports `targets.0.pricing.inputUsdPerMillion`.
  Messages never echo the value.
- **The cue table is `CUES` in `task-classifier.ts` and holds strings, not `RegExp`s.**
  `data-model.md` §3.3 typed it as `Record<…, readonly RegExp[]>`. R-07 asks for one table
  that the dataset and the docs can quote, and plain strings are easier to quote. The file
  compiles each cue once, in the private `CUE_PATTERNS`. A cue gets a `\b` word boundary
  only at an end that is a letter or digit, so the fenced-block cue matches anywhere and
  `tl;dr` matches as written. Text is lower-cased, NFD-normalised and stripped of `\p{M}`,
  so `traducción`, `traduccion` and `Español` all match.
- **Size counts all messages; type reads only the system messages and the last user
  message**, as in R-07. Assistant turns never supply cues. A conversation with no user
  message is classified from its system messages.
- **`SENSITIVITIES` lives in a new `sensitivity.ts`, not in `routing-decision.ts`** as
  `tasks.md` T011 put it. `ClassifiedRequest` (classifier) and `RoutingDecision` (decision)
  both need the type, and the decision imports the classifier, so declaring it in the
  decision file would create an import cycle that `no-circular` rejects. Backlog
  `T-005-02` already names `domain/model/sensitivity.ts`, so feature 005 extends this
  file. `PRIVACY_ACTIONS` stays in `routing-decision.ts`.
- **`DEFAULT_RULE_ID` lives in `routing-policy.ts`.** Validation needs it to reject the
  reserved id, and the decision imports it from there.
- **`decide` takes `DecisionInput`**, which is
  `Pick<ClassifiedRequest, "requestedModel" | "taskType" | "size" | "sensitivity">`, not
  the whole `ClassifiedRequest`. It reads only those four fields. A `ClassifiedRequest`
  is still assignable, and the property test does not have to generate request ids and
  messages it never reads.
- **`targetById` throws on an undeclared id** instead of returning a `Result`, so `decide`
  stays total (R-08). The throw cannot happen for a policy from `validatePolicy`. A
  hand-built, unvalidated policy is a programming error, in the same spirit as
  `assertNever`. One test pins the throw.
- **`validatePolicy` collects every issue in one pass**, in document order: id, version,
  `defaultTimeoutMs`, targets, rules, default route. A missing `defaultTimeoutMs` becomes
  30 000 ms. It also rejects what a schema could miss on an in-memory policy: no targets,
  a non-integer or < 1 `version`, a blank `model` or `region`, and an empty list inside a
  `when`. It does not check **unknown keys** (FR-004's last item). The input type has no
  extra keys, and the edge schema `RoutingPolicySchema` (`strictObject`, `T-002-05`)
  rejects them in files. A timeout must be an integer > 0.
- **The validated policy is a copy.** Arrays and conditions are copied, so a caller that
  later mutates its input cannot change a policy that was already validated. The output
  is plain data (no `Map`), so it serialises for the dashboard and the simulator.
- **Cost ordering** sorts a fresh array (`Array.prototype.sort` is stable) by
  `inputUsdPerMillion + outputUsdPerMillion`. It never mutates the policy, and a property
  test checks that.
- **`@tamiz/test-utils` is not used in these tests.** The domain has no time (`ClockPort`
  starts in `T-002-03`) and no contract objects (the domain may not import contracts), so
  `createFakeClock` and the builders had nothing to do here. The SC-007 benchmark measures
  real elapsed time with `performance.now()`, because what it checks is speed. It is the
  only timing in the domain tests.
- **Branch name.** The brief named the branch `T-002-02-domain-routing-policy`, while
  `tasks.md` names it `-domain-routing-model`. I used the brief's branch name, and this
  record uses the `tasks.md` slug, as T014 says.
- **No closed-list drift test yet.** R-03's `contracts-drift.test.ts` needs the contract
  enums, which arrive with `RoutingPolicySchema` in `T-002-05`. That task's `tasks.md`
  items own the test.

## How it was verified

```bash
pnpm --filter @tamiz/gateway exec vitest run test/domain    # before src/domain/model existed
#  Test Files  5 failed (5)   Tests  no tests      (module not found on every import)
pnpm --filter @tamiz/gateway exec vitest run test/domain    # after
#  Test Files  5 passed (5)   Tests  102 passed (102)   (103 after adding the MESSAGE_ROLES check)

pnpm lint                 # Checked 85 files in 34ms. No fixes applied.
pnpm typecheck            # Tasks: 5 successful, 5 total
pnpm arch                 # ✔ no dependency violations found (27 modules, 42 dependencies cruised)
pnpm test --coverage      # Test Files 21 passed (21)   Tests 267 passed (267)   Type Errors no errors
#  All files | 93.19 | 93.1 | 96.29 | 92.7
#  every domain/model file is fully covered (absent from the agent-shortened table;
#  coverage/lcov.info lists all seven apps\gateway\src\domain\model\*.ts files)
pnpm build                # Tasks: 3 successful, 3 total
```

The six fast-check properties run with `numRuns: 1000` each over generated valid
policies (1–6 targets with unique slug ids, 0–6 rules with shuffled sub-chains, optional
conditions, `orderBy` and timeouts) and requests (any task type and size, a requested
model from a pool or an arbitrary string). They check four things. Every generated input
validates. The same input gives a deep-equal decision. The chain is non-empty, holds only
declared targets and repeats none. The `ruleId` is `default` or a declared rule whose
route equals the chain as a set. The decision carries the policy id, version, task type,
size, `unknown` and `allow`. Neither the policy nor the request is mutated. The SC-007
benchmark (1 000 `classify` + `decide` calls over a ~7 kB prompt) asserts p95 < 5 ms.

## Pending / follow-ups

- `T-002-03` wraps `classify` in the `classifyTask` use case, which builds the
  `ClassifiedRequest` with `sensitivity: "unknown"`, and computes the effective timeout
  `decision.ruleTimeoutMs ?? target.timeoutMs ?? policy.defaultTimeoutMs`.
- `T-002-05` adds `RoutingPolicySchema` (with `strictObject` for unknown keys), the
  `contracts-drift.test.ts` of R-03 and the file loader that feeds `validatePolicy`.
- `T-002-07` adds `domain/model/cost.ts`.
- No new backlog rows.

## Pitfalls for the next session

- **Do not declare a shared closed list in a module that imports its consumer.** The
  classifier and the decision both need `Sensitivity`, so it sits in its own file. The
  same applies when feature 005 adds privacy actions that the policy rules reference:
  put them where both `routing-policy.ts` and `routing-decision.ts` can import them
  without a cycle.
- **`Array.prototype.findLast` is ES2023; the shared tsconfig targets `lib: ES2022`.**
  Use `.filter(...).at(-1)` or a loop.
- **With `exactOptionalPropertyTypes`, build optional fields by spreading**
  (`...(x === undefined ? {} : { x })`). Assigning `x: undefined` does not compile, and a
  test checks with `"ruleTimeoutMs" in decision` that the key is absent.
- **fast-check 4 `fc.record(model, { requiredKeys: [...] })`** gives truly optional keys
  (absent, never `undefined`), which fits `exactOptionalPropertyTypes`. `fc.option` would
  give `null`.
- **Python `open(..., "w")` on Windows writes CRLF.** `.gitattributes` normalises on
  commit, but Biome may flag the file first. Strip `\r` or write with the Write tool.
- Vitest hides fully covered files from the coverage table under an agent. Check
  `coverage/lcov.info`, where the paths use backslashes on Windows
  (`SF:apps\gateway\src\domain\model\…`).

## Links

- Spec / plan / tasks: `specs/002-provider-routing/{spec,plan,tasks}.md` (Phase 1), `research.md` R-01, R-02, R-03, R-07, R-08, `data-model.md` §1, §3.1–3.5, `contracts/policy.example.yaml`
- ADRs: none added
- Related task records: `docs/tasks/done/T-002-01-spec-plan-tasks-002.md` (R-01 flagged for Alex), `docs/tasks/done/T-001-06-test-utils.md`, `docs/tasks/done/T-001-05-architecture-and-ci.md` (`no-circular`, `domain-imports-nothing`), `docs/tasks/done/T-001-04-gateway-skeleton.md` (`Result`, `DomainError`)
