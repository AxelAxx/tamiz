# Data Model: Provider Routing

**Feature**: `002-provider-routing` · **Date**: 2026-10-18

Nothing is persisted in this feature. Three kinds of shapes exist: **contract schemas**
(`@tamiz/contracts`, Zod 4 `strictObject`, the edge), **domain types**
(`apps/gateway/src/domain`, zero imports, branded with the domain's own brands, R-01)
and **application shapes** (ports and use-case inputs/outputs). Feature 001 shapes are
referenced, not repeated (`specs/001-contracts-and-skeleton/data-model.md`).

## 1. Closed lists (domain tuples ⇄ contract enums, drift-tested, R-03)

| Name | Values |
|---|---|
| `ProviderName` | `ollama`, `mistral`, `anthropic`, `openai` |
| `Residency` | `local`, `eu`, `us`, `global` |
| `TaskType` | `chat`, `summarize`, `extract`, `classify`, `code`, `translate` |
| `TaskSize` | `short`, `medium`, `long` |
| `Sensitivity` | `unknown` (feature 005 adds `none`, `low`, `high`, `critical`) |
| `PrivacyAction` | `allow` (feature 005 adds `anonymize`, `restrict_to_local`, `block`) |
| `FinishReason` | `stop`, `length`, `content_filter` (from 001) |
| `ProviderErrorCause` | `http_error`, `timeout`, `network`, `malformed_response`, `rate_limited`, `authentication` |
| `ErrorType` (001, extended) | 001's seven values + `provider_timeout` |

## 2. Contract extensions (`@tamiz/contracts`)

### 2.1 `ChatCompletionResponse.usage` (extends 001 §3)

| Field | Type | Rules |
|---|---|---|
| `prompt_tokens`, `completion_tokens`, `total_tokens` | integer ≥ 0 | unchanged |
| `cost_usd` | `Usd`, optional | present on every gateway response (FR-035) |
| `estimated` | boolean, optional | `true` when the provider omitted usage (FR-034) |

Response headers (documented in OpenAPI, not body fields): `x-tamiz-route` (target id),
`x-tamiz-rule` (rule id or `default`), plus `x-request-id` from 001.

### 2.2 `ErrorType` (extends 001 §5)

Adds `provider_timeout` → HTTP 504 in `errorTypeToHttpStatus`. All other mappings
unchanged.

### 2.3 `RoutingPolicySchema` (new, FR-019)

```text
RoutingPolicy {
  id: PolicyId                         // 001 brand, ≤ 64 chars
  version: integer ≥ 1
  defaultTimeoutMs: integer > 0        // Milliseconds; default 30000 when omitted
  targets: ModelTarget[]               // min 1
  rules: RoutingRule[]                 // may be empty
  default: { route: TargetId[] }       // min 1
}
ModelTarget {
  id: TargetId                         // ^[a-z0-9][a-z0-9-]{0,63}$
  provider: ProviderName
  model: string                        // non-empty, provider model name
  region: string                       // non-empty label, e.g. "eu-west", "local"
  residency: Residency
  pricing: { inputUsdPerMillion: Usd; outputUsdPerMillion: Usd }   // ≥ 0
  timeoutMs?: integer > 0
}
RoutingRule {
  id: RuleId                           // same charset as TargetId; "default" is reserved
  when: { taskType?: TaskType[] (min 1); size?: TaskSize[] (min 1); requestedModel?: string[] (min 1) }
                                       // {} allowed = matches everything; no `sensitivity` key (rejected until 005)
  route: TargetId[]                    // min 1
  orderBy?: "cost"                     // omitted = as listed
  timeoutMs?: integer > 0              // per-rule (per task type) timeout; wins over target and default
}
```

Schema-level rules (Zod): shapes, enums, ranges, non-empty arrays, unknown keys rejected.
Cross-field rules (domain `validatePolicy`, FR-004): unique target ids, unique rule
ids, no rule id `default`, every `route` entry and `default.route` entry declared, no
duplicate entry within a chain. Every issue is `{ path, message }`.

### 2.4 YAML file (R-09)

Same shape, one document. Illustrative default policy: `contracts/policy.example.yaml`
(copied to `apps/gateway/policies/default.yaml` by `T-002-05`).

## 3. Domain types (`apps/gateway/src/domain`)

### 3.1 `units.ts` (R-01)

`Usd`, `Milliseconds`, `PolicyId`, `TargetId`, `RuleId`, `RequestId`, `ClientId`:
branded primitives with constructors that return `Result<Brand, ValidationError>`
(`usd(n)`, `milliseconds(n)`, …) and unsafe `*Unchecked` variants for values already
validated at the edge. Rules match the contract brands (001 §1) so a conversion never
fails for a valid edge value.

### 3.2 `inference-request.ts`

```text
Message { role: "system" | "user" | "assistant"; content: string }
InferenceRequest {
  requestId: RequestId; clientId: ClientId
  requestedModel: string               // the client's `model` field, verbatim
  messages: readonly Message[]         // min 1 (validated at the edge)
  temperature?: number; maxTokens?: number
}
```

### 3.3 `task-classifier.ts` (R-07)

```text
Classification { taskType: TaskType; size: TaskSize; estimatedInputTokens: number }
classify(messages) → Classification                         // pure; the requested model is a decision input, not a classifier input
estimateTokens(text) → number                               // ceil(length / 4)
SIZE_THRESHOLDS = { short: 512, medium: 4096 }              // tokens, inclusive upper bounds
TYPE_PRECEDENCE = ["code", "translate", "extract", "classify", "summarize"]
CUES: Record<TaskType except chat, readonly RegExp[]>        // the table in research R-07
ClassifiedRequest = InferenceRequest & Classification & { sensitivity: "unknown" }
```

### 3.4 `model-target.ts`, `routing-policy.ts`

Domain mirrors of §2.3 with brands (`Usd`, `Milliseconds`, `TargetId`, `RuleId`,
`PolicyId`), all `readonly`. `routing-policy.ts` exports `validatePolicy(input:
RoutingPolicyInput) → Result<RoutingPolicy, ValidationError>` (cross-field rules) and
`targetById(policy, id) → ModelTarget` (total after validation).

### 3.5 `routing-decision.ts` (FR-005)

```text
RoutingDecision {
  policyId: PolicyId; policyVersion: number
  ruleId: RuleId | "default"
  ruleTimeoutMs?: Milliseconds         // copied from the matched rule when it sets one
  chain: readonly ModelTarget[]        // non-empty, no duplicates, all declared
  taskType: TaskType; size: TaskSize
  sensitivity: "unknown"
  privacyAction: "allow"
}
decide(policy: RoutingPolicy, request: ClassifiedRequest) → RoutingDecision   // total, pure (R-08)
matches(rule, request) → boolean     // each present `when` field contains the request value
orderTargets(rule, policy) → ModelTarget[]   // "cost": stable sort by input + output price
```

### 3.6 `cost.ts` (FR-033)

```text
Usage { promptTokens: number; completionTokens: number; estimated: boolean }
computeCost(usage, pricing) → Usd     // promptTokens × in / 1e6 + completionTokens × out / 1e6
```

Exact for the pricing corpus to 1e-9 (plain IEEE doubles; no rounding applied, the
dashboard rounds for display).

### 3.7 `errors.ts` (extends 001 §6, FR-013)

| `kind` | Fields | Constructor |
|---|---|---|
| `provider` | `targetId: TargetId`, `provider: ProviderName`, `cause: ProviderErrorCause`, `retryable: boolean`, `message`, `status?: number` | `providerError(...)` |
| `unauthorized` | `message` | `unauthorizedError(...)` |

The union stays exhaustive; `presentation/mappers/error-envelope.ts` gains the two
cases: `provider` → `provider_error` (502) or, when `cause === "timeout"`,
`provider_timeout` (504); `unauthorized` → `unauthorized` (401).

## 4. Application shapes (`apps/gateway/src/application`)

### 4.1 Ports

```text
LlmProviderPort {
  complete(input: ProviderCompletionInput): Promise<Result<ProviderCompletion, ProviderError>>
}
ProviderCompletionInput { target: ModelTarget; messages: readonly Message[]; temperature?: number; maxTokens?: number; timeoutMs: Milliseconds }
ProviderCompletion { text: string; finishReason: FinishReason; usage?: { promptTokens: number; completionTokens: number }; modelName: string }

PolicyRepositoryPort { getActive(): Promise<RoutingPolicy> }
ProviderRegistry { resolve(provider: ProviderName): LlmProviderPort }     // application type, built in main.ts
ClockPort { now(): Date }                                                   // from 001
```

### 4.2 Use cases

```text
classifyTask(request: InferenceRequest) → ClassifiedRequest                 // wraps domain classify

routeInference(deps: { policies: PolicyRepositoryPort; providers: ProviderRegistry; clock: ClockPort })
  (request: InferenceRequest) → Promise<Result<RoutedCompletion, RoutingFailure>>

RoutedCompletion { decision: RoutingDecision; target: ModelTarget; completion: ProviderCompletion;
                   usage: Usage; cost: Usd; createdAt: Date }
RoutingFailure   { decision: RoutingDecision; target: ModelTarget; error: ProviderError }
```

Order inside `routeInference` (FR-012): classify → `getActive()` → `decide` → `target =
chain[0]` → `timeoutMs = decision.ruleTimeoutMs ?? target.timeoutMs ??
policy.defaultTimeoutMs` → `complete()` → usage (reported or estimated) →
`computeCost` → `RoutedCompletion` (`createdAt = clock.now()`). Only `chain[0]` is
called in this feature. `usage` and `cost` are added by `T-002-07`.

## 5. Configuration (extends 001 §7, R-12)

| Setting | Env var | Type | Default |
|---|---|---|---|
| `policyFile` | `TAMIZ_POLICY_FILE` | path | `policies/default.yaml` |
| `apiKeys` | `TAMIZ_API_KEYS` | `ApiKeyRecord[]` (parsed from `clientId:sha256hex,…`) | **required**, min 1 |
| `providers.ollama.baseUrl` | `OLLAMA_BASE_URL` | URL | `http://localhost:11434/v1` |
| `providers.mistral.apiKey` / `.baseUrl` | `MISTRAL_API_KEY` / `MISTRAL_BASE_URL` | string / URL | — / provider default |
| `providers.anthropic.apiKey` / `.baseUrl` | `ANTHROPIC_API_KEY` / `ANTHROPIC_BASE_URL` | string / URL | — / provider default |
| `providers.openai.apiKey` / `.baseUrl` | `OPENAI_API_KEY` / `OPENAI_BASE_URL` | string / URL | — / provider default |

`ApiKeyRecord { clientId: ClientId; keyHash: string /* 64 hex */ }`. Boot order:
`loadConfig` → `loadPolicyFile` → `checkProviderSettings(policy, config)` → build
registry → `createApp`. Any failure exits 1 before `serve()`.

## 6. Routing dataset (R-13)

```text
line 1: { dataset: "routing", version: 1, policy: "apps/gateway/policies/default.yaml", synthetic: true, language: ["es","en"], note: string }
line n: { id: string (unique), messages: Message[], model?: string,
          expected: { taskType: TaskType, size: TaskSize, route: TargetId } }
```

Gate: `matches(route) / cases ≥ 0.95`; report task-type accuracy and every mismatch.

## 7. Relationships

```text
ChatCompletionRequest ──presentation mapper──▶ InferenceRequest ──classifyTask──▶ ClassifiedRequest
RoutingPolicySchema (file) ──loader + validatePolicy──▶ RoutingPolicy ──PolicyRepositoryPort──▶ routeInference
decide(RoutingPolicy, ClassifiedRequest) ──▶ RoutingDecision { chain[0] = target }
ProviderRegistry.resolve(target.provider) ──▶ LlmProviderPort.complete ──▶ ProviderCompletion | ProviderError
ProviderCompletion.usage + target.pricing ──computeCost──▶ Usd ──▶ usage.cost_usd
RoutingDecision ──▶ x-tamiz-route / x-tamiz-rule (success and provider-error responses)
ApiKeyRecord ──auth middleware──▶ clientId ──▶ InferenceRequest.clientId
```
