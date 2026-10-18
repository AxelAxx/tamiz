# T-002-01 — Spec, plan and tasks for `002-provider-routing`

| Field | Value |
|---|---|
| Task | `T-002-01` (see `docs/tasks/BACKLOG.md`) |
| Feature | `002-provider-routing` |
| Spec | `specs/002-provider-routing/spec.md` |
| Branch / PR | `002-provider-routing` (Spec Kit naming), rebased onto `main` after PR #1 (001) was squash-merged / PR opened after this commit |
| Date | 2026-10-18 |
| Session | Claude Code (Claude Fable 5.1), side session started from the `T-001-01` session |
| Status | done (artefacts written and self-checked); **Alex's review pending**: `spec.md` stays `Status: Draft` until he approves, which is the gate for `T-002-02` |

## What was done

Wrote the complete Spec Kit set for feature 002 with `/speckit-specify`,
`/speckit-plan`, `/speckit-tasks` and `/speckit-analyze`: `spec.md` (8 user stories, 46
Given/When/Then scenarios, FR-001 … FR-038 grouped by backlog task, SC-001 … SC-009 with
the ≥ 95 % routing threshold as SC-001, 13 edge cases, assumptions), `plan.md`
(technical context, constitution check with no violations, project structure,
requirement → backlog-task mapping), `research.md` (R-01 … R-15, library facts checked
against current docs), `data-model.md` (contract extensions, domain types, ports, use
cases, configuration, dataset format), `contracts/{README,http}.md`,
`contracts/policy.example.yaml`, `contracts/routing-dataset.example.jsonl`,
`quickstart.md` and `tasks.md` (77 tasks in 7 phases = backlog tasks `T-002-02` …
`T-002-08`, plus polish, with the scenario → task coverage table). The analysis pass found
0 critical, 1 high, 4 medium and 5 low findings; all fixed in place (see Decisions).

The backlog gains one row, `T-002-08` (routing dataset v1 and gate test), because the
dataset and its ≥ 95 % check are a session of their own and no existing row covered them.

## Files touched

- `specs/002-provider-routing/spec.md` — specification.
- `specs/002-provider-routing/checklists/requirements.md` — spec quality checklist (all pass, with notes).
- `specs/002-provider-routing/plan.md` — implementation plan.
- `specs/002-provider-routing/research.md` — decisions R-01 … R-15.
- `specs/002-provider-routing/data-model.md` — contract extensions, domain and application shapes, config, dataset.
- `specs/002-provider-routing/contracts/{README.md,http.md,policy.example.yaml,routing-dataset.example.jsonl}` — review projections.
- `specs/002-provider-routing/quickstart.md` — how to verify the feature.
- `specs/002-provider-routing/tasks.md` — 77 tasks, phases = backlog tasks.
- `docs/tasks/BACKLOG.md` — `T-002-01` → `done`; new row `T-002-08`.
- `docs/tasks/done/T-002-01-spec-plan-tasks-002.md` — this record.

## Decisions

- **Domain-owned branded units (R-01).** The 001 rule `domain-imports-nothing` forbids
  even type-only imports from `@tamiz/contracts`, and Zod brands cannot be reproduced by
  hand, so `apps/gateway/src/domain/model/units.ts` declares the domain's own `Usd`,
  `Milliseconds`, `PolicyId`, `TargetId`, `RuleId`, `RequestId`, `ClientId`; mappers at
  the edges convert. **Flagged for Alex**: the alternative is to relax the 001 rule to
  allow type-only imports; the plan keeps the stricter rule and names the option.
- **Closed lists declared twice with a drift test (R-03)** as a consequence of R-01.
- **Client `model` is a hint, not a command.** Rules may condition on it
  (`when.requestedModel`, e.g. `tamiz-local`); unknown values fall through to the
  default chain; the response `model` reports the real provider model.
- **Chain computed, only `chain[0]` executed.** Fallback execution, retries and the
  residency guard are feature 003; a primary failure is 502 `provider_error` or 504
  `provider_timeout` (new error type, extends the 001 list).
- **AI SDK 6 with `maxRetries: 0` (R-04)**: Tamiz's own resilience must be the only
  retry layer. One generic `createAiSdkProvider()` factory; the four adapters are
  configurations (Ollama through `@ai-sdk/openai-compatible`).
- **API keys as SHA-256 hashes in `TAMIZ_API_KEYS` (R-10)**, constant-time compare over
  every record, `tmz_` prefix, `generate-api-key` script; feature 006 moves the records
  to Postgres. At least one key is required to boot (first required env variable; it
  activates the "missing variable" branch of 001 FR-015).
- **Policy file in YAML validated by `RoutingPolicySchema` in contracts (R-09)**, then
  domain `validatePolicy` for cross-field rules; boot also cross-checks that every
  provider used by a target is configured (R-12).
- **Rule-level timeout** added during analysis so the constitution's "timeouts per
  provider and per task type" is literal: `rule.timeoutMs ?? target.timeoutMs ??
  policy.defaultTimeoutMs`.
- **Cost as `usage.cost_usd` + `usage.estimated`** (backlog `T-002-07` says "usage
  extension"); usage missing from the provider is estimated and flagged, never zero.
- **Routing dataset bound to a policy file (R-13)**: header names the policy; the gate
  test lives in `apps/gateway/test/evals/` until feature 007 makes `packages/evals` a
  workspace package (a library must not depend on the app).
- **`user` field never forwarded to providers** (privacy by default).
- **Analysis remediations applied before review**: coverage table for Phase 4 pointed
  one task too high (fixed); `FINISH_REASONS` location fixed to the port file; finish
  reason `error` now consistently a malformed response; `classify()` no longer takes
  the unused requested model; Phase 7 dependencies include Phase 2; dataset policy path
  resolved from the repository root; `createdAt` assigned in the use case; FR-012's cost
  step explicitly delivered by `T-002-07`.
- **Spec status stays `Draft`** until Alex reviews; flip to `Approved` in the PR before
  merging.

## How it was verified

No code exists yet; verification is structural.

```bash
git checkout -b 002-provider-routing 001-contracts-and-skeleton
powershell.exe -NoProfile -File .specify/scripts/powershell/create-new-feature.ps1 -Json -Number 2 -ShortName provider-routing "..."
# -> {"BRANCH_NAME":"002-provider-routing","SPEC_FILE":"...\\specs\\002-provider-routing\\spec.md","FEATURE_NUM":"002"}
SPECIFY_FEATURE=002-provider-routing powershell.exe -NoProfile -File .specify/scripts/powershell/setup-plan.ps1 -Json
SPECIFY_FEATURE=002-provider-routing powershell.exe -NoProfile -File .specify/scripts/powershell/setup-tasks.ps1 -Json   # AVAILABLE_DOCS: research, data-model, contracts/, quickstart
SPECIFY_FEATURE=002-provider-routing powershell.exe -NoProfile -File .specify/scripts/powershell/check-prerequisites.ps1 -Json -RequireSpec -RequireTasks -IncludeTasks
```

`/speckit-analyze`: 38 FR + 9 SC, 46 scenarios, 77 tasks, 100 % FR and scenario
coverage, 0 critical, 1 high, 4 medium, 5 low (all fixed). Library facts checked on
2026-10-18 (Context7): AI SDK 6 `generateText` (`maxRetries` default 2, `abortSignal`,
`usage.inputTokens/outputTokens`, `APICallError.isInstance`/`statusCode`),
`@ai-sdk/openai-compatible` `createOpenAICompatible({ name, baseURL }).chatModel`,
`@hono/zod-openapi` (`OpenAPIHono`, `createRoute`, `app.doc`), `@hono/zod-validator`
peer `zod ^3.25 || ^4`.

## Pending / follow-ups

- **Alex reviews** `spec.md`, `plan.md`, `tasks.md`; decides on R-01 (domain brands vs
  type-only imports); on approval flip the spec status to `Approved`, merge the PR
  (after `001-contracts-and-skeleton`), then start `T-002-02` once `T-001-06` is done.
- The branch was first created from `001-contracts-and-skeleton` (so the 001 artefacts
  were in the tree) and rebased onto `main` once PR #1 had been squash-merged; the PR
  targets `main`.
- New backlog row `T-002-08` (routing dataset v1 and gate test); `T-003-01` and
  `T-005-01` depend on this task and can start.
- `T-002-06` deletes `specs/001-contracts-and-skeleton/contracts/openapi.yaml` (001
  tasks T076).

## Pitfalls for the next session

- Spec branches that start from an unmerged sibling branch must be rebased with
  `git rebase --onto origin/main <old-base-commit>` once that sibling is
  squash-merged, or the PR will re-add the sibling's files.
- Same script pitfalls as `T-001-01`: create the git branch yourself, pass
  `SPECIFY_FEATURE=002-provider-routing` from Git Bash, pass `-Number 2 -ShortName
  provider-routing`. `.specify/feature.json` is per checkout and gitignored.
- A Bash heredoc of a few hundred lines fails on Windows with `ENAMETOOLONG` (the whole
  command becomes the spawn argument); write long files with the Write tool.
- Domain and application cannot import `@tamiz/contracts` (001 rules). When writing
  tasks for later features, put DTO ↔ domain conversions in `presentation/mappers` or
  the infrastructure adapter, never in the use case.
- The constitution's "timeouts per provider and per task type" is a code convention
  that is easy to miss in a spec: the rule-level timeout covers it here; feature 003
  must keep both levels.
- `@hono/zod-openapi` exports its own `z`; the plan passes plain `zod` 4 schemas from
  contracts and relies on native `.meta()` for descriptions (R-11). If the generated
  document lacks descriptions in `T-002-06`, add a thin helper in presentation; do not
  add `@hono/zod-openapi` to the contracts package (001 FR-012).

## Links

- Spec / plan / tasks: `specs/002-provider-routing/{spec,plan,tasks}.md`
- Design: `specs/002-provider-routing/{research,data-model,quickstart}.md`, `contracts/`
- Feature 001 artefacts reused: `specs/001-contracts-and-skeleton/{data-model,plan,research}.md`
- ADRs: `docs/adr/ADR-0001-clean-architecture-contract-first.md`, ADR-0002, ADR-0003
- Related task records: `docs/tasks/done/T-001-01-spec-plan-tasks-001.md` (conventions and script pitfalls), `docs/tasks/done/T-000-01-bootstrap.md`
