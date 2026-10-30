# Research: Privacy-Aware Routing

**Feature**: `005-privacy-aware-routing` · **Date**: 2026-10-30 · **Spec**: [spec.md](spec.md)

Decisions taken while planning. Each names what was chosen, why, and what was rejected.
Facts come from the code on `main` at 436d2d2: features 001–004, the gateway's
`decide()`, `executeChain`, `StreamInference`, and `services/privacy/openapi.json`.

## R-01 The gateway anonymizes from `/analyze` results

**Decision**: the detector port returns findings (kinds, offsets, scores) and the level;
the gateway builds placeholders with its own `domain/model/placeholders.ts`, a port of
feature 004's `anonymize` (R-07 there).

- Numbering is per kind, by first appearance, one placeholder per `(kind, value)`, and
  skips placeholder-shaped strings already present.
- Both implementations run the same test vectors: `specs/004-privacy-service/contracts/
  anonymize.example.json`, plus a new `specs/005-privacy-aware-routing/contracts/
  placeholder-vectors.json` that both test suites read.

**Rationale**:
- **Cache.** The detection cache (FR-009) can hold positions only; caching `/anonymize`
  answers would keep values in memory beyond the request.
- **Numbering across messages.** The gateway joins messages itself, so numbering across
  messages is natural.
- **Fewer moving parts.** One HTTP endpoint is used.

**Alternatives**:
- Call `/anonymize` and cache nothing: this doubles the call on every `anonymize` request
  and leaves no cache for routing.
- Call `/anonymize` and cache the mapping: values in a cache violate the spirit of V.

## R-02 One detection call per request over joined messages

**Decision**:
- **Joining.** The contents of all messages, in order, are joined with `"\n\n"` and sent
  to `/analyze` once.
- **Offsets.** The adapter converts the service's code-point offsets to UTF-16 indices
  (`Array.from` over the joined text, or a precomputed index map when the text has
  astral characters), then maps each finding to `(messageIndex, start, end)` relative to
  its message.
- **Boundaries.** A finding that crosses a separator is a `contract` failure (fail
  closed). The recognizers of feature 004 never match across a blank line, so this is a
  guard, not a path.

**Rationale**: the level is the maximum across messages; placeholders must be consistent
across messages (US2-2); one call keeps latency flat.

**Alternatives**:
- One call per message: N round trips, and per-message numbering would collide.
- Sending a JSON array: this would need a service API change for no gain.

## R-03 Zod mirror of the service's OpenAPI, with a drift test

**Decision**:
- **Mirror.** `packages/contracts/src/privacy-service.ts` defines, by hand,
  `PrivacyEntityKindSchema` (`z.enum`, the 10 kinds), `PrivacySensitivitySchema`,
  `AnalyzeRequestSchema`, `AnalyzeResponseSchema` and `PrivacyErrorEnvelopeSchema`.
- **Drift test.** A gateway test reads `services/privacy/openapi.json` and compares, for
  each mirrored component, the property names, required lists, enum values and
  `additionalProperties`. It fails with the component and field on any difference.

**Rationale**: constitution II ("Python publishes OpenAPI mirrored in Zod"). A generator
(openapi → zod) would add a dependency and a build step for five small schemas; the drift
test gives the same safety.

**Alternatives**: `openapi-zod-client` or `orval` code generation (a dependency, generated
code in contracts); trusting the service (no safety).

## R-04 The decision becomes `route | block`

**Decision**: `decide(policy, request)` returns

- `{ kind: "route", …, chain (non-empty), privacyAction: "allow" | "anonymize" | "restrict_to_local", allowedResidencies }`;
- or `{ kind: "block", …, reason: "action" | "no_target" | "detector_unavailable" }`.

The request input gains `inspection: { status: "ok", level, entities } | { status:
"failed", reason }`. The privacy step:

1. selects the level's settings, or `onDetectorError` on failure;
2. `restrict_to_local` → chain `localRoute`, residencies `[local]`;
3. `allow` and `anonymize` → the rule's chain filtered to `rule.residency ∩
   level.residency` (each absent = all);
4. an empty chain → block `no_target`;
5. `block` → block `action`.

**Rationale**: FR-003. Making "no target" a type, not an empty array, removes a class of
bugs: `executeChain` has never accepted empty chains.

**Alternatives**: keeping one shape with an empty chain for block (the invariant would
live only in comments); throwing (constitution VI: `Result` and types in the domain, not
exceptions).

## R-05 Status codes: `451` for block, `503 privacy_unavailable` for a failed detector with `block`

**Decision**:
- **`block` and `no_target`** → `451` `policy_blocked` (the type exists since feature
  002), with the message `sensitivity critical: action block (rule default)`, or `… no
  allowed target`.
- **Detector failure with `onDetectorError: block`** → `503` with a new type
  `privacy_unavailable`.
- **Detector failure with `restrict_to_local`** proceeds locally with `x-tamiz-sensitivity:
  unknown`.

**Rationale**:
- `451` already means "refused by policy" in this API (residency, feature 003). A client
  can treat every `451` the same way.
- `422` (the backlog's suggestion) would collide with request validation semantics.
- `503` says "try again later", which is true when the detector is down.

**Alternatives**: `422` (the backlog row of `T-005-04`); `403` (suggests an auth
problem).

## R-06 The placeholder notice is a versioned file

**Decision**:
- **File.** `apps/gateway/prompts/anonymization-notice.v1.md` holds a short instruction,
  in English and Spanish, to keep `<KIND_n>` tokens exactly as written.
- **Use.** For `anonymize` only, it is prepended as a system message. The response
  header `x-tamiz-privacy` carries `anonymize;notice=v1`.
- **Loading.** The file is read at boot (missing file = boot error).

**Rationale**: `CLAUDE.md` section 8 ("system prompts are versioned files"). Without it,
models often paraphrase placeholders ("PERSON_1"), and restoration fails silently.

**Alternatives**: no notice (more restoration misses); instructing via the user message
(alters the user's text).

## R-07 Streaming restoration is a pure buffer

**Decision**: `restore-stream.ts` exports `createRestorer(mapping)` returning
`{ push(text): string; flush(): string }`. On `push`, it appends to the pending text,
restores every complete placeholder found in the mapping, and returns everything except
the longest suffix that is a proper prefix of some `<KIND_n>` (for example `<`, `<PE`,
`<PERSON_1`). `flush` restores and returns the rest.

The longest held suffix is bounded by the longest placeholder (`<CREDIT_CARD_999>` = 17
characters). Text after an unmatched `<` that cannot continue to a placeholder is
released at once.

**Rationale**: FR-016, FR-017, SC-003. A pure function is property-testable: for any
chunking, `concat(push…) + flush` equals the non-streaming `restore(fullText)`.

**Alternatives**:
- Buffering the whole stream: kills streaming.
- Restoring per chunk without holding: breaks split placeholders.
- A regex over a sliding window: harder to prove.

## R-08 Detection cache: in-memory LRU with TTL, positions only

**Decision**:
- **Port.** `DetectionCachePort` has `get(key)` and `set(key, inspection)`.
- **Key.** The key is `sha256(text + "\u0000" + options)`, where options are the sorted
  kinds and the minimum score.
- **Adapter.** `InMemoryDetectionCache` is a `Map` used as an LRU, with `maxEntries`
  (default 1 000) and `ttlMs` (default 600 000) through `ClockPort`.
- **Contents.** Only successful inspections are cached; failures are not.
- **Wiring.** `withDetectionCache(detector, cache, clock)` decorates the port.

**Rationale**:
- FR-009 and constitution X: the port exists because the backlog names one, and the
  in-memory adapter is the only one.
- A Valkey adapter would move derived data about prompts out of the process; it is not
  built.
- Caching failures would turn a blip into a 10-minute outage.

**Alternatives**: `lru-cache` dependency (unnecessary for this size); caching by
request id (no reuse); Valkey (see above).

## R-09 Inspection runs concurrently with classification, under a timeout

**Decision**: `inspectSensitivity` starts the detector call, and classification runs
meanwhile. Classification is synchronous today, so the concurrency is real only once it
becomes asynchronous (a learned classifier); the code is shaped for it now. The call is
wrapped by feature 003's `withTimeout(clock)` with `TAMIZ_PRIVACY_TIMEOUT_MS` (default
2 000). The detector's own abort signal stops the fetch. There are no retries: a retry
adds latency on the critical path, and fail-closed is the safe outcome.

**Rationale**: FR-008; reuse of the resilience functions (constitution IX).

**Alternatives**: retrying the detector (latency); a circuit breaker on the detector (a
later option, measured by feature 006 telemetry).

## R-10 Restoration is one regex pass over mapped placeholders

**Decision**:
- **Restore.** `restore(text, mapping)` replaces each match of `<(KIND)_(\d+)>` that is a
  key of the mapping by its value. Anything else is left untouched (US2-3).
- **Usage and cost.** They come from the provider's anonymized exchange (US2-6).
- **The mapping's lifetime.** It is a local `Map` captured by the response mapper's
  closure, so it is never attached to a logged object.

**Rationale**: the same rule as `services/privacy/tests/support/restore.py`; a value that
looks like a placeholder is never re-replaced.

**Alternatives**: chained `replaceAll` (order-dependent bugs).

## R-11 Default privacy policy

**Decision**: `default.yaml` (version 3):

```yaml
privacy:
  onDetectorError: restrict_to_local
  localRoute: [ollama-llama]
  levels:
    none:     { action: allow }
    low:      { action: allow }
    high:     { action: anonymize, residency: [local, eu] }
    critical: { action: restrict_to_local }
```

`local-only.yaml` maps every level to `allow`. Its only target is local, so the result is
the same, and the boot check is satisfied because critical stays local.

**Rationale**:
- critical data never leaves the machine (SC-004: 0 %);
- names, phones and emails (`high`) go out only anonymized, and only to EU or local;
- locations and CIFs (`low`) route normally.

The routing dataset of 002 consists of texts without personal data (level `none`), so
its routes are unchanged. This is checked in `T-005-02`.

**Alternatives**: `high → restrict_to_local` (no leak of missed names, but the EU and
frontier models would see almost no conversational traffic); `critical → anonymize`
(would rely on detection recall for the most sensitive data).

## R-12 Leak metric for feature 007

**Decision**: a leak is a labelled entity value present in clear in the provider-bound
messages of a simulated request whose chosen target is outside the value's raw-allowed
residencies.

| Level of the entity's kind | Raw-allowed residencies (default policy) |
|---|---|
| `critical` | `local` |
| `high` | `local`, `eu` |
| `low`, `none` | any |

The rate is computed per kind: leaked labelled values of that kind divided by labelled
values of that kind. The simulator returns the provider-bound messages for `anonymize`,
and the original messages otherwise; that is what the scorer searches.

**Rationale**: SC-004 needs a definition that a scorer can compute from `/v1/simulate`
alone, with no real provider.

**Alternatives**: counting detector misses only (ignores routing); counting any value in
any provider payload (ignores residency, so every local request would "leak").
