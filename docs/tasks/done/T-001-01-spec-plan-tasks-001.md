# T-001-01 — Spec, plan and tasks for `001-contracts-and-skeleton`

| Field | Value |
|---|---|
| Task | `T-001-01` (see `docs/tasks/BACKLOG.md`) |
| Feature | `001-contracts-and-skeleton` |
| Spec | `specs/001-contracts-and-skeleton/spec.md` |
| Branch / PR | `001-contracts-and-skeleton` (Spec Kit naming, see `CLAUDE.md` section 8) / PR opened after this commit |
| Date | 2026-10-18 |
| Session | Claude Code (Claude Fable 5.1) |
| Status | done (spec approved by Alex on 2026-10-18 in PR #1; `T-001-02` may start) |

## What was done

Wrote the complete Spec Kit set for feature 001 with the `/speckit-specify`,
`/speckit-plan`, `/speckit-tasks` and `/speckit-analyze` skills: `spec.md` (7 user
stories, 36 Given/When/Then scenarios, FR-001 … FR-026, SC-001 … SC-007, 10 edge cases,
assumptions), `plan.md` (technical context, constitution check with no violations,
project structure, requirement → backlog-task mapping), `research.md` (12 decisions
R-01 … R-12 checked against current library docs), `data-model.md` (schemas, branded
types, `Result`, `DomainError`, `GatewayConfig`, `ClockPort`), `contracts/openapi.yaml`
(review projection, not shipped), `quickstart.md` (verification steps per story) and
`tasks.md` (77 tasks in 5 phases, one per backlog task `T-001-02` … `T-001-06`, with a
scenario → task coverage table). The analysis pass found 0 critical, 0 high, 3 medium and
5 low findings; all were fixed in place before this commit (see Decisions).

## Files touched

- `specs/001-contracts-and-skeleton/spec.md` — specification.
- `specs/001-contracts-and-skeleton/checklists/requirements.md` — spec quality checklist (all items pass, with notes).
- `specs/001-contracts-and-skeleton/plan.md` — implementation plan.
- `specs/001-contracts-and-skeleton/research.md` — decisions R-01 … R-12.
- `specs/001-contracts-and-skeleton/data-model.md` — contract and domain types.
- `specs/001-contracts-and-skeleton/contracts/{README.md,openapi.yaml}` — review projection of the contracts.
- `specs/001-contracts-and-skeleton/quickstart.md` — how to verify the feature.
- `specs/001-contracts-and-skeleton/tasks.md` — 77 tasks, phases = backlog tasks.
- `docs/tasks/BACKLOG.md` — `T-001-01` → `done`; note about the review gate.
- `docs/tasks/done/T-001-01-spec-plan-tasks-001.md` — this record.

## Decisions

- **Tasks are grouped by backlog task, not by user story.** Spec Kit's template groups
  by story; here each phase is one `T-001-0N` row = one PR, and the `[USn]` label keeps
  the story mapping. Rationale: the backlog is the session-sized unit of this project.
- **Tests are mandatory in `tasks.md`.** Spec Kit treats test tasks as optional; the
  constitution (III) makes Given/When/Then → test mandatory, so every scenario has a test
  task and the coverage table at the top of `tasks.md` is the 1:1 map.
- **Vitest `projects` instead of `vitest.workspace.ts`.** The backlog row `T-001-06`
  says `vitest.workspace.ts`; Vitest deprecated the workspace file in 3.2 in favour of
  `test.projects` in the root config. The plan uses `projects`; the backlog row wording
  was left as is (the deliverable is "shared root Vitest config").
- **Root `pnpm test` runs Vitest directly, not `turbo run test`**, so one process reports
  every package and one coverage table (R-02 exception; `pnpm test:packages` keeps the
  cached per-package run).
- **`ClockPort` stays in the gateway; `FakeClock` satisfies it structurally** (R-09). No
  `@tamiz/ports` package until a second shared port exists (constitution X).
- **OpenAPI file in `contracts/` is a review projection**, deleted when `@hono/zod-openapi`
  generates the real one in feature 002 (constitution II: never hand-written as source).
- **Zod 4**, `z.strictObject` for unknown-key rejection, `.brand<"X">()` for branded
  types (R-07). Works with `@hono/zod-validator` and AI SDK 6.
- **husky + commitlint** over `simple-git-hooks`/`lefthook` (what commitlint documents).
- **Single CI job named `ci`** so branch protection requires exactly one status.
- **Analysis remediations applied before review**: no required env variables exist, so
  US4/FR-015 now say "invalid value" (missing is reserved for future settings); the root
  manifest test moved into `apps/gateway/test/` because no root Vitest config exists
  before Phase 5; the request-id middleware validates against the `RequestId` charset
  so an echoed id never fails the envelope schema; `resolveJsonModule` added to the
  tsconfig flags; the presentation rule no longer duplicates the infrastructure rule;
  FR-016 lists the full redact path set; the pipeline-cache edge case was reworded.
- **Spec status stays `Draft`.** The backlog definition of done includes "reviewed by
  Alex"; the artefacts are complete, the review is the gate. After review, flip
  `**Status**` in `spec.md` to `Approved` in the PR before merging.

## How it was verified

No code exists yet; verification is structural.

```bash
powershell.exe -NoProfile -File .specify/scripts/powershell/create-new-feature.ps1 -Json -ShortName contracts-and-skeleton -Number 1 "..."
# -> {"BRANCH_NAME":"001-contracts-and-skeleton","SPEC_FILE":"...\\specs\\001-contracts-and-skeleton\\spec.md","FEATURE_NUM":"001"}
powershell.exe -NoProfile -File .specify/scripts/powershell/setup-plan.ps1 -Json      # plan template copied
powershell.exe -NoProfile -File .specify/scripts/powershell/setup-tasks.ps1 -Json     # AVAILABLE_DOCS: research, data-model, contracts/, quickstart
powershell.exe -NoProfile -File .specify/scripts/powershell/check-prerequisites.ps1 -Json -RequireSpec -RequireTasks -IncludeTasks
```

`/speckit-analyze`: 26 FR + 7 SC, 77 tasks, 100 % FR coverage, 0 critical, 0 high,
3 medium (fixed), 5 low (fixed). Library facts in `research.md` were checked against
current documentation (Context7) on 2026-10-18: Vitest `projects`, Zod 4
`strictObject`/`brand`, Biome 2 `extends: "//"`, pino `redact` paths, Hono `requestId`
and `app.request`, commitlint + husky, Turborepo 2 `tasks`.

## Pending / follow-ups

- **Alex reviews** `spec.md`, `plan.md`, `tasks.md`; on approval flip the spec status to
  `Approved`, merge the PR, then start `T-001-02`.
- `T-002-01` (spec for `002-provider-routing`) depends only on this task and can start
  on the same day; it must reuse `ChatCompletionRequest`/`Response` from
  `data-model.md` sections 2–3 and the `ErrorType` list of section 5.
- Manual one-time steps surfaced by the plan, to be done inside their tasks: install the
  Renovate GitHub App (`T-001-02`), configure branch protection with `gh api`
  (`T-001-05`).
- Feature 002 deletes `specs/001-contracts-and-skeleton/contracts/openapi.yaml` once the
  generated OpenAPI exists (`tasks.md` T076).

## Pitfalls for the next session

- The Spec Kit scripts no longer create git branches (`create-new-feature.ps1` only
  writes the folder, `spec.md` and `.specify/feature.json`). Create the branch yourself
  before running the script: `git checkout -b 001-contracts-and-skeleton`.
- The scripts read the current feature from `$env:SPECIFY_FEATURE` or
  `.specify/feature.json` (gitignored, per checkout). From Git Bash call them as
  `SPECIFY_FEATURE=001-contracts-and-skeleton powershell.exe -NoProfile -File .specify/scripts/powershell/<script>.ps1 -Json`.
- Pass `-Number 1 -ShortName contracts-and-skeleton` so the folder matches the roadmap
  name; without `-ShortName` the script derives a name from the description.
- The spec template's quality checklist says "no implementation details"; for this
  foundation feature the constitution mandates several technology-level facts (strict TS
  flags, Conventional Commits, Node 22). They were kept in the spec and justified in
  `checklists/requirements.md` note 1. Later features should keep tool names out of
  `spec.md`.
- `/speckit-tasks` asks to group by user story; grouping by backlog task is a deliberate
  project deviation, documented at the top of `tasks.md`. Keep doing it for later
  features so `tasks.md` phases and backlog rows stay aligned.

## Links

- Spec / plan / tasks: `specs/001-contracts-and-skeleton/{spec,plan,tasks}.md`
- Design: `specs/001-contracts-and-skeleton/{research,data-model,quickstart}.md`, `contracts/`
- ADRs: `docs/adr/ADR-0001-clean-architecture-contract-first.md` (layers, contract-first), ADR-0002 (English), ADR-0003 (licence)
- Related task records: `docs/tasks/done/T-000-01-bootstrap.md` (Spec Kit install, pitfalls), `docs/tasks/done/T-OPS-00-github-remote.md` (branch protection deferred to `T-001-05`)
