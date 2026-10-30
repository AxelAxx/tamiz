# Feature Specification: Privacy-Aware Routing

**Feature Branch**: `005-privacy-aware-routing`

**Created**: 2026-10-30

**Status**: Approved (reviewed by Alex on 2026-10-30)

**Input**: User description: "005-privacy-aware-routing: the gateway inspects every request
with the privacy service, derives its sensitivity level, and the routing policy turns that
level into a privacy action (`allow`, `anonymize`, `restrict_to_local`, `block`).
Anonymized requests reach the provider with placeholders and the answer is restored in
memory, also when streaming. A dry-run simulator shows what would happen. Detection results
are cached by content hash. Thresholds for the PII-leak eval: 0 % for critical entities,
< 2 % for names. Backlog T-005-02 … T-005-06."

**Backlog**: `T-005-01` (this spec), `T-005-02` … `T-005-06` (implementation). See
`docs/tasks/BACKLOG.md`, section "Day 6".

**Builds on**: `002-provider-routing` (policy, decision, endpoint), `003-resilience` (chain
execution, residency guard, streaming) and `004-privacy-service` (`/analyze`, sensitivity
levels, placeholder rules). **Feeds**: `006-audit-and-telemetry` (the audit entry records
the sensitivity, the entity kinds and the action), `007-evals-gate` (the PII-leak and
routing evals use the simulator), `008-dashboard` (the simulator screen) and `009-mcp-agent`
(`simulate_routing`).

## Purpose

This is the feature where Tamiz keeps its promise. Until now the gateway routes by task and
cost, and the privacy service can tell what personal data a text contains; nothing connects
the two. After this feature, every request is inspected before any provider sees it, and
the policy decides what may happen to it: go anywhere (`allow`), go out with its personal
data replaced by placeholders and come back restored (`anonymize`), stay on the local model
(`restrict_to_local`), or not be processed at all (`block`). If inspection cannot be done,
the gateway fails closed. A policy author can see, without calling any model, what the
gateway would do with a given text.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Sensitive requests are routed by what they contain (Priority: P1)

A clinic's application sends a chat completion that mentions a patient's DNI. The gateway
detects it, the policy says critical data stays local, and the answer comes from the local
model. A request with no personal data takes the usual cheapest route. The client sees in
the response headers what was decided.

**Why this priority**: It is the product's core promise (constitution V).

**Independent Test**: With a fake detector and fake providers, send requests whose detected
level is each of the four levels and check which target is called and which headers come
back.

**Acceptance Scenarios**:

1. **Given** the default policy and a request whose text contains a valid DNI, **When** it is
   processed, **Then** only a local target is called, and the response carries
   `x-tamiz-sensitivity: critical` and `x-tamiz-privacy: restrict_to_local`.
2. **Given** a request with no personal data, **When** it is processed, **Then** it follows
   the rule it matches exactly as in feature 003, with `x-tamiz-sensitivity: none` and
   `x-tamiz-privacy: allow`.
3. **Given** a policy whose action for `critical` is `block`, **When** a request with an
   IBAN is processed, **Then** no provider is called and the client receives a `451`
   `policy_blocked` error whose message names the level and the action, never the data.
4. **Given** a level whose action allows only some residencies (for example `[local, eu]`),
   **When** the matched rule's chain starts with a US target, **Then** the US targets are
   removed from the chain before execution and the first allowed target answers.
5. **Given** that removing disallowed targets leaves the chain empty, **When** the request
   is processed, **Then** it is blocked with `451` instead of being sent anywhere.
6. **Given** a `restrict_to_local` decision, **When** the local target fails, **Then** no
   fallback ever reaches a non-local target (feature 003 residency guard).

---

### User Story 2 - Anonymized requests reach the provider with placeholders and come back restored (Priority: P1)

A legal team's assistant sends a document with names and emails. The policy says this
level may go to an EU provider if anonymized. The provider receives `<PERSON_1>` and
`<EMAIL_1>` instead of the names and emails; the client receives the answer with the real
names put back. The mapping between placeholders and values lives only for the duration of
the request.

**Why this priority**: It is what lets non-local providers serve sensitive requests, and
the demo moment of the project.

**Independent Test**: With a fake detector and a fake provider that echoes what it
receives, check that the provider never sees an original value and that the client's
answer contains them restored.

**Acceptance Scenarios**:

1. **Given** an `anonymize` decision, **When** the request is sent, **Then** every detected
   value in every message (system, user and assistant) is replaced by its `<KIND_n>`
   placeholder, and the provider receives none of the original values.
2. **Given** the same value appearing in two messages, **When** it is anonymized, **Then**
   both occurrences get the same placeholder.
3. **Given** a provider answer that contains placeholders, **When** it is returned to the
   client, **Then** each placeholder is replaced by its original value; text that only
   resembles a placeholder but is not in the mapping is left untouched.
4. **Given** an `anonymize` decision, **When** the request is sent, **Then** a short,
   versioned instruction is added telling the model to keep placeholders verbatim, and the
   response reports which instruction version was used.
5. **Given** any request, **When** it completes or fails, **Then** the mapping and the
   original values appear in no log line, routing event, error, header or cache entry.
6. **Given** an `anonymize` decision, **When** the response is returned, **Then** the
   reported usage and cost are those of the anonymized exchange (what the provider billed).

---

### User Story 3 - If the gateway cannot inspect a request, it fails closed (Priority: P1)

The privacy service is down, slow, or answers something unexpected. The gateway does not
send the request to a provider as if it were clean: it applies the policy's failure action
(`restrict_to_local` or `block`), and says so.

**Why this priority**: A privacy layer that silently disappears when its dependency fails is
worse than none (constitution VI).

**Independent Test**: Make the fake detector fail in each way and check the action applied,
the headers and the routing events.

**Acceptance Scenarios**:

1. **Given** the privacy service is unreachable, **When** a request arrives, **Then** the
   policy's `onDetectorError` action is applied (default `restrict_to_local`), the response
   carries `x-tamiz-sensitivity: unknown`, and a `privacy.detector_failed` event is
   recorded with the reason.
2. **Given** the privacy service does not answer within its timeout (default 2 s), **When** a
   request arrives, **Then** the same happens, without waiting longer than the timeout.
3. **Given** the privacy service answers with a body that does not match its contract,
   **When** a request arrives, **Then** it is treated as a detector failure, never as "no
   personal data".
4. **Given** `onDetectorError: block`, **When** detection fails, **Then** the client
   receives `503` `privacy_unavailable` and no provider is called.
5. **Given** the gateway starts without a privacy service URL, **When** it boots, **Then** it
   refuses to start, naming the missing variable.

---

### User Story 4 - Streamed answers are restored without leaking placeholders or adding delay (Priority: P2)

A client streams the answer of an anonymized request. Placeholders in the provider's
stream may arrive split across chunks (`<PERS` + `ON_1>`). The client receives the real
values, never a broken placeholder, and text that is not part of a placeholder is not held
back longer than necessary.

**Why this priority**: Streaming is how chat products consume the gateway (feature 003);
anonymization must work there too.

**Independent Test**: Feed a fake provider stream with placeholders split at every possible
position and compare the concatenated client output with the restored full answer.

**Acceptance Scenarios**:

1. **Given** a placeholder split across two or more chunks, **When** it is streamed, **Then**
   the client receives the restored value once, in the right place.
2. **Given** a chunk that ends with text that cannot start a placeholder, **When** it is
   streamed, **Then** it is forwarded immediately.
3. **Given** a chunk that ends with a possible placeholder prefix (`<`, `<PER`), **When** the
   stream continues with text that completes no placeholder, **Then** the held text is
   released unchanged.
4. **Given** the stream ends while text is held, **When** it finishes, **Then** the held
   text is flushed before the final usage chunk.
5. **Given** any split of any restored answer into chunks, **When** it is streamed, **Then**
   the concatenation of what the client receives equals the non-streaming restoration of
   the same answer.

---

### User Story 5 - A policy author sees what would happen, without calling any model (Priority: P2)

Before deploying a policy, an operator pastes a text into the simulator (the dashboard in
feature 008, an MCP tool in feature 009, or the API directly). The gateway answers with the
entities it found (kinds and positions), the sensitivity level, the matched rule, the
privacy action, the resulting chain and the allowed residencies, and calls no provider.

**Why this priority**: It makes the policy explainable and testable; the PII-leak and
routing evals of feature 007 run through it.

**Independent Test**: Simulate texts of each level with fake providers that fail if called.

**Acceptance Scenarios**:

1. **Given** a text with a DNI, **When** it is simulated with the default policy, **Then**
   the answer shows a `DNI` finding with its message index and offsets, level `critical`,
   action `restrict_to_local`, and a chain of local targets only; no provider is called.
2. **Given** a text routed to `anonymize`, **When** it is simulated, **Then** the answer also
   includes the anonymized messages exactly as a provider would receive them (placeholders,
   no values).
3. **Given** a simulation, **When** its answer is returned, **Then** it contains no original
   values (positions only) and nothing is recorded as a real request.
4. **Given** a simulation request, **When** it lacks a valid API key, **Then** it is refused
   like any other gateway request.

---

### User Story 6 - The privacy section of the policy is explicit and checked at boot (Priority: P2)

A policy author declares, per sensitivity level, the action and, where relevant, the
residencies allowed; the local route used by `restrict_to_local`; and the action when
detection fails. The gateway refuses to start with a policy that would let critical data
reach a non-local, non-EU provider in clear.

**Why this priority**: The policy is the product's configuration surface; mistakes must be
caught before traffic flows (constitution VI).

**Independent Test**: Load policies with each kind of mistake and check the boot errors.

**Acceptance Scenarios**:

1. **Given** a policy without the `privacy` section, **When** the gateway boots, **Then** it
   exits naming the missing section.
2. **Given** a policy where `critical` is `allow` without residencies limited to `local` and
   `eu`, **When** the gateway boots, **Then** it exits naming the level and the rule
   violated.
3. **Given** a `localRoute` that names a non-local target, **When** the gateway boots,
   **Then** it exits naming the target.
4. **Given** the default and local-only policies shipped with the gateway, **When** they are
   loaded, **Then** they are valid and the routing dataset of feature 002 still scores at
   least 95 %.

---

### User Story 7 - Inspection is fast and cached without keeping content (Priority: P3)

A chat application resends the same conversation prefix many times. The gateway caches the
detection result by a hash of the inspected text, so repeated content does not cost another
call; the cache holds positions and kinds, never values or text.

**Why this priority**: Detection is on every request's critical path; caching makes it
cheap without weakening privacy.

**Independent Test**: Send the same request twice with a counting fake detector; inspect the
cache's stored entries.

**Acceptance Scenarios**:

1. **Given** a request whose inspected text was analyzed within the cache lifetime, **When**
   it arrives again, **Then** the privacy service is not called and the decision is the same.
2. **Given** the cache's contents, **When** they are inspected, **Then** they hold only a
   hash key, entity kinds, offsets, scores and the level; no text or values.
3. **Given** a change in the requested kinds or minimum score, **When** the same text
   arrives, **Then** it is a cache miss.
4. **Given** the cache reaches its size limit, **When** new entries arrive, **Then** the
   oldest are evicted, and memory stays bounded.

### Edge Cases

- **Multi-message requests**: all message contents are inspected together, so the level is
  the highest across messages and placeholders are consistent across them.
- **A finding that would cross a message boundary** (should not happen: messages are joined
  with a blank line, which no recognizer spans): treated as a detector failure (fail
  closed), never split silently.
- **The model alters a placeholder** (`<Person_1>`, `PERSON_1`, `<PERSON_1>'s`): exact
  placeholders are restored; altered ones are returned as the model wrote them. The
  versioned instruction reduces this; it is measured, not guaranteed.
- **The model invents a placeholder that is not in the mapping** (`<PERSON_9>`): left as is.
- **Original text already contains placeholder-shaped strings**: numbering skips them
  (feature 004 FR-015), so restoration is exact.
- **Very large requests**: inspection uses the same 1 MiB limit as the gateway; a request
  the gateway accepts is always inspectable.
- **Empty or whitespace-only messages**: inspected (trivially `none`).
- **Detector answers after the client disconnected**: the result is discarded; nothing is
  sent to a provider.
- **`restrict_to_local` with the local target's circuit open**: `503`
  `provider_unavailable` (feature 003), never a non-local fallback.
- **Streaming + `block`**: the client receives the JSON error before any stream starts.
- **Simulating with a policy that blocks**: the answer shows `block` and an empty chain.

## Requirements *(mandatory)*

### Functional Requirements

Domain: sensitivity and privacy actions (backlog `T-005-02`):

- **FR-001**: The gateway's sensitivity MUST be one of `unknown`, `none`, `low`, `high`,
  `critical`, the last four with the same meaning as the privacy service's levels;
  `unknown` means detection failed.
- **FR-002**: The routing policy MUST have a `privacy` section declaring, for each of `none`,
  `low`, `high` and `critical`, an action (`allow`, `anonymize`, `restrict_to_local`,
  `block`) and optionally the residencies allowed for that level; a `localRoute` of local
  targets; and an `onDetectorError` action (`restrict_to_local` or `block`).
- **FR-003**: The decision MUST combine the rule match of feature 002 with the level's
  action: `allow` and `anonymize` keep the rule's chain filtered to the intersection of the
  rule's and the level's residencies; `restrict_to_local` uses `localRoute` and allows only
  `local`; `block` yields no chain. An empty chain after filtering MUST become `block`.
- **FR-004**: Policy validation MUST reject a missing `privacy` section, a `localRoute` with
  non-local targets, and any policy where `critical` is `allow` without residencies limited
  to `local` and `eu`.
- **FR-005**: The decision MUST stay pure and total; property tests MUST show that a
  `critical` request never gets a non-local, non-EU target unless its action is
  `anonymize`, and that `block` never has a target.

Detector port and adapter (backlog `T-005-03`):

- **FR-006**: A `PiiDetectorPort` MUST return, for the request's messages, the findings
  (message index, kind, offsets, score) and the level, or a typed failure (`unavailable`,
  `timeout`, `contract`).
- **FR-007**: The HTTP adapter MUST call the privacy service's `/analyze` once per request
  over all message contents joined by a blank line, validate the answer against a Zod mirror
  of `services/privacy/openapi.json` kept in `packages/contracts`, convert offsets to the
  gateway's string indexing, and map them back to messages.
- **FR-008**: Detection MUST time out after a configurable limit (default 2 000 ms) through
  the clock port, and MUST run concurrently with task classification.
- **FR-009**: Detection results MUST be cached in memory by a SHA-256 hash of the inspected
  text and the detection options, holding only kinds, offsets, scores and the level, with a
  size limit and a time limit (defaults 1 000 entries, 10 minutes).
- **FR-010**: A contract test MUST fail when `services/privacy/openapi.json` and the Zod
  mirror disagree.

Non-streaming wiring (backlog `T-005-04`):

- **FR-011**: `RouteInference` MUST inspect every request before deciding, apply the action,
  and never call a provider for `block` or for a detector failure with `onDetectorError:
  block`.
- **FR-012**: For `anonymize`, the gateway MUST replace findings with placeholders using the
  same rules as the privacy service (feature 004 FR-014, FR-015), verified by shared test
  vectors; add the versioned placeholder instruction; and restore the provider's answer in
  one pass over the mapping.
- **FR-013**: The mapping MUST live only in the request's scope: never in logs, events,
  errors, headers, caches or any store.
- **FR-014**: Responses MUST carry `x-tamiz-sensitivity` and `x-tamiz-privacy` (the
  action); blocked requests MUST return `451` `policy_blocked`; detector failures with
  `block` MUST return `503` `privacy_unavailable`; error messages MUST contain levels,
  actions and rule ids only.
- **FR-015**: Each privacy step MUST be a routing event (`privacy.inspected`,
  `privacy.detector_failed`, `privacy.action`, `privacy.anonymized` with counts), with no
  content.

Streaming (backlog `T-005-05`):

- **FR-016**: `StreamInference` MUST apply the same inspection and actions before the stream
  starts, and restore placeholders in the streamed text with a buffer that holds back only a
  possible placeholder prefix, bounded by the longest placeholder.
- **FR-017**: The buffer MUST be flushed before the final usage chunk and on stream errors,
  and the concatenated output MUST equal the non-streaming restoration for any chunking.

Simulator (backlog `T-005-06`):

- **FR-018**: `POST /v1/simulate` MUST accept the chat completion request body, run
  classification, inspection and the decision, and return the findings (message index,
  kind, offsets, score), level, matched rule, action, chain (target ids and residencies),
  allowed residencies, and, for `anonymize`, the anonymized messages; it MUST call no
  provider and require an API key.
- **FR-019**: The simulator's request and response MUST be Zod schemas in
  `packages/contracts` and appear in the gateway's OpenAPI document.

Policy files:

- **FR-020**: The shipped `default.yaml` and `local-only.yaml` MUST gain a `privacy` section
  (default: `none` and `low` → `allow`; `high` → `anonymize` limited to `local` and `eu`;
  `critical` → `restrict_to_local`; `onDetectorError: restrict_to_local`), and the policy
  version MUST increase.

### Key Entities

- **SensitivityLevel**: `unknown`, `none`, `low`, `high`, `critical`.
- **DetectedEntity**: message index, kind, start, end, score; never the value.
- **Inspection**: the detected entities and the level of a request, or a detector failure.
- **PrivacyAction**: `allow`, `anonymize`, `restrict_to_local`, `block`.
- **PrivacyPolicy**: per-level action and residencies, `localRoute`, `onDetectorError`.
- **RoutingDecision** (extended): level, action, chain after privacy filtering, allowed
  residencies, and the reason when blocked.
- **AnonymizationSession**: the request-scoped placeholder mapping and the restore function.
- **SimulationResult**: inspection plus decision plus, for `anonymize`, the anonymized
  messages.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Over at least 10 000 generated requests (property tests), a `critical` request
  is never sent in clear to a target outside `local` and `eu`, and a `block` decision never
  calls a provider.
- **SC-002**: In 100 % of anonymized requests in the test suite, no detected value reaches a
  fake provider, and the client's answer equals the provider's answer with the mapping
  applied.
- **SC-003**: For every split of the test answers into chunks (all positions, up to 3
  splits), the streamed restoration equals the non-streaming restoration.
- **SC-004**: The PII-leak eval of feature 007, run through the simulator with the default
  policy, leaks 0 % of critical entities (DNI, NIE, NSS, IBAN, card) and less than 2 % of
  names, where a leak is a labelled value present in clear in what a target outside that
  value's allowed residencies would receive. This feature defines the metric and the
  default policy; feature 007 gates it.
- **SC-005**: Inspection adds less than 30 ms at the 95th percentile on a cache hit and less
  than the detector's own latency plus 10 ms on a miss, measured in-process with fakes.
- **SC-006**: 0 occurrences of test values or mappings in the logs, events, errors, headers
  and cache captured during the gateway test suite.
- **SC-007**: When detection fails, 100 % of requests get the `onDetectorError` action; none
  is routed as if it had no personal data.
- **SC-008**: 100 % of the acceptance scenarios have a matching automated test.

## Assumptions

- **The gateway anonymizes from `/analyze` results** instead of calling `/anonymize`. That
  way the cache holds only positions, never values (FR-009). The placeholder rules are
  implemented twice (Python and TypeScript) and kept identical by shared test vectors
  (`specs/004-privacy-service/contracts/anonymize.example.json` plus new vectors). The
  service's `/anonymize` remains for other clients.
- **`block` returns `451` `policy_blocked`**, reusing feature 003's error, rather than the
  `422` the backlog row of `T-005-04` mentions. `451` already means "refused by policy" in
  this API, and `422` would collide with request validation.
- **Fail closed by default** (`onDetectorError: restrict_to_local`). `allow` is not an
  accepted value for `onDetectorError`.
- **One detection call per request** over all messages joined by a blank line. Tool calls,
  images and other non-text content are out of scope; feature 002's contract accepts text
  messages only.
- **The placeholder instruction** is a versioned file (`prompts/anonymization-notice.v1.md`),
  added as a system message only for `anonymize`. Its effect on answer quality is measured
  by feature 007's quality eval.
- **`low` sensitivity** (location, CIF) is `allow` by default: blocking or localising every
  mention of a city would make the gateway useless for ordinary traffic.
- **Names are statistical.** The < 2 % name-leak threshold depends on detection recall
  (0.917 on corpus v1). With the default policy a missed name in a request that has no other
  finding is `none` → `allow`, so the threshold may need the `high` action or the corpus to
  improve. Feature 007 measures it; this spec does not claim it is met.
- **Simulation is not audited as a request**: feature 006 records simulations separately,
  if at all.
- **The cache lives in process memory** (one instance). Sharing it through Valkey would put
  derived data outside the process; it is not done.
