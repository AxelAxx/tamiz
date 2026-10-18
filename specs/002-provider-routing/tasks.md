---

description: "Task list for feature 002-provider-routing"
---

# Tasks: Provider Routing

**Input**: Design documents from `specs/002-provider-routing/`

**Prerequisites**: `plan.md`, `spec.md`, `research.md` (R-01 … R-15), `data-model.md`,
`contracts/{http.md,policy.example.yaml,routing-dataset.example.jsonl}`, `quickstart.md`;
feature 001 merged (`T-001-02` … `T-001-06` done).

**Tests**: Mandatory. Constitution III requires every Given/When/Then of `spec.md` to map
one-to-one to a test; the "Scenario coverage" table below is that mapping. Write each
test before the code it covers and watch it fail first.

**Organization**: Phases are the backlog tasks `T-002-02` … `T-002-08` of
`docs/tasks/BACKLOG.md` (one session, one PR each), as agreed in the `T-001-01` record.
The `[USn]` label keeps the mapping to the spec's user stories. Within a phase the order
is tests → implementation → verification → task record.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel with its neighbours (different files, no dependency on an
  unfinished task).
- **[Story]**: user story of `spec.md` (`US1` … `US8`).
- Paths are repository-relative. `gateway/` abbreviates `apps/gateway/`.

## Scenario coverage

| Spec scenario | Task | Spec scenario | Task |
|---|---|---|---|
| US1-1 200 + response contract + `model` | T052 | US5-1 no / malformed header → 401 | T052 |
| US1-2 `x-tamiz-route`, `x-tamiz-rule`, `x-request-id` | T052 | US5-2 unknown key → 401, nothing logged | T052 |
| US1-3 400 with paths, no values | T052 | US5-3 valid key → `clientId` on context and log line | T052 |
| US1-4 unknown `model` → default chain | T052 | US5-4 malformed / empty key config stops boot | T051, T047 |
| US1-5 generated OpenAPI served | T053 | US5-5 `/health` stays open | T052 |
| US1-6 502 / 504 keep `x-tamiz-route` | T052, T050 | US6-1 success normalised (×4 providers) | T027–T030 |
| US2-1 unknown target → exit 1 with path | T038, T047 | US6-2 429 / 5xx retryable | T027–T030 |
| US2-2 duplicate ids, duplicate chain entry, empty default, unknown provider, negative price | T038, T036 | US6-3 401/403, other 4xx not retryable, no credential | T027–T030 |
| US2-3 provider not configured → exit 1 | T039, T047 | US6-4 timeout after target timeout, aborted | T027–T030 |
| US2-4 default policy rule → headers | T052 | US6-5 malformed body, raw body absent | T027–T030 |
| US2-5 policy id + version in decision | T038, T003 | US6-6 rule timeout > target timeout > policy default | T016, T003 |
| US2-6 loader returns typed failure | T038 | US6-7 `temperature` / `max_tokens` forwarded, `user` not | T027–T030 |
| US3-1 first rule chain + rule id | T003 | US7-1 0.00045 USD within 1e-9 | T064 |
| US3-2 first matching rule wins | T003 | US7-2 zero prices → 0 | T064 |
| US3-3 no match → default | T003 | US7-3 zero usage → 0 | T064 |
| US3-4 requested-model condition | T003 | US7-4 usage omitted → estimated + flagged | T066, T069 |
| US3-5 cost ordering, stable ties | T003 | US7-5 `usage.cost_usd` in response contract | T065, T069 |
| US3-6 property: determinism, non-empty, declared, unique | T004 | US8-1 ≥ 95 % expected route | T072 |
| US3-7 sensitivity `unknown`, no sensitivity condition | T003, T036 | US8-2 wrong expectation listed, fails below 95 % | T072 |
| US4-1 summarise cues (ES/EN) | T001 | US8-3 dataset integrity (ids, fields, ≥ 40, coverage, header) | T071, T072 |
| US4-2 code cues / fenced block | T001 | US8-4 no network, no provider | T072 |
| US4-3 translate / extract / classify cues | T001 | Edge: classifier (empty content, mixed cues) | T001 |
| US4-4 no cue → `chat` | T001 | Edge: policy (zero rules, empty `when`, id = target id, equal prices) | T002, T003 |
| US4-5 size thresholds | T001 | Edge: finish reason mapping, first choice only | T027–T030 |
| US4-6 determinism, precedence | T001 | Edge: oversized body, key rotation, chain not executed | T052, T051, T016 |

---

## Phase 1: `T-002-02` — Domain model and `decide()` (US3, US4)

**Goal**: `ModelTarget`, `RoutingPolicy` + `validatePolicy`, the rule-based classifier,
and a total, pure `decide()` with property tests. Shapes: `data-model.md` §1, §3.

**Independent test**: `quickstart.md` section 8.

**Branch**: `T-002-02-domain-routing-model`. Depends on `T-001-06` (test-utils, root
Vitest config).

### Tests first

- [ ] T001 [P] [US4] Write `gateway/test/domain/task-classifier.test.ts`: a table of
  Spanish and English messages asserting `taskType` for `summarize` ("Resume este
  informe en tres frases", "Summarize the following"), `code` (fenced block; "fix this
  function"; "escribe una función en TypeScript"), `translate` ("Traduce al inglés",
  "Translate into Spanish"), `extract` ("Extrae el nombre y la fecha", "Extract the
  invoice number as JSON"), `classify` ("Clasifica el sentimiento", "Which category does
  this belong to") and `chat` (no cue) (US4-1 … US4-4); size `short` at 512 estimated
  tokens, `medium` at 513 and 4096, `long` at 4097 using `estimateTokens` =
  `ceil(length / 4)` over all messages (US4-5); two calls identical and "translate this
  code" → `code` by precedence `code → translate → extract → classify → summarize`
  (US4-6); edge cases: empty / whitespace content → `chat` / `short`; accents ignored
  ("traducción" and "traduccion" both `translate`); cues in an earlier user turn are
  ignored, cues in a `system` message count (R-07)
- [ ] T002 [P] [US3] Write `gateway/test/domain/routing-policy.test.ts`:
  `validatePolicy` accepts the policy of `contracts/policy.example.yaml` (as a plain
  object), accepts zero rules and an empty `when: {}`; rejects with a `validation`
  error whose `issues[].path` names the spot: duplicate target id (`targets.1.id`),
  duplicate rule id (`rules.1.id`), rule id `default` (`rules.0.id`), undeclared target
  in a rule (`rules.0.route.1`) and in `default.route.0`, duplicate target in a chain,
  empty chain, negative price (`targets.0.pricing.inputUsdPerMillion`), non-positive
  timeout; `targetById` returns the declared target (FR-004)
- [ ] T003 [P] [US3] Write `gateway/test/domain/routing-decision.test.ts` with
  hand-built policies: first matching rule's chain in rule order and `ruleId` (US3-1);
  two matching rules → first in declaration order (US3-2); no match → `default.route`
  and `ruleId === "default"` (US3-3); `when.requestedModel: ["tamiz-local"]` matches
  regardless of type/size (US3-4); `orderBy: "cost"` sorts by `inputUsdPerMillion +
  outputUsdPerMillion` ascending with declaration order on ties (US3-5); decision
  carries `sensitivity: "unknown"` and `privacyAction: "allow"` (US3-7); `policyId` and
  `policyVersion` copied from the policy (US2-5); `ruleTimeoutMs` copied from a rule
  that sets `timeoutMs`, absent otherwise (US6-6); edge cases: `requestedModel` equal to
  a target id without a matching rule → default (no pinning); a rule with `when: {}`
  placed first matches everything; a micro-benchmark of 1 000 `classify` + `decide`
  calls asserting p95 < 5 ms (SC-007)
- [ ] T004 [P] [US3] Write `gateway/test/domain/routing-decision.property.test.ts`
  with `fast-check` (`numRuns: 1000`): arbitraries for valid policies (unique target ids
  via `fc.uniqueArray`, rules with `fc.subarray` chains, optional `orderBy`) and
  classified requests; properties: `decide` twice gives deep-equal results; `chain`
  non-empty; every chain target is in `policy.targets`; no duplicate ids in `chain`;
  `privacyAction === "allow"`; `ruleId` is `"default"` or a declared rule id (US3-6,
  SC-003)
- [ ] T005 [P] [US3] Write `gateway/test/domain/units.test.ts`: `usd(-1)`,
  `milliseconds(1.5)`, `targetId("Bad Id")`, `policyId("")` return `err`; valid values
  return `ok`; `*Unchecked` variants brand without validation (R-01)

### Implementation

- [ ] T006 [P] [US3] Implement `gateway/src/domain/model/units.ts`: brands `Usd`,
  `Milliseconds`, `PolicyId`, `TargetId`, `RuleId`, `RequestId`, `ClientId` with
  `unique symbol` tags, validating constructors returning `Result` (rules of
  `data-model.md` §3.1: `Usd` finite ≥ 0; `Milliseconds` integer ≥ 0; ids
  `^[a-z0-9][a-z0-9-]{0,63}$`; `PolicyId`/`RequestId` charset of 001 §1) and
  `*Unchecked` variants; zero imports (R-01)
- [ ] T007 [P] [US4] Implement `gateway/src/domain/model/inference-request.ts`:
  `Message { role: "system" | "user" | "assistant"; content: string }`,
  `InferenceRequest { requestId, clientId, requestedModel, messages, temperature?,
  maxTokens? }` (readonly) per `data-model.md` §3.2
- [ ] T008 [P] [US3] Implement `gateway/src/domain/model/model-target.ts`:
  `PROVIDER_NAMES = ["ollama","mistral","anthropic","openai"] as const`,
  `RESIDENCIES = ["local","eu","us","global"] as const`, `ModelTarget` (§2.3 shape with
  `Usd` / `Milliseconds` brands, readonly), `Pricing`
- [ ] T009 [US4] Implement `gateway/src/domain/model/task-classifier.ts`:
  `TASK_TYPES`, `TASK_SIZES`, `SIZE_THRESHOLDS = { short: 512, medium: 4096 }`,
  `TYPE_PRECEDENCE`, the `CUES` table of R-07 as word-boundary regexes over
  lower-cased, NFD-accent-stripped text of all `system` messages plus the last `user`
  message, `estimateTokens`, `classify(messages) → Classification`,
  `ClassifiedRequest`; pure, no imports (FR-002, FR-008)
- [ ] T010 [US3] Implement `gateway/src/domain/model/routing-policy.ts`:
  `RoutingPolicy`, `RoutingRule`, `RuleCondition`, `RoutingPolicyInput` (unbranded
  input shape), `validatePolicy(input) → Result<RoutingPolicy, ValidationError>` with
  every cross-field rule of FR-004 and `{ path, message }` issues, `targetById`
  (FR-003, FR-004, R-02)
- [ ] T011 [US3] Implement `gateway/src/domain/model/routing-decision.ts`:
  `PRIVACY_ACTIONS = ["allow"] as const`, `SENSITIVITIES = ["unknown"] as const`,
  `RoutingDecision` (with optional `ruleTimeoutMs`), `matches(rule, request)` (each
  present `when` field includes the request value; `{}` matches all),
  `orderTargets(rule, policy)` (stable cost sort), `decide(policy, request) →
  RoutingDecision` total and pure (FR-005 … FR-007, R-08)
- [ ] T012 [US3] Add `fast-check` as a devDependency of `gateway/package.json`

### Verification

- [ ] T013 [US3] Run `pnpm lint && pnpm typecheck && pnpm arch && pnpm test` from the
  root: domain tests green, `pnpm arch` reports zero violations (the new domain files
  import nothing)
- [ ] T014 Write `docs/tasks/done/T-002-02-domain-routing-model.md` (record the R-01
  decision and the cue table location) and set `T-002-02` to `done` in
  `docs/tasks/BACKLOG.md` in the same commit

**Checkpoint**: `decide()` and `classify()` provably pure; property tests green.

---

## Phase 2: `T-002-03` — Ports, use cases and test doubles (US1, US6)

**Goal**: `LlmProviderPort`, `PolicyRepositoryPort`, `ProviderRegistry`, the two use
cases, the `DomainError` extension and generic doubles in `@tamiz/test-utils`.

**Independent test**: `gateway/test/application/route-inference.test.ts` with fakes only.

**Branch**: `T-002-03-ports-and-use-cases`. Depends on Phase 1.

### Tests first

- [ ] T015 [P] [US1] Add `packages/test-utils/src/scripted-port.ts`
  (`createScriptedPort<I, O>(script: (input: I, call: number) => O | Promise<O>) → { fn,
  calls: I[] }`) and `packages/test-utils/src/in-memory-policy-repository.ts`
  (`createInMemoryPolicyRepository<P>(initial: P) → { getActive(): Promise<P>; set(p:
  P): void }`), export them from `packages/test-utils/src/index.ts`, and write
  `packages/test-utils/test/scripted-port.test.ts` and
  `packages/test-utils/test/in-memory-policy-repository.test.ts` (calls recorded in
  order, script receives the call index; `set` replaces the active policy) (R-14)
- [ ] T016 [P] [US1] Write `gateway/test/application/route-inference.test.ts` using
  `createScriptedPort`, `createInMemoryPolicyRepository` and `createFakeClock`: the
  provider receives `chain[0]` only, even when the first call fails (edge case "chain
  not executed"); `timeoutMs` equals `decision.ruleTimeoutMs` when the matched rule
  sets one, else `target.timeoutMs` when set, else `policy.defaultTimeoutMs` (US6-6);
  the result carries `decision`, `target`, `completion`, `createdAt` from the fake
  clock; a `ProviderError` from the port is returned as
  `RoutingFailure { decision, target, error }` without throwing; `classifyTask` output
  is what `decide` received (FR-011, FR-012)
- [ ] T017 [P] [US6] Extend `gateway/test/domain/errors.test.ts` (001): `providerError`
  and `unauthorizedError` constructors, `retryable` and `status` preserved, exhaustive
  `switch` over the five `kind` values compiles (FR-013)

### Implementation

- [ ] T018 [US6] Extend `gateway/src/domain/errors.ts`: `PROVIDER_ERROR_CAUSES`
  tuple, `ProviderError { kind: "provider"; targetId; provider; cause; retryable;
  message; status? }`, `UnauthorizedError { kind: "unauthorized"; message }`,
  constructors, union updated (`data-model.md` §3.7)
- [ ] T019 [P] [US6] Implement `gateway/src/application/ports/llm-provider.port.ts`:
  `ProviderCompletionInput`, `ProviderCompletion`, `LlmProviderPort` (§4.1) and the
  `FINISH_REASONS = ["stop","length","content_filter"] as const` tuple (the drift test
  of T054 imports it from this file) (FR-009)
- [ ] T020 [P] [US1] Implement `gateway/src/application/ports/policy-repository.port.ts`
  (`getActive(): Promise<RoutingPolicy>`) (FR-010)
- [ ] T021 [P] [US6] Implement `gateway/src/application/provider-registry.ts`:
  `ProviderRegistry { resolve(provider: ProviderName): LlmProviderPort }` (type only;
  the implementation is Phase 3) (FR-018)
- [ ] T022 [US1] Implement `gateway/src/application/use-cases/classify-task.ts`:
  `classifyTask(request: InferenceRequest): ClassifiedRequest` wrapping the domain
  classifier and setting `sensitivity: "unknown"` (FR-011)
- [ ] T023 [US1] Implement `gateway/src/application/use-cases/route-inference.ts`:
  `routeInference(deps)(request)` in the order of `data-model.md` §4.2 (classify →
  `getActive` → `decide` → `chain[0]` → effective timeout `ruleTimeoutMs ??
  target.timeoutMs ?? defaultTimeoutMs` → `complete` → `createdAt = clock.now()`),
  returning `Result<RoutedCompletion, RoutingFailure>`; the cost step of FR-012
  (`usage`, `cost`) is added in Phase 6 (`T-002-07`), leave a typed `usage?:
  ProviderCompletion["usage"]` for now (FR-012)

### Verification

- [ ] T024 [US1] Run `pnpm lint typecheck arch test` from the root (application imports
  only domain; `pnpm arch` green); write
  `docs/tasks/done/T-002-03-ports-and-use-cases.md` and set `T-002-03` to `done` in
  `docs/tasks/BACKLOG.md` in the same commit

**Checkpoint**: the whole routing path runs in a test with fakes and no network.

---

## Phase 3: `T-002-04` — AI SDK adapters and provider registry (US6)

**Goal**: four adapters over one `createAiSdkProvider()` factory, retries disabled,
errors normalised, MSW tests per provider.

**Independent test**: `quickstart.md` section 7.

**Branch**: `T-002-04-llm-adapters`. Depends on Phase 2; may run in parallel with Phase 4.

### Setup

- [ ] T025 Add to `gateway/package.json`: `ai` (6.x), `@ai-sdk/openai-compatible`,
  `@ai-sdk/mistral`, `@ai-sdk/anthropic`, `@ai-sdk/openai`; devDependency `msw` (2.x)
  (R-04, R-14)
- [ ] T026 [P] [US6] Create `gateway/test/llm/fixtures/{openai,mistral,anthropic,ollama}-success.json`:
  one minimal real-shaped success body per provider (OpenAI / Mistral / Ollama: chat
  completion object with `choices[0].message.content`, `finish_reason`, `usage`;
  Anthropic: messages object with `content[0].text`, `stop_reason`, `usage`), plus
  `gateway/test/llm/msw.ts` exporting `setupServer()` helpers with
  `onUnhandledRequest: "error"`

### Tests first (one file per provider, same scenario list)

- [ ] T027 [P] [US6] Write `gateway/test/llm/openai.adapter.test.ts` against MSW
  handlers for `https://api.openai.com/v1/chat/completions`: success → text, finish
  reason mapped, `usage` tokens, `modelName` (US6-1); 429 → `rate_limited` retryable
  status 429; 500 → `http_error` retryable (US6-2) and the handler is hit exactly once
  (`maxRetries: 0`); 401 → `authentication` not retryable and the error message does
  not contain the API key (US6-3); `delay("infinite")` with `timeoutMs: 200` →
  `timeout` retryable within 1 s (US6-4); `HttpResponse.json({ nope: true })` →
  `malformed_response` not retryable, raw body absent from the error (US6-5); request
  body contains `temperature` and `max_tokens` and no `user` (US6-7); `finish_reason:
  "content_filter"` → `content_filter`, `"tool_calls"` → `stop` (edge case); a body with
  two choices yields the first (edge case)
- [ ] T028 [P] [US6] Write `gateway/test/llm/mistral.adapter.test.ts` (same list,
  `https://api.mistral.ai/v1/chat/completions`)
- [ ] T029 [P] [US6] Write `gateway/test/llm/anthropic.adapter.test.ts` (same list,
  `https://api.anthropic.com/v1/messages`; `stop_reason: "max_tokens"` → `length`)
- [ ] T030 [P] [US6] Write `gateway/test/llm/ollama.adapter.test.ts` (same list,
  `http://localhost:11434/v1/chat/completions`, no credential; 401 case replaced by 404
  → `http_error` not retryable)
- [ ] T031 [P] [US6] Write `gateway/test/llm/provider-registry.test.ts`: the registry
  built from a settings object resolves each configured provider to an adapter; an
  unconfigured provider resolves to an adapter whose `complete()` returns
  `authentication` / not retryable with message `provider not configured` (never
  throws) (FR-018)

### Implementation

- [ ] T032 [US6] Implement `gateway/src/infrastructure/llm/ai-sdk-provider.ts`:
  `createAiSdkProvider({ provider, languageModel })` → `LlmProviderPort`; calls
  `generateText({ model: languageModel(target.model), messages, temperature,
  maxOutputTokens, abortSignal: AbortSignal.timeout(timeoutMs), maxRetries: 0 })`; maps
  success per R-06 (`finishReason`, `usage.inputTokens/outputTokens`, `response.modelId`,
  first text part) and errors per the R-05 table with fixed messages and no upstream
  body, credential or messages (FR-015 … FR-017)
- [ ] T033 [P] [US6] Implement `gateway/src/infrastructure/llm/{ollama,mistral,anthropic,openai}.ts`,
  each `createXAdapter(settings)` supplying the model factory
  (`createOpenAICompatible({ name: "ollama", baseURL }).chatModel`, `createMistral({
  apiKey, baseURL })`, `createAnthropic({ apiKey, baseURL })`, `createOpenAI({ apiKey,
  baseURL })`) to `createAiSdkProvider`; settings are explicit parameters, never
  `process.env` (FR-014, R-04)
- [ ] T034 [US6] Implement `gateway/src/infrastructure/llm/provider-registry.ts`:
  `createProviderRegistry(providerSettings)` building the four adapters (unconfigured →
  the "not configured" adapter of T031) and returning `ProviderRegistry`

### Verification

- [ ] T035 [US6] Run `pnpm lint typecheck arch test` from the root (MSW tests green,
  zero unhandled requests); write `docs/tasks/done/T-002-04-llm-adapters.md` (note the
  AI SDK error classes observed per provider) and set `T-002-04` to `done` in
  `docs/tasks/BACKLOG.md` in the same commit

**Checkpoint**: every provider failure mode is a typed `ProviderError`.

---

## Phase 4: `T-002-05` — Policy schema, file loader and default policy (US2)

**Goal**: `RoutingPolicySchema` in contracts, YAML loader returning `Result`, provider
settings cross-check at boot, shipped `default.yaml` and `local-only.yaml`.

**Independent test**: `quickstart.md` section 6.

**Branch**: `T-002-05-policy-file`. Depends on Phase 2; may run in parallel with Phase 3
(disjoint files; rebase on whichever merges second because both touch
`gateway/package.json`).

### Tests first

- [ ] T036 [P] [US2] Write `packages/contracts/test/routing-policy.test.ts`: the
  example policy of `specs/002-provider-routing/contracts/policy.example.yaml` (as JSON)
  parses; rejected with issue paths: unknown `provider`, negative price, `version: 0`,
  `defaultTimeoutMs: 0`, empty `route`, `orderBy: "latency"`, rule `timeoutMs: 0`,
  unknown top-level key, `when.sensitivity` present (US3-7), `when.taskType: []`;
  `defaultTimeoutMs` defaults to 30000 when omitted; a rule with `timeoutMs: 5000`
  parses (FR-019, US2-2)
- [ ] T037 [P] [US2] Create the invalid-policy corpus
  `gateway/test/policy/fixtures/invalid/{unknown-target,duplicate-target,duplicate-chain-entry,empty-default,unknown-provider,negative-price,rule-id-default,sensitivity-condition,not-yaml}.yaml`
  and `gateway/test/policy/fixtures/valid-minimal.yaml` (one Ollama target, no rules)
- [ ] T038 [P] [US2] Write `gateway/test/policy/file-policy-loader.test.ts`: each
  invalid fixture returns `err` with a `configuration` error whose issues name the path
  (`rules.0.route.0: unknown target "nope"` for unknown-target; `targets.1.id` for
  duplicate; `default.route` for empty; …) and never throws (US2-1, US2-2, US2-6); the
  example policy loads with `id`, `version` and branded prices (US2-5); a JSON file with
  the same content loads too (R-09); a missing file → `configuration` error naming the
  path
- [ ] T039 [P] [US2] Write `gateway/test/config/provider-settings.test.ts`:
  `checkProviderSettings(policy, config)` returns `err` listing `target mistral-small:
  provider mistral needs MISTRAL_API_KEY` when the key is absent, `ok` when every used
  provider is configured, and never includes a configured value in its messages
  (US2-3, FR-021); and `gateway/test/config/env-002.test.ts`: `TAMIZ_POLICY_FILE`
  defaults to `policies/default.yaml`, `OLLAMA_BASE_URL` defaults to
  `http://localhost:11434/v1`, provider keys and base URL overrides parsed, invalid URL
  → `configuration` issue (R-12)

### Implementation

- [ ] T040 [US2] Implement `packages/contracts/src/routing-policy.ts`:
  `ProviderNameSchema`, `ResidencySchema`, `TaskTypeSchema`, `TaskSizeSchema`,
  `TargetIdSchema` (`^[a-z0-9][a-z0-9-]{0,63}$`), `RuleIdSchema`, `PricingSchema`
  (`UsdSchema` ≥ 0 ×2), `ModelTargetSchema`, `RuleConditionSchema` (`strictObject`,
  optional non-empty arrays, no `sensitivity`), `RoutingRuleSchema` (`orderBy:
  z.literal("cost").optional()`, `timeoutMs: z.int().positive().optional()`),
  `RoutingPolicySchema` (`id: PolicyIdSchema`,
  `version: z.int().min(1)`, `defaultTimeoutMs: z.int().positive().default(30000)`,
  `targets` min 1, `rules`, `default: { route: min 1 }`), inferred `RoutingPolicyDto`;
  export from `packages/contracts/src/index.ts` (FR-019, `data-model.md` §2.3)
- [ ] T041 [P] [US2] Implement `gateway/src/infrastructure/policy/policy-mapper.ts`:
  `toDomainPolicyInput(dto: RoutingPolicyDto) → RoutingPolicyInput` (brands applied
  with the `*Unchecked` constructors because the schema already validated) (R-01)
- [ ] T042 [US2] Add `yaml` (2.x) to `gateway/package.json`; implement
  `gateway/src/infrastructure/policy/file-policy-loader.ts`: `loadPolicyFile(path) →
  Promise<Result<RoutingPolicy, ConfigurationError>>` = read → `yaml.parse` → 
  `RoutingPolicySchema.safeParse` (issues → `path.join(".")`) → `toDomainPolicyInput` →
  `validatePolicy`; parse errors and missing files become `configuration` errors with
  the file path (FR-020, R-09)
- [ ] T043 [US2] Extend `gateway/src/infrastructure/config/env.ts` with
  `TAMIZ_POLICY_FILE`, `OLLAMA_BASE_URL`, `MISTRAL_API_KEY`, `ANTHROPIC_API_KEY`,
  `OPENAI_API_KEY`, `MISTRAL_BASE_URL`, `ANTHROPIC_BASE_URL`, `OPENAI_BASE_URL` per
  `data-model.md` §5 (grouped into `config.providers`), keeping the 001 behaviour
  (R-12)
- [ ] T044 [US2] Implement `gateway/src/infrastructure/config/provider-settings.ts`:
  `checkProviderSettings(policy, config) → Result<void, ConfigurationError>` (one issue
  per unconfigured provider used by a target, message of T039) (FR-021)
- [ ] T045 [P] [US2] Create `gateway/policies/default.yaml` (copy of
  `specs/002-provider-routing/contracts/policy.example.yaml`, FR-023) and
  `gateway/policies/local-only.yaml` (one `ollama-llama` target, no rules, default chain
  `[ollama-llama]`, `defaultTimeoutMs: 60000`); add a short `gateway/policies/README.md`
- [ ] T046 [US2] Extend `gateway/src/main.ts`: after `loadConfig`, `loadPolicyFile` →
  `checkProviderSettings` → seed `createInMemoryPolicyRepository`-equivalent adapter
  `gateway/src/infrastructure/policy/in-memory-policy-repository.ts` (production
  adapter of `PolicyRepositoryPort`, FR-022); on any `err` print one `path: message`
  line per issue to stderr and `process.exit(1)` before `serve()` (FR-020)
- [ ] T047 [US2] Extend `gateway/test/boot.integration.test.ts` (001): spawn with
  `TAMIZ_POLICY_FILE` pointing at `invalid/unknown-target.yaml` → exit 1 and stderr
  contains `rules.0.route.0` (US2-1); spawn with the default policy and no
  `MISTRAL_API_KEY` → exit 1 and stderr contains `needs MISTRAL_API_KEY` and not the
  other configured keys (US2-3); spawn with `TAMIZ_API_KEYS` malformed → exit 1 naming
  the entry position (US5-4, becomes effective once Phase 5 lands; mark `todo` until
  then)

### Verification

- [ ] T048 [US2] Run `pnpm lint typecheck arch test` from the root and `quickstart.md`
  section 6 manually; write `docs/tasks/done/T-002-05-policy-file.md` (include the
  stderr samples) and set `T-002-05` to `done` in `docs/tasks/BACKLOG.md` in the same
  commit

**Checkpoint**: a bad policy cannot boot; the default policy loads with four providers.

---

## Phase 5: `T-002-06` — Endpoint, authentication, OpenAPI and mappers (US1, US5)

**Goal**: `POST /v1/chat/completions` on `OpenAPIHono`, API-key middleware with hashed
keys, `x-tamiz-route` / `x-tamiz-rule`, error mapping with `provider_timeout`,
`/openapi.json`, body limit, composition root wired end to end.

**Independent test**: `quickstart.md` sections 1–4 and 10.

**Branch**: `T-002-06-chat-completions-endpoint`. Depends on Phases 3 and 4.

### Setup

- [ ] T049 Add `@hono/zod-openapi` (1.x) to `gateway/package.json`; add script
  `"generate-api-key": "tsx scripts/generate-api-key.ts"` (R-10, R-11)

### Tests first

- [ ] T050 [P] [US1] Extend `packages/contracts/test/error.test.ts`:
  `provider_timeout` accepted and `errorTypeToHttpStatus.provider_timeout === 504`; the
  seven 001 values unchanged (FR-028)
- [ ] T051 [P] [US5] Write `gateway/test/config/api-keys.test.ts`:
  `parseApiKeys("acme:<64 hex>,beta:<64 hex>")` → two records; entries without client
  id, with an invalid client id or a 63-char hash → `configuration` issue naming
  `TAMIZ_API_KEYS[1]` and never the entry text; empty string → issue "at least one key"
  (US5-4); `hashApiKey("tmz_x")` is the SHA-256 hex; `verifyApiKey(presented, records)`
  returns the `clientId` on match, `undefined` otherwise, and scans every record (spy on
  `timingSafeEqual` call count); two records with the same `clientId` both verify (edge
  case key rotation); `generateApiKey()` returns `tmz_` + 43 base64url chars and its
  hash (FR-029, FR-030)
- [ ] T052 [P] [US1] Write `gateway/test/chat-completions.test.ts` with
  `createApp({ … routeInference built on scripted providers, in-memory default policy,
  apiKeys: [record for "demo"], clock })` and `app.request()`: valid request → 200,
  body validates with `ChatCompletionResponseSchema`, `object`, one `assistant` choice,
  `usage`, `model` equals the fake's `modelName` (US1-1); headers `x-tamiz-route`,
  `x-tamiz-rule`, `x-request-id` (US1-2); unknown field / wrong type / empty `messages`
  / `stream: true` → 400 `invalid_request`, message lists paths and expected formats and
  does not contain the offending values, no `x-tamiz-*` headers (US1-3); `model:
  "gpt-4o"` → served via `default` (US1-4); scripted `ProviderError` `http_error` → 502
  `provider_error` with `x-tamiz-route`, `timeout` → 504 `provider_timeout`, bodies
  without stack traces (US1-6); default policy + "escribe una función" → `x-tamiz-rule:
  code-to-frontier`, `x-tamiz-route: anthropic-sonnet` (US2-4); no header / `Basic …` /
  `Bearer` without key → 401 `unauthorized` and zero provider calls (US5-1); unknown
  key → 401, captured log line contains neither the key nor any configured hash
  (US5-2); valid key → 200 and the request log line has `clientId: "demo"` and no key
  (US5-3); `GET /health` without key → 200 (US5-5); 1.1 MiB body → 400
  `invalid_request` (FR-032); 200 requests with an instant fake → p95 < 20 ms (SC-007);
  `id === "chatcmpl-" + requestId`, `created` from the fake clock (FR-025)
- [ ] T053 [P] [US1] Write `gateway/test/openapi.test.ts`: `GET /openapi.json` → 200,
  `openapi: "3.1.0"`, paths `/v1/chat/completions` and `/health`, components include
  `ErrorEnvelope`, the 200 response declares headers `x-tamiz-route`, `x-tamiz-rule`,
  `x-request-id`, `securitySchemes.bearerAuth` present (US1-5, FR-031)
- [ ] T054 [P] [US1] Write `gateway/test/contracts-drift.test.ts`: each contract enum's
  `.options` deep-equals the domain tuple: `ProviderNameSchema` ⇄ `PROVIDER_NAMES`,
  `ResidencySchema` ⇄ `RESIDENCIES`, `TaskTypeSchema` ⇄ `TASK_TYPES`, `TaskSizeSchema`
  ⇄ `TASK_SIZES`, the `finish_reason` enum ⇄ `FINISH_REASONS`
  (`PROVIDER_ERROR_CAUSES`, `PRIVACY_ACTIONS` and `SENSITIVITIES` have no contract
  enum yet; feature 005 adds the last two to the drift test) (R-03)

### Implementation

- [ ] T055 [US5] Implement `gateway/src/infrastructure/auth/api-keys.ts`
  (`parseApiKeys`, `hashApiKey`, `verifyApiKey` with `timingSafeEqual` over every
  record, `generateApiKey`) and `gateway/scripts/generate-api-key.ts` (prints `key:
  …` and `TAMIZ_API_KEYS entry: <clientId>:<hash>`; refuses an invalid client id) (R-10)
- [ ] T056 [US5] Extend `gateway/src/infrastructure/config/env.ts`: `TAMIZ_API_KEYS`
  required (min 1 record) parsed with `parseApiKeys`; issue messages never echo the
  value (FR-030); update `gateway/test/config/env-002.test.ts` accordingly
- [ ] T057 [P] [US1] Implement `gateway/src/presentation/mappers/inference-request.ts`
  (`toInferenceRequest(dto, requestId, clientId)` with the 001 → domain brand
  conversion) and `gateway/src/presentation/mappers/chat-completion-response.ts`
  (`toChatCompletionResponse(routed, requestId, now)` → validated with
  `ChatCompletionResponseSchema` before sending; `id = "chatcmpl-" + requestId`,
  `created = floor(now / 1000)`, `model = target.model`, `finish_reason` from the
  completion, `usage` from the completion or zeros until Phase 6) (FR-024, FR-025, R-15)
- [ ] T058 [US1] Extend `gateway/src/presentation/mappers/error-envelope.ts`:
  `provider` → `provider_error` 502 or `provider_timeout` 504 when `cause ===
  "timeout"`; `unauthorized` → 401; a `fromZodIssues(issues)` helper producing the
  400 message `path: expected …` without values (FR-027)
- [ ] T059 [US5] Implement `gateway/src/presentation/middlewares/api-key-auth.ts`:
  `apiKeyAuth(records)` parses `Authorization: Bearer <key>`, verifies, sets
  `c.set("clientId", …)`, otherwise returns the 401 envelope through the mapper;
  mounted on `/v1/*` only (FR-029)
- [ ] T060 [US1] Implement `gateway/src/presentation/routes/chat-completions.ts`:
  `createRoute` per `contracts/http.md` (request body `ChatCompletionRequestSchema`,
  responses 200/400/401/502/504, headers, `security: [{ bearerAuth: [] }]`); handler:
  `toInferenceRequest` → `routeInference` → on `ok` set `x-tamiz-route` /
  `x-tamiz-rule` and return the mapped body; on `err` set the same headers from
  `failure.decision` and return the mapped envelope (FR-026)
- [ ] T061 [US1] Rework `gateway/src/presentation/app.ts`: `OpenAPIHono` with
  `defaultHook` → 400 envelope via `fromZodIssues`; `bodyLimit({ maxSize: 1_048_576,
  onError })` → 400 envelope; register `/health` (001) through `createRoute` so it is
  documented; `app.doc("/openapi.json", { openapi: "3.1.0", info })`;
  `openAPIRegistry.registerComponent("securitySchemes", "bearerAuth", …)`; keep the 001
  request-id, 404 and 500 behaviour; the request log line gains `clientId` and `route`
  (never body) (FR-031, FR-032, R-11)
- [ ] T062 [US1] Wire `gateway/src/main.ts`: `createProviderRegistry(config.providers)`
  → `routeInference({ policies, providers, clock })` → `createApp({ …, apiKeys:
  config.apiKeys })`; delete `specs/001-contracts-and-skeleton/contracts/openapi.yaml`
  and update `specs/001-contracts-and-skeleton/contracts/README.md` to point at
  `GET /openapi.json` (001 tasks T076, FR-031)

### Verification

- [ ] T063 [US1] Run `pnpm lint typecheck arch test build` from the root; run
  `quickstart.md` sections 1–4 and 10 against `policies/local-only.yaml` (paste the
  `curl -i` outputs, with the key redacted, in the task record); mark T047's
  `TAMIZ_API_KEYS` case done; write
  `docs/tasks/done/T-002-06-chat-completions-endpoint.md` and set `T-002-06` to `done`
  in `docs/tasks/BACKLOG.md` in the same commit

**Checkpoint**: an OpenAI-compatible client gets a routed answer with `x-tamiz-route`.

---

## Phase 6: `T-002-07` — Cost per request (US7)

**Goal**: `computeCost`, usage estimation when the provider omits it, `usage.cost_usd`
and `usage.estimated` in the response contract and body.

**Independent test**: `quickstart.md` section 5 (last paragraph).

**Branch**: `T-002-07-cost-per-request`. Depends on Phase 5.

### Tests first

- [ ] T064 [P] [US7] Write `gateway/test/domain/cost.test.ts`: `computeCost({ 1000,
  500 }, { 0.15, 0.60 })` → `0.00045` within 1e-9 and typed `Usd` (US7-1); zero prices
  → exactly 0 (US7-2); zero usage → 0 (US7-3); a 10-row corpus hand-computed in the
  test (SC-008) (FR-033)
- [ ] T065 [P] [US7] Extend `packages/contracts/test/chat-completion-response.test.ts`:
  `usage.cost_usd` optional `Usd` (negative rejected), `usage.estimated` optional
  boolean, unknown `usage` keys still rejected (US7-5, FR-035)
- [ ] T066 [P] [US7] Extend `gateway/test/application/route-inference.test.ts`: a
  completion without `usage` → `usage.estimated === true`, tokens from
  `estimateTokens` over the messages and the text, `cost` from the estimate (US7-4);
  a completion with usage → `estimated === false` and `cost` from `target.pricing`
  (FR-034)

### Implementation

- [ ] T067 [P] [US7] Implement `gateway/src/domain/model/cost.ts`: `Usage`,
  `computeCost(usage, pricing) → Usd` (`data-model.md` §3.6)
- [ ] T068 [US7] Extend `packages/contracts/src/chat-completion.ts`:
  `ChatCompletionUsageSchema` gains `cost_usd: UsdSchema.optional()` and `estimated:
  z.boolean().optional()` (FR-035)
- [ ] T069 [US7] Extend `gateway/src/application/use-cases/route-inference.ts`
  (resolve `usage` reported or estimated, `cost = computeCost`) and
  `gateway/src/presentation/mappers/chat-completion-response.ts` (`usage.cost_usd`,
  `usage.estimated`); extend `gateway/test/chat-completions.test.ts` with the cost
  assertions for a priced target, a zero-priced target and a usage-less fake (US7-4,
  US7-5)

### Verification

- [ ] T070 [US7] Run `pnpm lint typecheck arch test` from the root; write
  `docs/tasks/done/T-002-07-cost-per-request.md` and set `T-002-07` to `done` in
  `docs/tasks/BACKLOG.md` in the same commit

**Checkpoint**: every 200 response carries `usage.cost_usd`.

---

## Phase 7: `T-002-08` — Routing dataset and gate test (US8)

**Goal**: `routing.v1.jsonl` (≥ 40 synthetic ES/EN cases bound to `default.yaml`) and a
Vitest gate at ≥ 95 % expected route, in CI through `pnpm test`.

**Independent test**: `quickstart.md` section 9.

**Branch**: `T-002-08-routing-dataset`. Depends on Phases 1, 2 and 4 (classifier,
`classifyTask`, decide, file loader, default policy); scheduled after Phase 6 in the
backlog.

### Dataset

- [ ] T071 [US8] Create `packages/evals/datasets/routing.v1.jsonl` per
  `data-model.md` §6 and `contracts/routing-dataset.example.jsonl`: header line, then
  at least 40 cases with unique ids `routing-NNN`, at least 6 per task type, every size
  represented (long cases use a generated filler paragraph repeated to > 16 400
  characters), Spanish and English roughly half each, at least 3 mixed-cue cases, at
  least 3 `model: "tamiz-local"` cases, at least 3 unknown-model cases (`gpt-4o`,
  `claude-3`), expectations computed by hand from the cue table and
  `policies/default.yaml` (FR-036, FR-038); update `packages/evals/README.md` (datasets
  live here now; runner arrives with feature 007)

### Test

- [ ] T072 [US8] Write `gateway/test/evals/routing-dataset.test.ts`: read the JSONL,
  validate the header (`dataset`, `version`, `policy`, `synthetic: true`) and every case
  with a local Zod schema; assert unique ids, ≥ 40 cases, every task type and size
  present (US8-3); load the policy named in the header through `loadPolicyFile`,
  resolving the path from the repository root (not the test's working directory); for
  each case run `classifyTask` + `decide`; print a table of mismatches (`id`, expected
  route, actual route, expected type, actual type); assert `routeMatches / total ≥
  0.95` and report task-type accuracy (US8-1, US8-2); the test imports no adapter and
  MSW is not set up, so any network call would throw (US8-4, FR-037)

### Verification

- [ ] T073 [US8] Run `pnpm test -- routing-dataset` (accuracy printed) and the whole
  root gate; verify `quickstart.md` section 9 (temporarily break one expectation, see
  it listed, revert); time `quickstart.md` section 2 from a fresh clone for SC-009;
  write `docs/tasks/done/T-002-08-routing-dataset.md` with the accuracy numbers and set
  `T-002-08` to `done` in `docs/tasks/BACKLOG.md` in the same commit

**Checkpoint**: feature 002 complete; `T-003-02` and `T-005-02` can start.

---

## Phase 8: Polish and cross-cutting

- [ ] T074 [P] Update `README.md` "Status" section: feature 002 done, the
  OpenAI-compatible endpoint, how to generate a key, link to
  `specs/002-provider-routing/quickstart.md`
- [ ] T075 [P] Update `apps/gateway/README.md` with the environment variables of
  `data-model.md` §5 and the `generate-api-key` script; update `CLAUDE.md` section 12
  with `pnpm --filter @tamiz/gateway generate-api-key`
- [ ] T076 [P] Update `docs/architecture.md` request-flow diagram to mark which steps
  exist after feature 002 (classify, decide, primary call, cost) and which arrive with
  003/005/006
- [ ] T077 Run `quickstart.md` end to end with the default policy (needs the three API
  keys) and record the five rows of section 5 in the `T-002-08` task record

Tasks T074–T077 belong to the `T-002-08` PR (last of the feature).

---

## Dependencies

```text
Phase 1 (T-002-02) ─▶ Phase 2 (T-002-03) ─┬─▶ Phase 3 (T-002-04) ─┐
                                          └─▶ Phase 4 (T-002-05) ─┴─▶ Phase 5 (T-002-06) ─▶ Phase 6 (T-002-07) ─▶ Phase 7 (T-002-08) ─▶ Phase 8
```

- Phases 3 and 4 touch disjoint source files and can run as two sessions; both add
  dependencies to `apps/gateway/package.json`, so the second to merge rebases.
- Phase 7 technically needs only Phases 1, 2 and 4; it is scheduled last so the dataset
  is written against the final default policy.
- Within a phase, `[P]` tasks are independent files; unmarked tasks depend on the ones
  above them.

## Parallel execution examples

- Phase 1: T001 … T005 together (five test files), then T006 … T008 together, then
  T009 → T011 sequentially.
- Phase 3: T027 … T031 together (five test files), T033 (four adapter files) after T032.
- Phase 4: T036 … T039 together, then T040 → T046.
- Phase 5: T050 … T054 together, T057 with T055, then T058 → T062 sequentially.
- Phase 3 ∥ Phase 4 as two sessions.

## Implementation strategy

1. **MVP** = Phases 1, 2, 4 and 5 with the `local-only.yaml` policy and the Ollama
   adapter from Phase 3: a reviewer gets a routed, authenticated answer (SC-009).
2. The remaining Phase 3 adapters and Phase 6 complete the four-provider story and the
   cost figure.
3. Phase 7 turns the routing claim into a gated metric (SC-001) and closes the feature.
4. Each phase is one PR, one backlog row flipped to `done`, one task record under
   `docs/tasks/done/`. Never merge two phases in one PR.

## Totals

| Phase | Backlog | Tasks | Stories |
|---|---|---|---|
| 1 | `T-002-02` | T001–T014 (14) | US3, US4 |
| 2 | `T-002-03` | T015–T024 (10) | US1, US6 |
| 3 | `T-002-04` | T025–T035 (11) | US6 |
| 4 | `T-002-05` | T036–T048 (13) | US2 |
| 5 | `T-002-06` | T049–T063 (15) | US1, US5 |
| 6 | `T-002-07` | T064–T070 (7) | US7 |
| 7 | `T-002-08` | T071–T073 (3) | US8 |
| 8 | polish | T074–T077 (4) | — |
| **Total** | | **77** | |
