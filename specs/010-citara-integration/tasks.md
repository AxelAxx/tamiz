# Tasks: Citara Integration

**Input**: Design documents from `specs/010-citara-integration/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/integration-contract.md, quickstart.md

**Tests**: Required. Every Given/When/Then scenario maps to one automated test
(constitution III); see the coverage table at the end. US5 is a recorded manual run.

**Backlog mapping**: T001 – T020 are backlog task `T-010-02`; T021 is `T-010-03`.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task)
- **[Story]**: the user story of spec.md the task serves

---

## Phase 1: Setup

- [ ] T001 Create the private workspace package `@tamiz/example-citara-client` in `examples/citara-client/` (`package.json` with scripts `start` = `node dist/main.js`, `test`, `typecheck`, `build`; dependencies `openai` pinned to exactly `7.47.0`, `zod`, `@tamiz/contracts`; `tsconfig.json` and `tsconfig.build.json` extending `@tamiz/tsconfig`; `vitest.config.ts`), add `examples/*` to `pnpm-workspace.yaml` and to `projects` in the root `vitest.config.ts`, and write the one-paragraph `examples/README.md` (runnable client examples, not shipped by Tamiz). Run `pnpm install`; `pnpm typecheck` and `pnpm build` must include the new package.

---

## Phase 2: Foundational (blocks every story)

- [ ] T002 Extend the E2E harness in `apps/gateway/scripts/e2e-gateway.ts` (research R-06, data-model section 6): `TAMIZ_E2E_PROVIDERS` = `none` (default, today's throwing providers, unchanged) | `scripted`; scripted targets answer `echo: <content of the last user message as received>` and stream it as two deltas plus usage; control endpoints `GET /__e2e/provider-calls` (`{ calls: [{ targetId, messages: [{ role, content }] }] }` in call order) and `POST /__e2e/provider-script` (`{ targetId, fail: "http_error" | "timeout" }`, that target fails every call until reset); `POST /__e2e/reset` also clears calls and scripts; always register client `citara` with key `TAMIZ_E2E_CITARA_KEY` (fixture default, like the `demo` key). Update the script's header comment. The dashboard's Playwright suite must pass unchanged.
- [ ] T003 [P] `examples/citara-client/src/config.ts`: Zod `ExampleConfig` exactly as data-model section 1 (`TAMIZ_BASE_URL` URL required; `TAMIZ_API_KEY` string ≥ 1 required; `TAMIZ_MODEL` default `tamiz-auto`; `TAMIZ_PROMPT` string ≥ 1 required, overridden by the CLI argument; `TAMIZ_STREAM` `true` | `false` default `false`; `TAMIZ_REQUEST_ID` `[A-Za-z0-9_-]{1,128}` optional; `TAMIZ_TIMEOUT_MS` int 1 000 … 600 000 default `70000`; `TAMIZ_ADMIN_KEY` optional; `TAMIZ_AUDIT_WAIT_MS` int 0 … 60 000 default `5000`). Invalid input → exit code `2`, message names the variable, never its value. Tests in `test/unit/config.test.ts`.
- [ ] T004 [P] `examples/citara-client/src/classify.ts`: error type → `ErrorClass` per data-model section 2 (`fix_request`: `invalid_request`, `unauthorized`, `forbidden`; `never`: `policy_blocked`, `provider_error`, `provider_timeout`, `internal`; `later`: `provider_unavailable`, `privacy_unavailable`, `rate_limited`), the status as fallback when the body is not an error envelope, and `retry-after` parsing ("read in seconds; absent → 1 s; capped at 30 s"). Use `ErrorTypeSchema` from `@tamiz/contracts`. Tests in `test/unit/classify.test.ts`.
- [ ] T005 [P] `examples/citara-client/src/report.ts`: `RunReport` as `key: value` lines in the field order of data-model section 3, then a blank line and the answer; a redaction guard that throws in tests if either key or the prompt would be written. Tests in `test/unit/report.test.ts`.
- [ ] T006 `examples/citara-client/test/global-setup.ts`: start `pnpm --filter @tamiz/gateway e2e-gateway` with `TAMIZ_E2E_PROVIDERS=scripted` on two free ports, wait for the readiness line, `provide` the base URL, control URL and fixture keys, kill the process on teardown; a `test/support/harness.ts` helper for reset, provider calls, provider script and detector outage.

**Checkpoint**: the harness answers with scripted providers; config, classification and report are unit-tested.

---

## Phase 3: User Story 1 — completions with only base URL and key (P1) 🎯 MVP

**Goal**: an unmodified OpenAI client gets completions through Tamiz and reports Tamiz's headers.

**Independent Test**: `test/e2e/us1.test.ts` against the harness.

- [ ] T007 [US1] Write `examples/citara-client/test/e2e/us1.test.ts` with one test per scenario US1-1 … US1-6 (US1-6: script the first target of the matched chain to fail with `http_error` and assert `fallback` lists it and `route` is the next target). The tests fail until T008.
- [ ] T008 [US1] `examples/citara-client/src/run-example.ts`: `runExample(config, deps: { fetch, sleep, now, write })` → exit code. One `OpenAI` client with `baseURL`, `apiKey`, `timeout`, `maxRetries: 0` and the injected `fetch`; `chat.completions.create({ model, messages: [{ role: "user", content }], stream? }, { headers: { "x-request-id" } }).withResponse()`; report every `x-tamiz-*` header verbatim, `request_id` from the response header, the completion (or the concatenated deltas and the usage chunk when streamed); on `APIError` report `status`, `error_type` (`error.type`), `retryable`; exit codes per data-model section 4.
- [ ] T009 [US1] `examples/citara-client/src/main.ts`: read `process.env` and the first CLI argument, call `runExample` with the global `fetch`, `setTimeout`-based `sleep`, `Date.now` and `process.stdout`, `process.exitCode` from the result.
- [ ] T010 [P] [US1] `examples/citara-client/test/unit/run-example.test.ts`: with a fake `fetch`, a 200, a streamed 200, a 401 (key absent from the whole output, US1-5), a network error (no retry, exit 1) and `attempts` counting.

**Checkpoint**: US1 green; the example is usable against any Tamiz.

---

## Phase 4: User Story 2 — personal data handled by the policy (P1)

**Goal**: the client-side view of each privacy action, with SDK retries replaced by the example's rule.

**Independent Test**: `test/e2e/us2.test.ts` against the harness.

- [ ] T011 [US2] Write `examples/citara-client/test/e2e/us2.test.ts`, one test per US2-1 … US2-5, asserting provider calls through `/__e2e/provider-calls` (US2-1: no non-local target called; US2-2: the provider's messages contain no `Ana García` or `612345678` and the printed answer contains both; US2-3: `tamiz-frontier` + `Ana García` → 451, `privacy: block`, `attempts: 1`, no provider called; US2-4: detector outage → `route: ollama-llama`; US2-5: model `tamiz-local` with the `ollama-llama` circuit opened through `/__e2e/circuit` with `cooldownMs: 1000` → 503 `provider_unavailable`, `retry_after: 1` reported, `retryable: true`, `attempts: 2`).
- [ ] T012 [US2] Retry rule in `examples/citara-client/src/run-example.ts`: for class `later`, sleep `retry-after` (via `classify.ts`) and send once more, then stop; never retry other classes or network errors (FR-010). Unit tests in `test/unit/run-example.test.ts` with a fake `sleep`: 503 then 200 → exit 0, `attempts: 2`; 503 twice → exit 1, `attempts: 2`; 451 → `attempts: 1`; a `retry-after` of 120 waits 30 s.

---

## Phase 5: User Story 3 — every request found in the audit log (P1)

**Goal**: the example proves its request is audited, by request id, without content.

**Independent Test**: `test/e2e/us3.test.ts` against the harness with the admin fixture key.

- [ ] T013 [US3] Write `examples/citara-client/test/e2e/us3.test.ts`, one test per US3-1 … US3-5 (US3-1 with the `citara` key: `clientId` `citara`, route, rule and sensitivity equal the reported headers; US3-3: a unique marker in the prompt appears 0 times in the printed audit line and in the output outside the answer; US3-4: `TAMIZ_AUDIT_WAIT_MS=0` against a reset harness or an id that cannot match → `audit_error: not_found`, exit 1; US3-5: client key as admin key → `audit_error: forbidden`, exit 1, one audit request).
- [ ] T014 [US3] `examples/citara-client/src/audit-check.ts` per data-model section 5 and research R-07: `from = startedAt − 5 s`, `limit = 200`, follow `nextCursor` at most 5 pages, match `requestId`, poll every 250 ms until `startedAt + TAMIZ_AUDIT_WAIT_MS`; 401/403 end at once; parse pages with `AuditPageSchema` from `@tamiz/contracts`. Unit tests in `test/unit/audit-check.test.ts` (found on page 2, found on the third poll, deadline, 403, malformed page → failure).
- [ ] T015 [US3] Wire the audit check into `runExample` (only when `TAMIZ_ADMIN_KEY` is set and the gateway answered, including a 451): print `audit` as one JSON line or `audit_error`; exit 0 only if answered and found (FR-012).

---

## Phase 6: User Story 4 — accurate and complete guide (P2)

**Goal**: one page a Citara developer can follow without reading Tamiz's code.

**Independent Test**: `test/guide.test.ts`.

- [ ] T016 [US4] Write `docs/integrations/citara.md` and the one-paragraph `docs/integrations/README.md`. Sections: what the integration is (and that Citara's own changes live in Citara's repository); quick start with the example; issuing a key (database and environment ways, FR-002); base URL for same-network and remote/TLS deployments (R-12); model aliases (marked table `<!-- table:models -->`); response headers (`<!-- table:headers -->`); errors with retry guidance (`<!-- table:errors -->`, wording "never", "after fixing the request", "later"); client timeouts and retries (R-03, FR-005); streaming and cancellation; tool calling (pointer to `specs/009-mcp-agent/tool-calling/`); what Tamiz stores and never stores (FR-004); limitations: statistical detection with a link to the README eval results (FR-007); example configuration (`<!-- table:config -->`); a `curl` example. Content in English, synthetic values only.
- [ ] T017 [US4] Write `examples/citara-client/test/guide.test.ts`, one test per US4-1 … US4-4 (research R-09): headers vs the 200 response headers that the harness's `/openapi.json` declares for `POST /v1/chat/completions` plus `retry-after`; errors vs `errorTypeToHttpStatus` limited to the statuses that operation documents plus `internal`, each with one of the three guidance values; config vs the keys of `ExampleConfig`; models: one harness request per alias, `x-tamiz-rule` equals the table (`tamiz-auto` row: any rule other than `pinned-local` and `pinned-frontier`).

---

## Phase 7: Polish and cross-cutting

- [ ] T018 [P] `examples/citara-client/README.md` (purpose, variables link to the guide, how to run against the harness); `CLAUDE.md` section 6 layout (`examples/`, `docs/integrations/`) and section 12 command (`pnpm --filter @tamiz/example-citara-client start -- "<prompt>"`).
- [ ] T019 Verify: `pnpm lint`, `pnpm typecheck`, `pnpm arch`, `pnpm test`, `pnpm build` green; `git diff --stat origin/main -- apps/gateway/src apps/gateway/policies packages services` is empty (FR-015); the dashboard Playwright suite against the default harness is unchanged (run locally if browsers are installed, otherwise the CI `ci` check). Walk through `quickstart.md` section 2 by hand and paste the output (keys redacted) into the task record.
- [ ] T020 Task record `docs/tasks/done/T-010-02-citara-guide-and-client.md` and the `T-010-02` row set to `done` in `docs/tasks/BACKLOG.md`, same commit.

---

## Phase 8: User Story 5 — full stack run (P3, backlog `T-010-03`)

- [ ] T021 [US5] After `T-OPS-01`: run `quickstart.md` section 3 against `docker compose up` with a `citara` client key and an admin key; record the output (keys redacted) in `docs/tasks/done/T-010-03-citara-compose-run.md`; set `T-010-03` to `done`.

---

## Dependencies and execution order

- T001 → T002 – T006 (T003, T004, T005 in parallel; T006 needs T002).
- US1 (T007 – T010) needs Phase 2. US2 (T011, T012) and US3 (T013 – T015) need T008; they
  touch `run-example.ts` in turn, so run them one after the other (US2 then US3).
- US4: T016 can start after T003 (config keys known); T017 needs T006 and T016.
- Polish after all stories; T021 only after `T-OPS-01` and T020.

### Parallel opportunities

- T003, T004, T005 (different files).
- T010 alongside T011 once T008 exists.
- T016 (the guide) alongside Phases 3 – 5.

## Implementation strategy

MVP is US1 (T001 – T010): an example that works against any Tamiz and reports its
headers. US2 and US3 add the privacy and audit proofs the backlog asks for; US4 makes the
guide trustworthy. All of it lands in one PR (`T-010-02`); the recorded compose run is a
separate PR (`T-010-03`).

## Scenario coverage

| Scenario | Test | Task |
|---|---|---|
| US1-1 … US1-6 | `test/e2e/us1.test.ts` (one `it` each) | T007 |
| US2-1 … US2-5 | `test/e2e/us2.test.ts` | T011 |
| US3-1 … US3-5 | `test/e2e/us3.test.ts` | T013 |
| US4-1 … US4-4 | `test/guide.test.ts` | T017 |
| US5-1 | recorded manual run | T021 |
| Edge: client retries, retry-after cap | `test/unit/run-example.test.ts` | T012 |
| Edge: client timeout above the deadline | `test/unit/config.test.ts` (default 70000) | T003 |
| Edge: malformed correlation id | `test/unit/config.test.ts` (rejected at start) and US1-4 | T003, T007 |
| Edge: audit write timing | `test/unit/audit-check.test.ts` (found on the third poll) | T014 |
| Edge: stream cancelled, tools, unknown model names | guide content (no example behaviour) | T016 |
