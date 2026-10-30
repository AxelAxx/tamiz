# Data Model: Privacy-Aware Routing

**Feature**: `005-privacy-aware-routing` · **Date**: 2026-10-30 · **Plan**: [plan.md](plan.md)

Shapes by layer. Paths are relative to `apps/gateway/src/` unless stated. Closed lists are
tuples (`as const`) in the domain, mirrored as `z.enum` in `@tamiz/contracts` (002 R-03).

## 1. Contracts (`packages/contracts/src`)

### 1.1 `privacy-service.ts` (new; mirror of `services/privacy/openapi.json`)

```ts
PrivacyEntityKindSchema   = z.enum(["DNI","NIE","CIF","IBAN","NSS","PHONE","EMAIL","CREDIT_CARD","PERSON","LOCATION"])
PrivacySensitivitySchema  = z.enum(["none","low","high","critical"])
PrivacyAnalyzeRequestSchema  = z.strictObject({ text, language?: "es", min_score?: number|null, entities?: kind[]|null })
PrivacyFindingSchema      = z.object({ kind, start: int ≥ 0, end: int > 0, score: 0..1 })
PrivacyAnalyzeResponseSchema = z.object({ findings, counts: record(kind, int), sensitivity_level })
PrivacyErrorEnvelopeSchema   = z.object({ error: { type, message, field: string|null } })
```

Response objects are parsed with `z.object` (unknown fields ignored, forward-compatible);
the drift test (research R-03) compares names, required lists and enums with the OpenAPI
document.

### 1.2 `routing-policy.ts` (extended)

```ts
SensitivityLevelSchema = z.enum(["none","low","high","critical"])
PrivacyActionSchema    = z.enum(["allow","anonymize","restrict_to_local","block"])
PrivacyLevelSchema     = z.strictObject({ action: PrivacyActionSchema, residency: ResidencyListSchema.optional() })
PrivacySectionSchema   = z.strictObject({
  onDetectorError: z.enum(["restrict_to_local","block"]),
  localRoute: z.array(TargetIdSchema).min(1),
  levels: z.strictObject({ none, low, high, critical: PrivacyLevelSchema }),   // all required
})
RoutingPolicySchema    = … + privacy: PrivacySectionSchema                      // required; version ≥ 3 by convention
```

### 1.3 `simulate.ts` (new)

```ts
SimulateRequestSchema  = ChatCompletionRequestSchema            // same body; `stream` ignored
SimulatedEntitySchema  = z.strictObject({ messageIndex: int ≥ 0, kind, start, end, score })
SimulateResponseSchema = z.strictObject({
  sensitivity: z.enum(["unknown","none","low","high","critical"]),
  entities: SimulatedEntity[],
  detector: z.enum(["ok","unavailable","timeout","contract"]),
  ruleId: string,
  decision: z.enum(["route","block"]),
  privacyAction: PrivacyActionSchema,
  chain: z.array(z.strictObject({ id, provider, model, residency })),   // empty when blocked
  allowedResidencies: ResidencySchema[],
  blockReason?: z.enum(["action","no_target","detector_unavailable"]),
  providerMessages?: z.array(z.strictObject({ role, content })),      // anonymize only: what the provider would receive
  notice?: z.literal("v1"),                                            // anonymize only
})
```

### 1.4 `error.ts`

`ErrorTypeSchema` + `privacy_unavailable` (503).

## 2. Domain (`domain/`)

### 2.1 `model/sensitivity.ts`

```ts
SENSITIVITY_LEVELS = ["none","low","high","critical"] as const     // ordered
SENSITIVITIES = ["unknown", ...SENSITIVITY_LEVELS] as const
ENTITY_KINDS = ["DNI","NIE","CIF","IBAN","NSS","PHONE","EMAIL","CREDIT_CARD","PERSON","LOCATION"] as const
type MessageIndex = Brand<number, "MessageIndex">
interface DetectedEntity { messageIndex; kind; start; end; score }   // UTF-16 offsets into that message
type Inspection =
  | { status: "ok"; level: SensitivityLevel; entities: ReadonlyArray<DetectedEntity> }
  | { status: "failed"; reason: "unavailable" | "timeout" | "contract" }
sensitivityOf(inspection): Sensitivity                                // "unknown" when failed
```

### 2.2 `model/privacy-policy.ts` (new)

```ts
PRIVACY_ACTIONS = ["allow","anonymize","restrict_to_local","block"] as const
DETECTOR_ERROR_ACTIONS = ["restrict_to_local","block"] as const
interface PrivacyLevelSettings { action; residency?: ReadonlyArray<Residency> }
interface PrivacySettings { onDetectorError; localRoute: ReadonlyArray<TargetId>; levels: Record<SensitivityLevel, PrivacyLevelSettings> }
validatePrivacy(settings, declared targets): Issues        // FR-004: localRoute local-only; critical allow ⇒ residency ⊆ {local, eu}
applyPrivacy(chain, ruleResidency, settings, inspection): PrivacyOutcome
  // → { kind: "route", action, chain, allowedResidencies } | { kind: "block", reason }
```

### 2.3 `model/routing-decision.ts` (changed)

```ts
DecisionInput += inspection: Inspection
type RoutingDecision = RouteDecision | BlockDecision
RouteDecision { kind: "route"; …002/003 fields; sensitivity: Sensitivity; privacyAction: "allow"|"anonymize"|"restrict_to_local"; chain (non-empty); allowedResidencies }
BlockDecision { kind: "block"; policyId; policyVersion; ruleId; sensitivity; privacyAction: "block"; reason: "action"|"no_target"|"detector_unavailable" }
decide(policy, input): RoutingDecision       // pure, total (FR-005 properties)
```

### 2.4 `model/placeholders.ts` (new; port of feature 004 R-07)

```ts
PLACEHOLDER_PATTERN: RegExp                   // <(KIND)_(\d+)>, global
interface PlaceholderEntry { placeholder; kind; value }
anonymizeMessages(messages: string[], entities: DetectedEntity[]): { messages: string[]; mapping: PlaceholderEntry[] }
  // numbering across all messages, in message order then offset; skips existing <KIND_n>
restore(text, mapping): string                // one pass, mapped placeholders only (R-10)
```

### 2.5 `model/restore-stream.ts` (new)

```ts
createRestorer(mapping): { push(text: string): string; flush(): string }   // research R-07
MAX_PLACEHOLDER_LENGTH = 17
```

### 2.6 `errors.ts`

`PrivacyBlockedError { level, action, ruleId, reason }` → 451; `PrivacyUnavailableError
{ reason }` → 503. Messages are built from enums and ids only.

## 3. Application (`application/`)

### 3.1 Ports

```ts
interface PiiDetectorPort {
  inspect(messages: ReadonlyArray<string>, signal: AbortSignal): Promise<Inspection>   // never rejects; failures are values
}
interface DetectionCachePort {
  get(key: string): Inspection & { status: "ok" } | undefined
  set(key: string, value: Inspection & { status: "ok" }): void
}
```

### 3.2 Use cases

```ts
inspectSensitivity(deps: { detector; cache; clock; events; timeoutMs }) → (messages, signal) => Promise<Inspection>
  // key = sha256 via an injected `hash` function (no crypto import in application); withTimeout; events
routeInference(...)   // + inspection before decide; block → error; anonymize → anonymizeMessages + notice; restore answer
streamInference(...)  // same before the stream; parts' text through createRestorer; flush before usage
simulatePolicy(deps) → (request) => Promise<SimulationResult>   // no provider port in deps (by type)
```

`RoutingEvent` gains `privacy.inspected { level, counts, cached }`,
`privacy.detector_failed { reason }`, `privacy.action { action, level, ruleId }` and
`privacy.anonymized { placeholders: number }`. None has a content field.

## 4. Infrastructure

| Module | Shape |
|---|---|
| `privacy/http-pii-detector.ts` | `createHttpPiiDetector({ baseUrl, fetch })`: one `POST /analyze` over the joined messages; Zod parse; code point → UTF-16 → per-message offsets; boundary check; failures `unavailable` (network, 5xx, 503 `not_ready`), `contract` (parse, boundary, 4xx). The timeout is the use case's. |
| `cache/in-memory-detection-cache.ts` | LRU `Map` with `maxEntries` and `ttlMs`, time from `ClockPort`. |
| `config/env.ts` | `TAMIZ_PRIVACY_URL` (required http(s)), `TAMIZ_PRIVACY_TIMEOUT_MS` (default 2000, 100–30 000), `TAMIZ_PRIVACY_CACHE_MAX_ENTRIES` (1000, 0 disables), `TAMIZ_PRIVACY_CACHE_TTL_MS` (600 000). |
| `prompts/anonymization-notice.v1.md` | Read at boot by `main.ts`; a missing file is a boot error. |

## 5. Presentation

- `routes/chat-completions.ts`:
  - success responses carry `x-tamiz-sensitivity` and `x-tamiz-privacy` (`allow`,
    `anonymize;notice=v1`, `restrict_to_local`);
  - a `BlockDecision` → `451`;
  - a detector failure with `block` → `503 privacy_unavailable`;
  - both errors carry the headers too.
- `routes/simulate.ts`: `POST /v1/simulate`, API-key auth, the contract of §1.3.

## 6. Policy files

`policies/default.yaml` and `local-only.yaml` → version 3 with the `privacy` section of
research R-11.

## 7. Relationships

```text
chat-completions route ─▶ routeInference/streamInference ─▶ inspectSensitivity ─▶ PiiDetectorPort ◀─ HttpPiiDetector ─▶ privacy service /analyze
                                   │                              └─▶ DetectionCachePort ◀─ InMemoryDetectionCache
                                   ├─▶ decide(policy, {classification, inspection}) ─▶ applyPrivacy
                                   ├─▶ anonymizeMessages / restore / createRestorer   (domain, request scope)
                                   └─▶ executeChain (003) ─▶ LlmProviderPort
simulate route ─▶ simulatePolicy ─▶ inspectSensitivity + decide + anonymizeMessages   (no provider port)
```
