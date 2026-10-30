# T-005-02 — Domain: sensitivity, privacy actions, policy `privacy` section

| Field | Value |
|---|---|
| Task | `T-005-02` (see `docs/tasks/BACKLOG.md`) |
| Feature | `005-privacy-aware-routing` |
| Spec | `specs/005-privacy-aware-routing/spec.md` (FR-001 … FR-005, FR-020; US6-1 … US6-4, US1 decision part; SC-001); `tasks.md` Phase 1 (T001–T011); `research.md` R-04, R-05, R-11 |
| Branch / PR | `T-005-02-domain-privacy-policy` / PR opened after this commit |
| Date | 2026-10-30 |
| Session | Claude Code (Claude Opus 5.5), side session (merge authority delegated by Alex) |
| Status | done |

## What was done

**The domain.** It now knows the four sensitivity levels plus `unknown`, the entity kinds
(equal to the privacy service's), an `Inspection` (`ok` with level and entity positions,
or `failed` with a reason) and the four privacy actions.

**The policy.** It gains a required `privacy` section in contracts and domain:
- an action per level, with optional residencies;
- a `localRoute` of local targets;
- `onDetectorError`: `restrict_to_local` or `block`, never `allow`.

The boot check rejects a missing section, a non-local `localRoute`, and `critical: allow`
outside `local`/`eu`.

**The decision.** `decide()` now returns `route | block`. After the rule match,
`applyPrivacy` decides what happens:
- `allow` and `anonymize` filter the chain to the rule's ∩ level's residencies;
- `restrict_to_local` uses `localRoute` with `[local]`;
- `block`, an empty chain or a failed inspection with `block` produce a `BlockDecision`
  with no chain.

A block becomes `451 policy_blocked`, or `503 privacy_unavailable` for a detector failure.
The new error type is in contracts.

**Both shipped policies are now version 3.** Until `T-005-04` wires the detector, every
request is inspected as `NOT_INSPECTED` (level `none`), so traffic routes exactly as in
feature 003 (routing dataset 44/44).

## Files touched

- `packages/contracts/src/routing-policy.ts`, `index.ts`: `SensitivityLevelSchema`, `PrivacyActionSchema`, `PrivacyLevelSchema`, `PrivacySectionSchema`, the required `privacy` field (T006).
- `packages/contracts/src/error.ts`: `privacy_unavailable` → 503.
- `apps/gateway/src/domain/model/sensitivity.ts`: levels, `ENTITY_KINDS`, `DetectedEntity`, `Inspection`, `sensitivityOf`, `NOT_INSPECTED` (T007).
- `apps/gateway/src/domain/model/privacy-policy.ts` (new): actions, `validatePrivacy`, `applyPrivacy` (T008).
- `apps/gateway/src/domain/model/routing-policy.ts`: `privacy` in the policy, validated (T008).
- `apps/gateway/src/domain/model/routing-decision.ts`: `RoutingDecision` (`kind: "route"`), `BlockDecision`, `Decision`, the new `decide` (T009).
- `apps/gateway/src/domain/model/task-classifier.ts`, `application/use-cases/classify-task.ts`: `ClassifiedRequest.inspection` replaces `sensitivity`.
- `apps/gateway/src/domain/errors.ts`: `PrivacyBlockedError`, `privacyBlockedError`.
- `apps/gateway/src/application/use-cases/{route-inference,stream-inference}.ts`: the `RoutingFailure` union and `blocked()`. A block never calls a provider.
- `apps/gateway/src/presentation/routes/chat-completions.ts`, `mappers/error-envelope.ts`: the blocked failure → 451/503.
- `apps/gateway/src/infrastructure/policy/policy-mapper.ts`: maps the section (T010).
- `apps/gateway/policies/{default,local-only}.yaml` (version 3) and `policies/README.md` (T010).
- Tests, new:
  - `apps/gateway/test/domain/{privacy-policy,privacy-decision.property,sensitivity}.test.ts`;
  - `test/policy/shipped-policies.test.ts`;
  - `packages/contracts/test/routing-policy-privacy.test.ts`;
  - fixtures `test/policy/fixtures/invalid/{missing-privacy,critical-allow,non-local-route}.yaml`
  - (T001–T005).
- Tests, updated for the union decision and the required section:
  - `test/domain/helpers/policies.ts` (`PERMISSIVE_PRIVACY`, `routeOf`, `decideRoute`);
  - every policy fixture;
  - the routing-decision, residency, route-inference, chat-completions, errors, result, boot and loader tests;
  - the routing dataset test.
- `specs/005-privacy-aware-routing/tasks.md` (T001–T011 ticked), `docs/tasks/BACKLOG.md`.

## Decisions

- **`RoutingDecision` keeps its name for the route shape** (now with `kind: "route"`), and
  `decide` returns `Decision = RoutingDecision | BlockDecision`. Data-model §2.3 called
  the union `RoutingDecision`. Keeping the name for the route shape left `executeChain`,
  its helpers and about 40 tests that only ever see routes untouched. Tests that decide
  use `decideRoute` (fails on a block).
- **`privacy-policy.ts` does not import `errors.ts`.** Its issues use a structural
  `PrivacyIssue`, and it takes `TargetId` from `brands.ts`. `errors.ts` needs
  `BlockReason`, and the reverse import formed a cycle that dependency-cruiser rejected.
- **`local-only.yaml` uses `critical: restrict_to_local`, not `allow`** (research R-11
  said every level `allow`). With a single local target the effect is identical, and it
  passes the boot rule without adding a residency.
- **The empty-chain invariant test changed meaning.** An unvalidated policy with an empty
  chain used to throw inside `executeChain`. It now blocks with `no_target` before any
  call, which is the safer behaviour.
- **`MessageIndex` is a plain number, not a brand.** It is only ever produced by the
  detector adapter (`T-005-03`); a brand added ceremony with no check to attach.
- **The decision property test skips policies the boot check rejects** (`fc.pre`). They
  can never route traffic. The test still asserts that more than half of the 10 000 runs
  were checked.

## How it was verified

```bash
pnpm lint        # Checked … files. No fixes applied.
pnpm typecheck   # all packages pass
pnpm arch        # ✔ no dependency violations found
pnpm test        # Test Files 67 passed (67); Tests 740 passed | 12 skipped (752)
pnpm build       # pass
# routing dataset (002): route accuracy 100.0 % (44/44)
```

## Pending / follow-ups

- `T-005-03`: detector port, HTTP adapter, Zod mirror, cache.
- `T-005-04`: wires the inspection (removing `NOT_INSPECTED`), the headers
  `x-tamiz-sensitivity` and `x-tamiz-privacy`, and anonymization.
- No new backlog rows.

## Pitfalls for the next session

- **Any policy built in tests needs `privacy`.** Use `PERMISSIVE_PRIVACY` from
  `test/domain/helpers/policies.ts`. Its `localRoute` is `ollama-llama`, so custom
  target lists must include a local target with that id or override `localRoute`.
- **Callers of `decide` must handle `kind === "block"`.** `route-inference` and
  `stream-inference` return `blocked(decision)` before `executeChain`.
- **A Python-style `"\\n"` replace in a TypeScript test file did not match.** Edit
  string literals with line-based edits.

## Links

- Spec / plan / tasks: `specs/005-privacy-aware-routing/`
- ADRs: none added
- Related task records: `docs/tasks/done/T-005-01-spec-plan-tasks-005.md`, `docs/tasks/done/T-003-04-fallback-chain.md`
