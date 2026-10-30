---

description: "Task list for feature 005-privacy-aware-routing"
---

# Tasks: Privacy-Aware Routing

**Input**: Design documents from `specs/005-privacy-aware-routing/`

**Prerequisites**: `plan.md`, `spec.md`, `research.md` (R-01 … R-12), `data-model.md`,
`contracts/{http.md,policy.example.yaml,simulate.example.json,placeholder-vectors.json}`,
`quickstart.md`; features 002–004 merged (`main` at 436d2d2 or later); this spec approved
by Alex (`T-005-01`).

**Tests**: Mandatory. Constitution III requires every Given/When/Then of `spec.md` to map
one-to-one to a test; the "Scenario coverage" table below is that mapping. Write each test
before the code it covers and watch it fail first.

**Organization**: Phases are the backlog tasks `T-005-02` … `T-005-06` of
`docs/tasks/BACKLOG.md` (one session, one PR each), as in features 001–004. The `[USn]`
label keeps the mapping to the spec's user stories. Within a phase the order is tests →
implementation → verification → task record.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel with its neighbours (different files, no dependency on an
  unfinished task).
- **[Story]**: user story of `spec.md` (`US1` … `US7`).
- Paths are repository-relative. `gateway/` abbreviates `apps/gateway/`, `contracts/`
  abbreviates `packages/contracts/`.

## Scenario coverage

| Spec scenario | Task | Spec scenario | Task |
|---|---|---|---|
| US1-1 DNI → local only, headers | T002, T027 | US4-1 split placeholder restored once | T038 |
| US1-2 no data → 003 behaviour | T002, T027 | US4-2 non-placeholder text forwarded at once | T038 |
| US1-3 `block` → 451, no call | T002, T027, T028 | US4-3 false prefix released unchanged | T038 |
| US1-4 level residency filters the chain | T002, T027 | US4-4 flush before usage chunk | T038, T039 |
| US1-5 empty chain → 451 | T002, T027 | US4-5 any chunking = non-streaming | T038 |
| US1-6 local failure never falls back outside | T027 | US5-1 DNI simulated → critical, local chain, no call | T045 |
| US2-1 provider sees no value, all roles | T027 | US5-2 `anonymize` shows provider messages | T045 |
| US2-2 same value across messages, one placeholder | T025 | US5-3 no values, not recorded | T045 |
| US2-3 unmapped placeholder-like text untouched | T025 | US5-4 API key required | T046 |
| US2-4 versioned notice added and reported | T027, T028 | US6-1 missing `privacy` section → boot error | T002, T004 |
| US2-5 mapping nowhere but request scope | T029 | US6-2 unsafe `critical` → boot error | T002 |
| US2-6 usage and cost of anonymized exchange | T027 | US6-3 non-local `localRoute` → boot error | T002 |
| US3-1 unreachable → `onDetectorError`, `unknown`, event | T015, T027 | US6-4 shipped policies valid, routing dataset ≥ 95 % | T004 |
| US3-2 timeout bounded | T015 | US7-1 cache hit skips the detector | T015 |
| US3-3 contract mismatch = failure | T013 | US7-2 cache holds no text or values | T014 |
| US3-4 `block` on failure → 503 | T027, T028 | US7-3 options change → miss | T015 |
| US3-5 no privacy URL → boot error | T016 | US7-4 bounded size, oldest evicted | T014 |

Spec edge cases:
- a boundary-crossing finding: T013;
- altered or invented placeholders: T025;
- existing placeholders: T025;
- client disconnect before detection ends: T015;
- `restrict_to_local` with the local circuit open: T027;
- a blocked stream: T039;
- simulating a block: T045.

---

## Phase 1: `T-005-02` — Domain: sensitivity, privacy actions, policy section (US6, US1)

**Goal**: levels, actions and the policy's `privacy` section in contracts and domain;
`decide()` returns `route | block` with privacy applied; the shipped policies move to
version 3. **Independent test**: the domain and policy suites pass, including at least
10 000 property cases, and `pnpm arch` stays green.

### Tests first

- [x] T001 [P] [US6] `contracts/test/routing-policy-privacy.test.ts`:
  - the `privacy` section is required and its four levels are required;
  - actions and `onDetectorError` are closed enums, and `allow` is rejected there;
  - unknown keys are rejected.
- [x] T002 [P] [US6] [US1] `gateway/test/domain/privacy-policy.test.ts`:
  - `validatePrivacy` rejects a non-local `localRoute` (US6-3) and `critical: allow`
    without residencies ⊆ {local, eu} (US6-2);
  - `applyPrivacy` for each action (US1-1 … US1-5);
  - a missing section is an issue (US6-1).
- [x] T003 [P] [US1] `gateway/test/domain/privacy-decision.property.test.ts`
  (`fast-check`, ≥ 10 000 runs): over random policies, rules, levels and inspections, a
  `critical` route never contains a target outside {local, eu} unless the action is
  `anonymize`, and `block` has no chain (SC-001, FR-005).
- [x] T004 [P] [US6] `gateway/test/policy/shipped-policies.test.ts` and
  `boot.integration.test.ts`:
  - `default.yaml` and `local-only.yaml` load at version 3;
  - a policy without `privacy` exits 1, naming it;
  - `test/evals/routing-dataset.test.ts` still reaches ≥ 95 % (US6-4).
- [x] T005 [P] `gateway/test/domain/sensitivity.test.ts`: ordered levels, `sensitivityOf`
  (`unknown` on failure), `ENTITY_KINDS` matching the privacy service's list.

### Implementation

- [x] T006 `contracts/src/routing-policy.ts`:
  - add `SensitivityLevelSchema`, `PrivacyActionSchema`, `PrivacyLevelSchema` and
    `PrivacySectionSchema`;
  - add the required `privacy` field;
  - export the new names from the index (data-model §1.2).
- [x] T007 `gateway/src/domain/model/sensitivity.ts`: the levels, `ENTITY_KINDS`,
  `MessageIndex`, `DetectedEntity`, `Inspection` and `sensitivityOf` (data-model §2.1).
- [x] T008 `gateway/src/domain/model/privacy-policy.ts`: `PRIVACY_ACTIONS`,
  `PrivacySettings`, `validatePrivacy`, `applyPrivacy` (research R-04, data-model §2.2),
  plus `validatePolicy` calling `validatePrivacy`.
- [x] T009 `gateway/src/domain/model/routing-decision.ts`:
  - `RoutingDecision = RouteDecision | BlockDecision`, and `DecisionInput.inspection`;
  - update the callers (`route-inference.ts`, `stream-inference.ts`, the routing dataset
    test) to pass the interim constant `NOT_INSPECTED` (`ok` / `none`, documented as
    removed in T036) and to handle `block` as `451`.
- [x] T010 `gateway/src/infrastructure/policy/policy-mapper.ts` maps the section.
  `gateway/policies/default.yaml` follows `contracts/policy.example.yaml`, and
  `local-only.yaml` gets every level `allow`. Both are version 3. Update
  `gateway/policies/README.md`.

### Verification

- [x] T011 `pnpm lint && pnpm typecheck && pnpm arch && pnpm test && pnpm build`. Write
  `docs/tasks/done/T-005-02-domain-privacy-policy.md` and flip the backlog row.

---

## Phase 2: `T-005-03` — Detector port, HTTP adapter, contract mirror, cache (US3, US7)

**Goal**: inspect a request through the privacy service, safely and cheaply.
**Independent test**: MSW adapter tests, the drift test, the cache tests and the
inspection use case tests pass with a fake clock.

### Tests first

- [x] T012 [P] `gateway/test/contracts/privacy-service-drift.test.ts`: for each mirrored
  schema, the property names, required lists, enums and `additionalProperties` equal the
  components of `services/privacy/openapi.json` (FR-010, research R-03).
- [x] T013 [P] [US3] `gateway/test/privacy/http-pii-detector.test.ts` (MSW):
  - joined messages and per-message UTF-16 offsets, including a message with an emoji
    before a finding;
  - network error, 5xx and 503 `not_ready` → `unavailable`;
  - a malformed body, an unknown kind or a finding crossing the separator → `contract`
    (US3-3);
  - no request text in any thrown error or log.
- [x] T014 [P] [US7] `gateway/test/cache/in-memory-detection-cache.test.ts`:
  - least-recently-used eviction at `maxEntries` (US7-4);
  - expiry by `ttlMs` on the fake clock;
  - a serialized dump of the cache contains only hashes, kinds, offsets, scores and
    levels (US7-2);
  - `maxEntries: 0` disables it.
- [x] T015 [P] [US3] [US7] `gateway/test/application/inspect-sensitivity.test.ts`:
  - a cache hit does not call the detector (US7-1);
  - different kinds or minimum score → a miss (US7-3);
  - failures are not cached;
  - the timeout fires at `timeoutMs` on the fake clock (US3-2);
  - an aborted client signal discards the result;
  - events `privacy.inspected` and `privacy.detector_failed` (US3-1) carry no content.
- [x] T016 [P] [US3] `gateway/test/config/env-005.test.ts`:
  - a missing or non-http `TAMIZ_PRIVACY_URL` → exit, naming the variable (US3-5);
  - timeout range checks;
  - cache defaults.

### Implementation

- [x] T017 `contracts/src/privacy-service.ts` (data-model §1.1), exported from the index.
- [x] T018 [P] `packages/test-utils/src/fake-pii-detector.ts`: `FakePiiDetector`
  (scripted inspections, call log, optional delay on the fake clock).
- [x] T019 `gateway/src/application/ports/{pii-detector,detection-cache}.port.ts`
  (data-model §3.1).
- [x] T020 `gateway/src/infrastructure/privacy/http-pii-detector.ts` (research R-02).
- [x] T021 `gateway/src/infrastructure/cache/in-memory-detection-cache.ts` (research
  R-08).
- [x] T022 `gateway/src/application/use-cases/inspect-sensitivity.ts`:
  - `withTimeout` from feature 003;
  - an injected `hash` function (SHA-256 provided by `main.ts`);
  - routing events.
- [x] T023 `gateway/src/infrastructure/config/env.ts`: the `TAMIZ_PRIVACY_*` variables.
  Update `.env.example` and the gateway README. In `main.ts`, build the detector and the
  cache; they are not used yet.

### Verification

- [x] T024 Run the gates and `quickstart.md` §2. Write
  `docs/tasks/done/T-005-03-pii-detector-port.md` and flip the backlog row.

---

## Phase 3: `T-005-04` — Inspection and actions in `RouteInference` (US1, US2, US3)

**Goal**: every non-streaming request is inspected; the action is applied;
`anonymize` sends placeholders and restores the answer; detection failures fail closed.
**Independent test**: application and HTTP privacy suites pass with fakes; the no-leak
capture is clean.

### Tests first

- [x] T025 [P] [US2] `gateway/test/domain/placeholders.test.ts`:
  - every vector in `specs/005-privacy-aware-routing/contracts/placeholder-vectors.json`
    and `specs/004-privacy-service/contracts/anonymize.example.json`;
  - `anonymizeMessages` numbers across messages, and the same value in two messages gets
    one placeholder (US2-2);
  - `restore` leaves unmapped `<PERSON_9>` and altered `PERSON_1` untouched (US2-3);
  - a `fast-check` round trip.
- [x] T026 [P] `services/privacy/tests/unit/test_shared_vectors.py`: the Python reference
  reproduces every vector of `placeholder-vectors.json` (research R-01).
- [x] T027 [P] [US1] [US2] [US3] `gateway/test/application/route-inference-privacy.test.ts`
  (fake detector, scripted providers, fake clock):
  - US1-1 … US1-6, including the local circuit open → 503, never a non-local target;
  - US2-1: system, user and assistant messages are anonymized;
  - US2-4: the notice is the first system message;
  - US2-6: usage and cost come from the anonymized exchange;
  - US3-1 and US3-4.
- [x] T028 [P] [US1] [US3] `gateway/test/chat-completions-privacy.test.ts`
  (`app.request()`):
  - `x-tamiz-sensitivity` and `x-tamiz-privacy` on success and on errors;
  - `451` with the message format of `contracts/http.md`;
  - `503 privacy_unavailable`;
  - `anonymize;notice=v1`.
- [x] T029 [P] [US2] `gateway/test/privacy/no-leak.test.ts`:
  - run every privacy scenario with a pino capture, a routing-events capture, a
    response-header capture and a cache dump;
  - assert that no test value and no `placeholder → value` pair appears (US2-5, SC-006).

### Implementation

- [x] T030 `gateway/src/domain/model/placeholders.ts` (data-model §2.4, research R-01,
  R-10).
- [x] T031 `gateway/src/domain/errors.ts`: add `PrivacyBlockedError` and
  `PrivacyUnavailableError`. `contracts/src/error.ts`: add `privacy_unavailable`.
  `presentation/mappers/error-envelope.ts`: map both.
- [x] T032 [P] `gateway/prompts/anonymization-notice.v1.md` (research R-06), read at boot
  by `main.ts`; a missing file is a boot error.
- [x] T033 `gateway/src/application/use-cases/route-inference.ts`:
  - `inspectSensitivity` runs concurrently with classification, then `decide`;
  - block → error;
  - `anonymize` → `anonymizeMessages`, the notice, `executeChain`, `restore`;
  - the mapping is held in the closure only.
- [x] T034 `gateway/src/presentation/routes/chat-completions.ts`: the headers, the
  451/503 mapping, the OpenAPI response headers.
- [x] T035 `gateway/src/application/ports/routing-events.port.ts`: the `privacy.*` events.
  `infrastructure/telemetry/log-routing-events.ts` logs them.
- [x] T036 `gateway/src/main.ts`: wire the detector and cache into the use cases, and
  remove `NOT_INSPECTED`.

### Verification

- [x] T037 Run the gates, plus `quickstart.md` §4–§6 against the real privacy service and
  Ollama where available. Write `docs/tasks/done/T-005-04-privacy-in-route-inference.md`
  and flip the backlog row.

---

## Phase 4: `T-005-05` — Streaming restoration (US4)

**Goal**: anonymized streams are restored without broken placeholders and with bounded
delay. **Independent test**: the restorer property passes for every chunking; the stream
suites pass.

### Tests first

- [x] T038 [P] [US4] `gateway/test/domain/restore-stream.test.ts`:
  - US4-1 … US4-4 examples;
  - a `fast-check` property: for random answers built from mapped placeholders, unmapped
    lookalikes and plain text, and every split into up to 3 cuts,
    `concat(push) + flush == restore(full)` (US4-5, SC-003);
  - held text never exceeds `MAX_PLACEHOLDER_LENGTH`.
- [x] T039 [P] [US4] `gateway/test/application/stream-inference-privacy.test.ts`:
  - inspection and actions happen before the first token;
  - `block` gives a JSON error with no stream;
  - an anonymized stream is restored;
  - the flush happens before the usage chunk (US4-4) and on a mid-stream error.
- [x] T040 [P] `gateway/test/chat-completions-stream.test.ts` (extended):
  - SSE chunks of an anonymized request contain restored values;
  - headers are present on the stream response.

### Implementation

- [x] T041 `gateway/src/domain/model/restore-stream.ts` (research R-07).
- [x] T042 `gateway/src/application/use-cases/stream-inference.ts`:
  - same inspection and actions as T033;
  - text parts go through `createRestorer`;
  - `flush` happens before usage and on error.

### Verification

- [x] T043 Run the gates. Write `docs/tasks/done/T-005-05-streaming-restoration.md` and
  flip the backlog row.

---

## Phase 5: `T-005-06` — `SimulatePolicy` and `POST /v1/simulate` (US5)

**Goal**: a dry run of classification, inspection and decision with zero provider calls.
**Independent test**: the simulator suites pass; the endpoint appears in `/openapi.json`.

### Tests first

- [ ] T044 [P] [US5] `contracts/test/simulate.test.ts`:
  - `contracts/simulate.example.json` parses;
  - unknown fields are rejected;
  - `blockReason` appears only with `block`.
- [ ] T045 [P] [US5] `gateway/test/application/simulate-policy.test.ts`. The use case has
  no provider port, by type. Cases:
  - DNI → `critical`, `restrict_to_local`, a local chain (US5-1);
  - `anonymize` → `providerMessages` with placeholders and the notice (US5-2);
  - the result has no value, and no audit or routing "attempt" event is emitted (US5-3);
  - a block → `decision: block`, an empty chain, `blockReason`;
  - a detector failure → `detector: timeout` and `sensitivity: unknown`.
- [ ] T046 [P] [US5] `gateway/test/simulate.test.ts` (`app.request()`):
  - 401 without a key (US5-4);
  - 400 on an invalid body;
  - a 200 response shape matching the contract;
  - `/openapi.json` lists `/v1/simulate`.

### Implementation

- [ ] T047 `contracts/src/simulate.ts` (data-model §1.3), exported from the index.
- [ ] T048 `gateway/src/application/use-cases/simulate-policy.ts`.
- [ ] T049 `gateway/src/presentation/routes/simulate.ts`, registered in `app.ts`, with an
  OpenAPI component.

### Verification

- [ ] T050 Run the gates and `quickstart.md` §3, §7. Write
  `docs/tasks/done/T-005-06-simulate-endpoint.md` and flip the backlog row.

---

## Phase 6: Polish and cross-cutting

- [ ] T051 [P] `README.md` "Status": feature 005 done, the privacy headers, the
  simulator, a link to the quickstart.
- [ ] T052 [P] `docs/architecture.md`: the request flow with inspection, actions and
  restoration; the privacy events.
- [ ] T053 [P] Update the gateway README (environment, behaviour table), `.env.example`,
  `policies/README.md` (the `privacy` section) and `CLAUDE.md` section 12.
- [ ] T054 Run `quickstart.md` end to end and record the results in the last task record
  of the feature.

T051–T054 belong to the last PR of the feature (`T-005-05` or `T-005-06`, whichever
merges second).

---

## Dependencies

```text
Phase 1 (T-005-02) ─▶ Phase 2 (T-005-03) ─▶ Phase 3 (T-005-04) ─┬─▶ Phase 4 (T-005-05) ─┐
                                                                └─▶ Phase 5 (T-005-06) ─┴─▶ Phase 6
```

- **Phases 4 and 5** need only Phase 3. They touch different files, except `main.ts` and
  the contracts index, so they can run as two sessions.
- **Feature 006** adds the audit entry fields (level, kinds and counts, action) on top of
  Phase 3's events.
- **Feature 007**'s PII-leak and routing evals run through Phase 5's simulator, using the
  metric of research R-12.
- **Within a phase**, `[P]` tasks are independent files; unmarked tasks depend on the
  ones above them.

## Parallel execution examples

- **Phase 1:** T001 … T005 together, then T006 → T010.
- **Phase 2:** T012 … T016 together; T017 and T018 in parallel; then T019 → T023.
- **Phase 3:** T025 … T029 together (T026 is Python); T030 – T032 in parallel; then
  T033 → T036.
- **Phases 4 and 5:** run as two sessions.

## Implementation strategy

1. **MVP** = Phases 1–3: every non-streaming request is inspected and handled by policy,
   including `anonymize` with restoration. This is the product's promise.
2. **Phase 4** extends it to streaming clients.
3. **Phase 5** makes it explainable, and it is what the evals (007) and the dashboard
   simulator (008) need.
4. **One PR per phase:** each flips one backlog row to `done` and adds one task record
   under `docs/tasks/done/`.

## Totals

| Phase | Backlog | Tasks | Stories |
|---|---|---|---|
| 1 | `T-005-02` | T001–T011 (11) | US6, US1 |
| 2 | `T-005-03` | T012–T024 (13) | US3, US7 |
| 3 | `T-005-04` | T025–T037 (13) | US1, US2, US3 |
| 4 | `T-005-05` | T038–T043 (6) | US4 |
| 5 | `T-005-06` | T044–T050 (7) | US5 |
| 6 | polish | T051–T054 (4) | — |
| **Total** | | **54** | |
