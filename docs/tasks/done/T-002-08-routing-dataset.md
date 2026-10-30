# T-002-08 — Routing dataset v1 and gate test

| Field | Value |
|---|---|
| Task | `T-002-08` (see `docs/tasks/BACKLOG.md`) |
| Feature | `002-provider-routing` |
| Spec | `specs/002-provider-routing/spec.md` (US8-1 … US8-4, FR-036 … FR-038, SC-001, SC-009); `tasks.md` Phase 7 (T071–T073); `research.md` R-13; `data-model.md` §6 |
| Branch / PR | `T-002-08-routing-dataset` / PR opened after this commit |
| Date | 2026-10-30 |
| Session | Claude Code (Claude Opus 5.5), side session (merge authority delegated by Alex for the session) |
| Status | done. SC-009 is only partly verified (see How it was verified). |

## What was done

`packages/evals/datasets/routing.v1.jsonl` holds 44 synthetic Spanish and English cases
bound to `apps/gateway/policies/default.yaml`, after a header that declares the dataset,
the version, the policy and `synthetic: true` (FR-036, FR-038). Coverage:

- every task type has at least 6 cases (code 8, translate 7, extract 7, classify 7,
  summarize 6, chat 9);
- every size is represented (short, medium from 2 049 to 16 384 characters, long above
  16 400);
- 3 mixed-cue cases, 4 `tamiz-local`, 5 unknown models (`gpt-4o`, `claude-3`), one
  without a `model`, and one multi-turn case where only the last user message counts.

The gate `apps/gateway/test/evals/routing-dataset.test.ts` validates the header and every
case with a local Zod schema, and checks unique ids, at least 40 cases and full type and
size coverage (US8-3). It loads the policy named in the header through `loadPolicyFile`
from the repository root and runs `classifyTask` plus `decide` on each case, with no
adapter and no network (US8-4). It prints a mismatch table and the route, task-type and
size accuracy, and fails below 95 % expected routes (US8-1, US8-2, FR-037). This
completes feature 002.

## Files touched

- `packages/evals/datasets/routing.v1.jsonl`: the dataset (T071).
- `packages/evals/README.md`: datasets live here until feature 007 brings the runner (T071).
- `apps/gateway/test/evals/routing-dataset.test.ts`: the gate (T072).
- `docs/tasks/BACKLOG.md`: `T-002-08` row set to `done` (that row only).

## Decisions

- **The expectations were computed by hand, not by running the classifier.** For each
  case I applied the cue table (`task-classifier.ts`), the precedence
  code → translate → extract → classify → summarize, the size thresholds and the policy
  rules. Reading the rules of `default.yaml` in order gives:
  - `tamiz-local` → `ollama-llama`;
  - code → `anthropic-sonnet`;
  - summarize or extract, long → `mistral-small`;
  - classify, translate, extract or summarize, short or medium → `ollama-llama` (the
    cheapest target first);
  - everything else (chat, and long classify or translate) → `mistral-small`.

  The first run matched 44/44 on route, type and size.
- **The filler paragraphs contain no cue words.** "fields", "category", "resume",
  "code", "clase", "campos", "etiqueta" and similar were all avoided. Medium cases repeat
  a ~370-character paragraph 8 times and long cases 50 times. The file is therefore
  130 KB, mostly filler, as T071 asks for literal text.
- **A small generator script, not committed**, assembled the JSONL (filler repetition,
  ids, header); the expectations in it were typed by hand. I left it out: until
  feature 007 the dataset itself is the reviewable artifact, and nothing else in the
  repository generates data. If hand-editing the long lines becomes painful, a backlog
  task can add the generator to `packages/evals` with the runner.
- **The gate also reports size accuracy**, besides route and task type, because a size
  error would silently change the route of the long-document and cheap-task rules.
- **`expect(…, report)`** puts the whole mismatch table into the failure message, so a CI
  failure shows every case without rerunning.

## How it was verified

```bash
pnpm --filter @tamiz/gateway exec vitest run test/evals/routing-dataset.test.ts --reporter=default
#  mismatches: none
#  route accuracy: 100.0 % (44/44)
#  task-type accuracy: 100.0 % (44/44)
#  size accuracy: 100.0 % (44/44)
#  Tests 3 passed
```

Quickstart §9 (US8-2):

- With one expectation broken (`routing-038` → `openai-mini`), the table lists
  `routing-038 | openai-mini → mistral-small | …`, route accuracy is 97.7 % (43/44), and
  the test passes.
- With three broken (038, 039, 040), route accuracy is 93.2 % (41/44) and the test fails
  with the three ids in the assertion message.
- The dataset was then regenerated.

Root gates: `pnpm lint` (144 files), `pnpm typecheck`, `pnpm arch` (61 modules, no
violations), `pnpm test --coverage` (45 files, 492 tests, no type errors) and `pnpm build`,
all green.

SC-009, timed from a fresh `git clone` of `main` (8eb3f44) into a short temporary path:

- clone 1 s, `pnpm install --frozen-lockfile` 6 s (warm pnpm store), `pnpm build` 4 s,
  `generate-api-key` 1 s;
- `TAMIZ_POLICY_FILE=policies/local-only.yaml pnpm --filter @tamiz/gateway dev` listening
  in about 1 s;
- the quickstart §2 request answered **502** with `x-tamiz-route: ollama-llama`,
  `x-tamiz-rule: default`, because **no Ollama was running on this machine**.

So the setup part of SC-009 takes about 15 s, far inside the 10 minutes. The "routed,
costed answer" from a real local model is **not verified** here.

## Pending / follow-ups

- SC-009 against a live Ollama (`ollama pull llama3.1:8b`). This is a manual check on a
  machine with Ollama, not a code task.
- `T-007-04` moves the scoring into the eval runner, as the backlog already says.
- No new backlog rows.

## Pitfalls for the next session

- **Vitest 4 picks a quiet reporter in this agent environment:** the output of passing
  tests, `console.log` included, is not printed. Use `--reporter=default` to see the
  accuracy report. This also explains the T-002-04 pitfall about "swallowed" logs; grep
  was not the cause.
- **A fresh clone under the deep scratchpad path fails on Windows** (`Filename too long`
  in `test/arch-fixtures`). Clone into a short path.
- **`pnpm dev` (tsx watch) starts child processes.** Killing the port's owner leaves the
  watcher alive; stop every `node` process whose command line contains the clone path.
- **Any change to the default policy or the cue table must update the expectations in
  the same PR**; the gate fails otherwise, by design.

## Links

- Spec / plan / tasks: `specs/002-provider-routing/{spec,tasks,quickstart}.md` (Phase 7, §2, §9), `research.md` R-07, R-13, `data-model.md` §6
- ADRs: none added
- Related task records: `docs/tasks/done/T-002-05-policy-file.md`, `docs/tasks/done/T-002-02-domain-routing-model.md`, `docs/tasks/done/T-002-07-cost-per-request.md`
