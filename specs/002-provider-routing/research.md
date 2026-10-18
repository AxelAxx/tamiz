# Research: Provider Routing

**Feature**: `002-provider-routing` · **Date**: 2026-10-18

Each entry: decision, rationale, alternatives. Library facts were checked against the
libraries' current documentation on 2026-10-18 (Context7: `ai@6.0.0`,
`@ai-sdk/openai-compatible`, `@hono/zod-openapi`, `@hono/zod-validator`). Feature 001
decisions (`specs/001-contracts-and-skeleton/research.md`, R-01 … R-12) are inherited and
not repeated; this file numbers from R-01 again with the prefix `002/` when cited
elsewhere.

## R-01 The domain owns its branded units and message types

**Decision**: `apps/gateway/src/domain/model/units.ts` declares the domain's own branded
types (`Usd`, `Milliseconds`, `PolicyId`, `TargetId`, `RuleId`, `RequestId`) with
`unique symbol` brands and small validating constructors, and
`domain/model/inference-request.ts` declares `Message { role, content }` and
`InferenceRequest`. The `@tamiz/contracts` brands of feature 001 remain the **edge**
brands (HTTP, policy file); mappers in `presentation/mappers` and
`infrastructure/policy` convert between the two with explicit constructors.

**Rationale**: constitution I and the feature 001 rule `domain-imports-nothing` forbid
the domain from importing *anything*, including a workspace package and including
type-only imports (001 spec US6-2). Zod 4 brands use a `unique symbol` owned by Zod, so
a hand-rolled brand cannot be made assignable to the contract brand; a conversion at the
boundary is unavoidable if the domain stays pure. The same applies to `application`,
which may import only `domain`: use cases receive domain `InferenceRequest`, never the
contract DTO. The cost is one mapping function per boundary and two `Usd` types with the
same name in different packages; both are visible and tested (a drift test asserts the
closed lists match, R-03).

**Alternatives**: allow type-only imports from `@tamiz/contracts` into `domain`
(cleanest code, but it changes the 001 rule and test and weakens the "imports nothing"
claim; **flagged for Alex**: if he prefers it, `units.ts` disappears and the 001 rule
gains `dependencyTypesNot: ["type-only"]`); a `@tamiz/kernel` package holding brands and
`Result` (speculative, constitution X).

## R-02 Policy shape lives in contracts, policy semantics live in the domain

**Decision**: `@tamiz/contracts` exports `RoutingPolicySchema` (Zod 4 `strictObject`:
shape, enums, per-field ranges) and its inferred `RoutingPolicyDto`. The domain exports
`RoutingPolicy` (branded, readonly) and `validatePolicy(dto-like) → Result<RoutingPolicy,
ValidationError>` which applies the cross-field rules of FR-004 (unique ids, chains
reference declared targets, no duplicates, reserved id `default`). The file loader
(`infrastructure/policy`) runs schema → `validatePolicy` → domain policy.

**Rationale**: FR-019 needs the same schema in the dashboard editor (feature 008) and
the gateway; cross-field rules need no Zod and belong with `decide()` so the domain is
self-consistent even when a policy arrives from memory in tests.

**Alternatives**: Zod `superRefine` for the cross-field rules (would duplicate them in
the domain anyway for in-memory policies); domain-only validation (the dashboard could
not validate offline).

## R-03 Closed lists are declared twice with a drift test

**Decision**: `TaskType`, `TaskSize`, `ProviderName`, `Residency`, `FinishReason`,
`PrivacyAction`, `Sensitivity` are `as const` tuples in the domain and `z.enum` in
contracts. `apps/gateway/test/contracts-drift.test.ts` asserts each contract enum's
`.options` deep-equals the domain tuple.

**Rationale**: consequence of R-01; six short lists are cheaper than a shared package.

**Alternatives**: generating one from the other at build time (tooling for a dozen
strings).

## R-04 LLM calls through AI SDK 6 with retries disabled

**Decision**: one generic adapter factory
`infrastructure/llm/ai-sdk-provider.ts` (`createAiSdkProvider({ languageModel: (modelName) => LanguageModel })`)
implements `LlmProviderPort` once: `generateText({ model, messages, temperature,
maxOutputTokens, abortSignal: AbortSignal.timeout(timeoutMs), maxRetries: 0 })`, maps
`result.text`, `result.finishReason`, `result.usage.inputTokens/outputTokens` and
`result.response.modelId`. The four provider adapters are one-liners that supply the
model factory: `createOpenAICompatible({ name: "ollama", baseURL })` (`.chatModel(id)`),
`createMistral({ apiKey, baseURL? })`, `createAnthropic({ apiKey, baseURL? })`,
`createOpenAI({ apiKey, baseURL? })`.

**Rationale**: AI SDK 6 retries by default (`maxRetries` defaults to 2); Tamiz's own
resilience (feature 003) must be the only retry layer, so `maxRetries: 0` is mandatory
and tested (an MSW handler counting calls). `abortSignal` is the documented timeout
mechanism and aborts the underlying fetch (FR-015). Ollama exposes an OpenAI-compatible
`/v1` endpoint, so `@ai-sdk/openai-compatible` covers it without a community package
(backlog `T-002-04`). Composition over inheritance (IX): the shared factory is a
function, the adapters are configurations.

**Alternatives**: `ollama-ai-provider-v2` (community; one more dependency, no benefit
for chat); calling provider REST APIs directly with `fetch` (four hand-written clients,
no normalisation of errors and usage).

## R-05 Mapping AI SDK errors to `ProviderError`

**Decision** (in `ai-sdk-provider.ts`, the only place that knows AI SDK error classes):

| Observed | `cause` | `retryable` | `status` |
|---|---|---|---|
| `APICallError` with `statusCode` 429 | `rate_limited` | true | 429 |
| `APICallError` with `statusCode` ≥ 500 | `http_error` | true | n |
| `APICallError` with `statusCode` 401 or 403 | `authentication` | false | n |
| `APICallError` with other `statusCode` < 500 | `http_error` | false | n |
| `APICallError` without `statusCode` (fetch failed), `TypeError` from fetch | `network` | true | — |
| `DOMException` / error with `name` `TimeoutError` or `AbortError` (from `AbortSignal.timeout`) | `timeout` | true | — |
| `JSONParseError`, `TypeValidationError`, `InvalidResponseDataError`, `NoContentGeneratedError` | `malformed_response` | false | — |
| anything else | `http_error` | false | — |

The error `message` is a short fixed phrase per cause plus the status; the AI SDK
error's `responseBody`, `requestBodyValues` and `url` are **never** copied (FR-017).
`generateText` succeeding with `finishReason: "error"` is treated as
`malformed_response`.

**Rationale**: `APICallError.isInstance()` and `statusCode` / `isRetryable` are the
documented public fields; the mapping is deterministic and testable per provider with
MSW (US6 scenarios 2–5).

**Alternatives**: trusting `error.isRetryable` from the SDK (it marks 408/409/429/5xx as
retryable; we want 401/403 explicit and `authentication` as its own cause).

## R-06 Finish reason and usage normalisation

**Decision**: AI SDK `finishReason` → contract: `stop` → `stop`, `length` → `length`,
`content-filter` → `content_filter`, `tool-calls` / `other` / `unknown` → `stop`,
`error` → `malformed_response` error. Usage: `inputTokens` / `outputTokens`; when either
is `undefined`, estimate with the domain `estimateTokens` (R-08) over the request
messages (input) and the generated text (output) and set `estimated: true` (FR-034).

**Rationale**: the contract list is closed (001 FR-008); estimates are flagged, never
silent (constitution VI).

## R-07 Rule-based classifier

**Decision**: `domain/model/task-classifier.ts` exports `classify(messages) →
Classification` and `estimateTokens(text) = ceil(length / 4)`.
Text under inspection: all `system` messages plus the **last** `user` message,
lower-cased and accent-stripped (`normalize("NFD")` + strip combining marks) so Spanish
cues match with or without accents. Size thresholds (estimated input tokens over **all**
messages): `short` ≤ 512, `medium` ≤ 4096, `long` > 4096. Type precedence, first hit
wins: `code` → `translate` → `extract` → `classify` → `summarize` → `chat`. Cue lists
(word-boundary regexes, EN + ES) are a single `as const` table in the same file so the
dataset and the docs can quote it:

| Type | Cues (lower-case, accents stripped) |
|---|---|
| `code` | a fenced block (```` ``` ````), `code`, `codigo`, `function`, `funcion`, `class`, `clase`, `bug`, `stack trace`, `refactor`, `refactoriza`, `implement`, `implementa`, `compile`, `compila`, `unit test`, `test unitario`, `regex`, `script`, `sql`, `typescript`, `javascript`, `python`, `java` |
| `translate` | `translate`, `translation`, `traduce`, `traducir`, `traduccion`, `into english`, `into spanish`, `al ingles`, `al espanol`, `al castellano`, `al frances`, `al aleman` |
| `extract` | `extract`, `extrae`, `extraer`, `extraccion`, `as json`, `en json`, `in json`, `fields`, `campos`, `parse`, `parsea`, `list all`, `lista todos`, `lista todas` |
| `classify` | `classify`, `classification`, `clasifica`, `clasificar`, `clasificacion`, `categorize`, `categoria`, `category`, `sentiment`, `sentimiento`, `label`, `etiqueta`, `spam` |
| `summarize` | `summarize`, `summarise`, `summary`, `resume`, `resumen`, `resumir`, `tl;dr`, `key points`, `puntos clave`, `sintesis` |

**Rationale**: FR-008 asks for a documented, deterministic, bilingual rule set; the
routing dataset (R-13) is the check that keeps it honest; the learned classifier of the
roadmap replaces this function behind the same signature.

**Alternatives**: a tokenizer-accurate count (`js-tiktoken`) for size (heavier, provider
specific; the estimate only picks a bucket); classifying every message (older turns
would dominate long chats).

## R-08 `decide()` is total over validated policies

**Decision**: `decide(policy: RoutingPolicy, request: ClassifiedRequest):
RoutingDecision` returns a value, not a `Result`: validation (R-02) guarantees every
chain is non-empty and references declared targets, so there is no failure path left.
Cost ordering (`orderBy: "cost"`) sorts a copy of the rule's targets by
`inputUsdPerMillion + outputUsdPerMillion` with a stable sort (declaration order on
ties). The decision's `chain` holds full `ModelTarget` objects (readonly), resolved from
the policy's target map.

**Rationale**: constitution VI wants `Result` where failure exists; a total function is
simpler and the property test (SC-003) proves the invariants. Stable sort is guaranteed
by `Array.prototype.sort` since ES2019.

**Alternatives**: `Result` with an unreachable error (noise); resolving target objects
in the use case (then the domain decision would be a list of ids and every consumer
would re-resolve).

## R-09 Policy file: YAML parsed with `yaml`, validated by contracts

**Decision**: `infrastructure/policy/file-policy-loader.ts` reads the path from
`TAMIZ_POLICY_FILE` (default `policies/default.yaml`, relative to the process working
directory), parses with the `yaml` package (`parse`), validates with
`RoutingPolicySchema.safeParse` and then `validatePolicy`, returning
`Result<RoutingPolicy, ConfigurationError>` whose issues carry `path` (Zod path joined
with `.`, e.g. `rules.2.route.0`) and `message`. JSON files work unchanged (YAML 1.2 is a
superset). Shipped files: `apps/gateway/policies/default.yaml` (four providers,
FR-023) and `apps/gateway/policies/local-only.yaml` (one Ollama target, SC-009).

**Rationale**: YAML is what operators and the feature 008 editor expect; `yaml`
(eemeli) is the maintained YAML 1.2 parser without `js-yaml`'s legacy types; path-bearing
issues satisfy US2 scenarios 1–2.

**Alternatives**: JSON only (hostile to hand editing, no comments); `js-yaml` (YAML
1.1 quirks: `yes`/`no` as booleans).

## R-10 API keys: SHA-256 hashes in the environment, constant-time compare

**Decision**: `TAMIZ_API_KEYS` holds comma-separated `clientId:sha256hex` entries
(`clientId` matches `^[a-z0-9][a-z0-9-]{0,63}$`, hash is 64 hex chars). Keys are
`tmz_` + 32 random bytes in base64url (43 chars), generated by
`pnpm --filter @tamiz/gateway generate-api-key <clientId>` which prints the key once
and the entry to paste. The auth middleware (`presentation/middlewares/api-key-auth.ts`)
parses `Authorization: Bearer <key>`, hashes with `node:crypto` `createHash("sha256")`,
compares against **every** entry with `timingSafeEqual`, and sets `clientId` on the
context; failures return 401 through the error mapper. The middleware receives the parsed
key records from the composition root; it never reads `process.env`.

**Rationale**: keys are high-entropy random strings, so a fast hash is the right choice
(bcrypt/argon2 protect low-entropy passwords); constant-time comparison avoids timing
leaks; feature 006 moves the same records to Postgres (`api_keys` table) without changing
the middleware. The whole-list scan keeps timing independent of which entry matches.

**Alternatives**: plain-text keys in env (violates "hashed in DB" of `CLAUDE.md` §8
and the constitution's security rules); JWT (no issuer exists); argon2 (slow per request
for no security gain on random keys).

## R-11 Endpoint, OpenAPI and body limit

**Decision**: the chat route is declared with `createRoute` from `@hono/zod-openapi` and
mounted on an `OpenAPIHono` sub-app (`presentation/routes/chat-completions.ts`), passing
the `@tamiz/contracts` schemas directly (the package keeps plain `zod` as its only
dependency; `@hono/zod-openapi` 1.x supports Zod 4 and reads native `.meta()` /
`.describe()` for descriptions and examples). The document is served at
`GET /openapi.json` via `app.doc()` (OpenAPI 3.1) and a contract test asserts it contains
the three schemas and the `x-tamiz-route` / `x-tamiz-rule` response headers. The
feature 001 review projection `specs/001-contracts-and-skeleton/contracts/openapi.yaml`
is deleted in `T-002-06` (001 tasks T076). The validation hook of `OpenAPIHono`
(`defaultHook`) maps Zod issues to the 400 envelope with paths and messages only
(FR-027). `bodyLimit({ maxSize: 1024 * 1024 })` from `hono/body-limit` guards the route
with an `onError` that returns the 400 `invalid_request` envelope (FR-032).

**Rationale**: constitution II (OpenAPI derived from Zod); the risk that `.meta()` is
not picked up is contained: the test would fail and a thin `withOpenApi()` helper in
presentation would add the metadata without touching contracts.

**Alternatives**: `@hono/zod-validator` on a plain `Hono` app plus a separate OpenAPI
generator (`zod-openapi`): two libraries for one job; keeping the hand-written YAML
(forbidden by II).

## R-12 Provider settings and boot cross-check

**Decision**: the feature 001 env schema gains: `TAMIZ_POLICY_FILE` (default
`policies/default.yaml`), `TAMIZ_API_KEYS` (required, see R-10), `OLLAMA_BASE_URL`
(default `http://localhost:11434/v1`), `MISTRAL_API_KEY`, `ANTHROPIC_API_KEY`,
`OPENAI_API_KEY` (optional), `MISTRAL_BASE_URL`, `ANTHROPIC_BASE_URL`,
`OPENAI_BASE_URL` (optional overrides for proxies). `main.ts` loads the config, loads
the policy, then runs `checkProviderSettings(policy, config)`: every provider used by a
target must have its credential (or, for Ollama, its base URL); otherwise it prints
`target <id>: provider <name> needs <SETTING>` and exits 1 (FR-021). Secrets are never
echoed. `TAMIZ_API_KEYS` is the first required setting, which activates the "missing
variable" branch of 001 FR-015.

**Rationale**: fail fast (VI); adapters take explicit settings (FR-014) so tests build
them with fake URLs.

**Alternatives**: lazily failing at the first request to an unconfigured provider
(silent until production traffic).

## R-13 Routing dataset and gate test

**Decision**: `packages/evals/datasets/routing.v1.jsonl`, first line a header object
`{ "dataset": "routing", "version": 1, "policy": "apps/gateway/policies/default.yaml",
"synthetic": true, "language": ["es", "en"], "note": "..." }`, then one case per line
`{ "id": "routing-001", "messages": [...], "model": "tamiz-auto", "expected": { "taskType":
"code", "size": "short", "route": "anthropic-sonnet" } }`. The gate test
`apps/gateway/test/evals/routing-dataset.test.ts` loads the default policy through the
real file loader, runs `classify` + `decide` for each case, prints a table of
mismatches (`id`, expected, actual) and asserts `matches / total ≥ 0.95`; it also
reports task-type accuracy without a threshold. `packages/evals` stays a plain folder
(README + datasets) until feature 007 makes it a workspace package with the runner; the
test then moves there.

**Rationale**: constitution IV with zero network; the dataset is bound to a policy
version so a policy change that invalidates expectations is an explicit edit of the
dataset (reviewable). Living in the gateway tests avoids a library depending on an app
(R-09 of feature 001).

**Alternatives**: making `packages/evals` a workspace package now (it would import the
gateway's domain, inverting the dependency direction); a threshold on task-type
accuracy (reported only; the route is what matters to users).

## R-14 Test doubles and MSW

**Decision**: `@tamiz/test-utils` gains generic, type-free doubles:
`createScriptedPort<I, O>(script: (input: I, call: number) => O | Promise<O>)` returning
`{ fn, calls }` (used as `FakeLlmProvider` by passing a handler typed in the gateway
test) and `createInMemoryPolicyRepository<P>(initial: P)` returning
`{ getActive(): Promise<P>, set(p: P): void }`. Provider adapters are tested with MSW 2
(`setupServer` from `msw/node`, `http.post`, `HttpResponse.json`, `delay("infinite")`
for the timeout case, `onUnhandledRequest: "error"`), one fixture file per provider with
a minimal real-shaped success body. Property tests use `fast-check` with arbitraries for
valid policies and classified requests (`fc.uniqueArray` for ids, `fc.subarray` for
chains).

**Rationale**: constitution VIII; the generic doubles keep `test-utils` free of gateway
types (001 R-09); MSW intercepts `fetch` at the Node level, so AI SDK's real HTTP path is
exercised; `delay("infinite")` lets `AbortSignal.timeout(200)` fire in a bounded test.

**Alternatives**: AI SDK's `MockLanguageModelV3` (bypasses the HTTP mapping that US6
tests); nock (not fetch-native).

## R-15 Response identity and headers

**Decision**: response `id` is `chatcmpl-<requestId>`, `created` is `floor(clock.now() /
1000)` from `ClockPort`, `model` is the provider model name of the target, headers
`x-tamiz-route: <targetId>` and `x-tamiz-rule: <ruleId | default>` are set by the route
handler from the decision for both success and provider-error responses (FR-026);
validation and auth failures run before any decision and carry neither.

**Rationale**: FR-025/FR-026; the request id makes responses correlatable with the audit
log of feature 006 without a second identifier.
