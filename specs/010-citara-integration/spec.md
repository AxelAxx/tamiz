# Feature Specification: Citara Integration

**Feature Branch**: `010-citara-integration` (spec); implementation on
`T-010-02-citara-guide-and-client`

**Created**: 2026-10-31

**Status**: Draft (pending Alex's review)

**Input**: User description: "Optional integration of Citara (an independent application of
the same author) with Tamiz. Citara sends its LLM calls through Tamiz as an
OpenAI-compatible gateway: it points its OpenAI-compatible client at Tamiz's base URL with
a per-client Tamiz API key, and gets back the standard chat completion plus Tamiz's routing
and privacy headers and an audit entry per request. Deliverables: an integration guide and
a minimal example client against the OpenAI-compatible endpoint that runs against docker
compose and shows up in the audit log. The feature is optional and independent and never
blocks the roadmap."

**Backlog**: `T-010-01` (this spec, plan and tasks), `T-010-02` (guide, example client and
their tests) and `T-010-03` (recorded run against the full stack, US5). See `docs/tasks/BACKLOG.md`, section "Optional — Citara integration".

**Builds on** (consumes, never changes): `002-provider-routing` (chat completion endpoint,
API keys, model aliases), `003-resilience` (fallback, streaming), `005-privacy-aware-routing`
(privacy actions and headers), `006-audit-and-telemetry` (audit entry and admin audit API)
and the native tool calling addendum of `009-mcp-agent` (`T-009-05`).

## Purpose

Citara is another application by the same author that calls LLMs. Tamiz's foundational
document says only that the two projects are independent and that, optionally, "Citara
sends its LLM calls through Tamiz". The repository holds nothing else about Citara: not its
domain, its stack, how it calls models today or where it runs. This feature therefore
specifies the integration from Tamiz's side only, as a contract any OpenAI-compatible
application can follow, with Citara as the named first consumer:

1. **Point**: change the client's base URL to Tamiz and its key to a Tamiz client key;
   nothing else in the calling code changes.
2. **Read back**: the standard completion plus Tamiz's headers, which say where the request
   went, by which rule, whether personal data was found and what was done about it.
3. **Trace**: every request has exactly one audit entry that an operator can find by the
   request id the client saw (or chose), with no prompt content in it.

The deliverables are a written integration guide and a minimal, tested example client
inside this repository. Changes inside Citara's own code base are out of scope (see
Assumptions); the open questions about Citara are listed under "Decisions flagged for Alex"
at the end.

**Optional and independent.** No other feature depends on 010, and 010 changes no gateway
behaviour, contract, policy or privacy rule. If it is cut, nothing else is affected
(`CLAUDE.md` section 2).

## User Scenarios & Testing *(mandatory)*

Test setting, unless a scenario says otherwise: the example client runs against the
gateway's E2E harness (the real gateway application with the default policy, in-memory
audit log, a scripted detector that finds fixed synthetic markers, and scripted providers),
started by the test. Personal data in the scenarios is the harness's synthetic markers
(DNI `12345678Z`, person `Ana García`, phone `612345678`).

### User Story 1 - Citara gets completions through Tamiz by changing only the base URL and key (Priority: P1)

A Citara developer replaces the provider's base URL with Tamiz's and the provider key with
a Tamiz client key issued for Citara. Requests and responses keep the OpenAI shape, so the
calling code is unchanged; the developer can additionally read where each request went.

**Why this priority**: This is the integration. Without it nothing else in the feature has
a subject.

**Independent Test**: Run the example client with the harness's base URL and a client key;
check the printed answer, route, rule and request id.

**Acceptance Scenarios**:

1. **Given** a running gateway and a valid client key, **When** the example sends a
   non-streaming chat request with model `tamiz-auto`, **Then** it receives an
   OpenAI-shaped completion and reports the answer text, `x-request-id`, `x-tamiz-route`,
   `x-tamiz-rule`, `x-tamiz-sensitivity` and `x-tamiz-privacy` exactly as the gateway sent
   them.
2. **Given** the same setup, **When** the example sends the request with
   `stream: true`, **Then** it receives the answer as deltas followed by one usage chunk,
   reports the same Tamiz headers (available before the first delta), and the concatenated
   deltas equal the scripted answer.
3. **Given** the example is configured with model `tamiz-local`, **When** it sends a
   request, **Then** the reported route is `ollama-llama` and the rule `pinned-local`.
4. **Given** the example is configured with a correlation id of its own, **When** it sends
   a request, **Then** the gateway echoes that id in `x-request-id` and the example reports
   it.
5. **Given** a missing or wrong key, **When** the example sends a request, **Then** it
   exits with a non-zero status and reports error type `unauthorized`, and the key appears
   nowhere in its output.
6. **Given** a request whose provider fails and whose chain falls back, **When** the
   example sends it, **Then** it reports the `x-tamiz-fallback` header value next to the
   route that answered.

---

### User Story 2 - Personal data Citara sends is handled by Tamiz's policy, with no change in Citara (Priority: P1)

Citara may put personal data in prompts. Tamiz inspects every request and applies the
policy; the example shows the client-side view of each privacy action, so the guide can
state what Citara will observe.

**Why this priority**: Privacy is the reason to route Citara through Tamiz at all.

**Independent Test**: Send three requests (critical data, high data, data the policy
blocks) through the example and check headers, the answer the client gets and what the
scripted provider received.

**Acceptance Scenarios**:

1. **Given** a prompt containing the DNI marker, **When** the example sends it with model
   `tamiz-auto`, **Then** it reports sensitivity `critical`, privacy `restrict_to_local`
   and route `ollama-llama`, and no non-local scripted provider received any request.
2. **Given** a prompt containing the person and phone markers, **When** the example sends
   it, **Then** it reports privacy `anonymize;notice=v1`, the provider received
   placeholders instead of either value, and the answer the example prints contains the
   original values (restored by the gateway).
3. **Given** a request the default policy blocks (model `tamiz-frontier` with the person
   marker: the `anonymize` level allows only local and EU targets and the pinned route is
   US-only, so no target is left), **When** the example sends it, **Then** it exits
   non-zero, reports `policy_blocked` (451) as not retryable with privacy `block`, sends the
   request exactly once, and no scripted provider received any request.
4. **Given** the detector is unavailable and the policy's `onDetectorError` is
   `restrict_to_local` (default), **When** the example sends a request, **Then** the
   request is answered by the local route and the example reports the route and the
   sensitivity header as received.
5. **Given** the gateway answers `503` (`privacy_unavailable` or `provider_unavailable`),
   **When** the example receives it, **Then** it reports the error type, reports it as
   retryable and prints the `retry-after` value when present.

---

### User Story 3 - Every Citara request is in the audit log and can be found by its request id (Priority: P1)

An operator (Alex) wants to check, for any Citara request, what Tamiz decided, without
ever seeing the prompt.

**Why this priority**: The backlog's definition of done for `T-010-02` is "shows up in the
audit log".

**Independent Test**: Run the example with its audit check enabled and an admin key; check
it finds and prints its own entry.

**Acceptance Scenarios**:

1. **Given** a successful request by the example under client key `citara`, **When** the
   example's audit check looks it up with an admin key, **Then** it finds exactly one entry
   whose `requestId` equals the `x-request-id` it received, whose `clientId` is `citara`,
   and whose route, rule and sensitivity equal the headers it reported.
2. **Given** the blocked request of US2-3, **When** the audit check looks it up, **Then**
   it finds one entry with outcome `blocked` and block reason `no_target`.
3. **Given** the prompt contains a unique marker string, **When** the audit entry is
   printed in full, **Then** the marker appears 0 times in it and 0 times in the example's
   own output apart from the answer text.
4. **Given** no entry with the request id appears within the check's time limit, **When**
   the audit check ends, **Then** the example exits non-zero and says the entry was not
   found (never a false success).
5. **Given** the audit check is enabled with a client (non-admin) key, **When** it runs,
   **Then** the example reports `forbidden` (403) and exits non-zero without retrying.

---

### User Story 4 - The integration guide is accurate and complete (Priority: P2)

A Citara developer reads one page and can integrate without reading Tamiz's code: how to
get a key, which base URL and model names to use, what each header and error means, what to
retry, how streaming and tools behave, and what Tamiz stores.

**Why this priority**: The guide is the main deliverable for Citara; the example proves it.

**Independent Test**: Documentation tests compare the guide's tables with the gateway's
contracts and the example's configuration.

**Acceptance Scenarios**:

1. **Given** the guide's header table, **When** the documentation test compares it with
   the headers the gateway can set on `POST /v1/chat/completions`, **Then** both sets are
   equal.
2. **Given** the guide's error table, **When** the test compares it with the contract's
   error types and HTTP statuses, **Then** every error type the chat endpoint can answer is
   listed once with its status and a retry guidance of `never`, `after fixing the request`
   or `later`.
3. **Given** the guide's configuration table, **When** the test compares it with the
   example's configuration schema, **Then** every variable the example reads is listed and
   no listed variable is unknown to the example.
4. **Given** the guide's model table, **When** the test compares it with the default
   policy, **Then** every model alias the guide names (`tamiz-auto`, `tamiz-local`,
   `tamiz-frontier`) behaves as the guide says (the alias is matched by the rule the guide
   names, or by none for `tamiz-auto`).

---

### User Story 5 - The example runs against the full local stack (Priority: P3)

Alex runs the example against `docker compose up` with a real local model and sees the
request in the audit log.

**Why this priority**: It is the backlog's definition of done, but it needs the full stack
of `T-OPS-01`, which is not built yet. The automated stories above do not depend on it.

**Independent Test**: Manual, recorded run.

**Acceptance Scenarios**:

1. **Given** the compose stack is healthy and a client key `citara` and an admin key exist,
   **When** Alex runs the example with a DNI marker and the audit check enabled, **Then**
   the answer comes from `ollama-llama`, the audit check finds the entry, and the run's
   output is recorded in the `T-010-03` task record.

---

### Edge Cases

- **Client-side retries.** OpenAI SDKs retry some statuses by default. Tamiz already retries
  and falls back per its policy, so the guide and the example disable SDK retries for
  responses with a `policy_blocked`, `invalid_request`, `unauthorized` or `forbidden` type
  and keep at most one client retry for `503` honouring `retry-after` (US2-3, US2-5).
- **Client timeout shorter than Tamiz's deadline.** The guide states the policy's request
  deadline (60 s in the default policy) and the example's client timeout is above it, so the
  client does not abandon a request Tamiz is still falling back on.
- **Correlation id format.** A client id that does not match `[A-Za-z0-9_-]{1,128}` is
  replaced by a generated one; the example reports the id it got back, never the one it
  sent, as the audit key. The guide warns never to put personal data in the id.
- **Audit write timing.** The audit entry may be written just after the response; the audit
  check polls for a bounded time (US3-4).
- **Streaming abandoned by the client.** Closing a stream early yields an entry with outcome
  `cancelled`; the guide says so.
- **Tool calling.** Citara may declare functions; the guide points at the tool-calling
  contract (`T-009-05`) and states that tool results are inspected like messages. The
  example stays text-only (Assumptions).
- **Unknown model names.** A model name that no rule pins (for example `gpt-4o`) is routed
  as `tamiz-auto` is; the guide says the model field selects a route only through the
  aliases.

## Requirements *(mandatory)*

### Functional Requirements

**Integration contract (documented in the guide)**

- **FR-001**: The integration MUST need only a base URL and a Tamiz client key on Citara's
  side; requests and responses use the existing OpenAI-compatible endpoint unchanged.
- **FR-002**: The guide MUST describe how an operator issues a client key for Citara
  (database-backed or environment-backed) and that keys are per client, hashed at rest and
  revocable.
- **FR-003**: The guide MUST list every Tamiz response header of the chat endpoint with its
  meaning and possible values, every error type the endpoint can answer with its status and
  retry guidance, and the model aliases of the default policy (US4-1, US4-2, US4-4).
- **FR-004**: The guide MUST state what Tamiz stores per request (the audit entry fields)
  and what it never stores (prompt and answer content, tool arguments and results, the key).
- **FR-005**: The guide MUST give client settings for timeouts and retries consistent with
  the gateway's policy (Edge Cases).
- **FR-006**: The guide MUST describe streaming (headers before the first delta, usage chunk
  at the end, cancellation outcome) and point at the tool-calling contract.
- **FR-007**: The guide MUST state that PII detection is statistical, a defence layer with
  published metrics, not a guarantee, and link the eval results.

**Example client**

- **FR-008**: The repository MUST contain a minimal example client that uses an unmodified
  OpenAI client library against Tamiz, configured only through environment variables
  validated at start (base URL, client key, model, optional correlation id, optional stream
  flag, optional admin key and audit check).
- **FR-009**: The example MUST report, for every response, the answer and every Tamiz header
  received; for every error, the error type, status and whether it is retryable, and never
  the key (US1-5).
- **FR-010**: The example MUST NOT retry a request answered with a non-retryable error type,
  and MUST retry a `503` at most once after `retry-after` (US2-3, US2-5).
- **FR-011**: With the audit check enabled, the example MUST look up its entry through the
  admin audit API by the request id it received, poll for a bounded time, print the entry,
  and exit non-zero when it is not found or the key is not an admin key (US3-1 … US3-5).
- **FR-012**: The example MUST exit `0` only when the request was answered and, with the
  audit check enabled, the entry was found.

**Testing support**

- **FR-013**: The gateway's E2E harness MAY gain opt-in scripted providers (off by default,
  so existing dashboard tests are unchanged) that answer from a script and record what they
  received, so the example's tests can assert what a provider saw. This is test tooling
  only; no production code changes.
- **FR-014**: Documentation tests MUST keep the guide's header, error, configuration and
  model tables in sync with the contracts, the example and the default policy (US4).

**Independence**

- **FR-015**: This feature MUST NOT change the gateway's production code, the contracts, the
  default policy or the privacy service. If the integration reveals a gap (for example,
  an audit filter by request id), it becomes a new backlog row, not part of this feature.

### Key Entities

- **Integration client**: an application calling Tamiz with its own client key (Citara is
  the first). Identified in the audit log by its `clientId`.
- **Example run report**: what the example prints: answer, request id, Tamiz headers, error
  type and retryability, and the audit entry when the check is enabled. Never the key; never
  the prompt.
- **Integration guide**: `docs/integrations/citara.md`, the page a Citara developer reads.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Integrating needs changes to exactly two settings of an OpenAI-compatible
  client (base URL and key); the example's request code is the library's standard call.
- **SC-002**: In 100 % of the example's test runs, the request id it reports matches exactly
  one audit entry with the same route, rule and sensitivity it reported.
- **SC-003**: In the privacy scenarios, 0 critical values reach a non-local provider and 0
  anonymized values reach any provider in clear, while the client receives the restored
  answer.
- **SC-004**: A marker string placed in the prompt appears 0 times in audit entries and in
  the example's output other than the answer.
- **SC-005**: The guide's four tables have 0 differences from the contracts, the example's
  configuration and the default policy (documentation tests).
- **SC-006**: A developer new to Tamiz runs the example against the harness by following the
  guide's quick start in under 10 minutes (checked by Alex on review).

## Assumptions

- **Only Tamiz's side is in scope.** Changing Citara's own code (its client configuration,
  secrets, deployment) happens in Citara's repository, outside this feature and this
  backlog.
- **The example is TypeScript with the official OpenAI client library**, the most common
  OpenAI-compatible client and the same language as the rest of the repository; the guide
  adds a raw HTTP (`curl`) example so any stack can follow it. *(Decision D2, flagged.)*
- **Text-only example.** Tool calling works through Tamiz since `T-009-05` and is covered by
  its own tests; the example does not repeat them.
- **Default policy and aliases.** Citara uses `tamiz-auto` (policy decides) or
  `tamiz-local` (pinned local). No Citara-specific rule or alias is added. *(Decision D4.)*
- **No new eval.** The integration adds no AI behaviour: routing, detection, leak and
  quality are already gated by feature 007 on synthetic data. Constitution IV is met by the
  existing evals; a Citara-shaped dataset needs to know what Citara sends. *(Decision D5.)*
- **Audit lookup without a gateway change.** The admin audit API has no request-id filter;
  the example scans a narrow time window starting just before its request and matches the
  id client-side. *(Decision D6.)*
- **Full-stack run depends on `T-OPS-01`.** US5 is the only part that does. The backlog
  splits it into its own row, `T-010-03`, so `T-010-02` (guide, example, tests) does not
  wait for the full stack. *(Decision D7.)*

## Decisions flagged for Alex

The repository says nothing concrete about Citara. These are the unknowns and the default
taken for each; `research.md` gives the reasoning.

- **D1 — What Citara is.** Domain, users, and which personal data it handles (this decides
  which recognizers matter and whether a Citara-shaped eval set is worth adding). Default:
  treat Citara as a generic OpenAI-compatible client.
- **D2 — Citara's stack and how it calls LLMs today** (language, SDK, provider, streaming,
  tools). Default: TypeScript example with the official OpenAI library plus a `curl`
  example.
- **D3 — Where Citara runs relative to Tamiz** (same host or compose network, or remote over
  TLS). Default: the guide covers both; the example takes any base URL.
- **D4 — Whether Citara needs its own policy rule or alias** (for example "EU only").
  Default: none; `tamiz-auto` and `tamiz-local`.
- **D5 — No Citara-specific eval** until D1 is answered.
- **D6 — Audit lookup by request id**: client-side scan (no gateway change) versus a new
  optional backlog row adding a `requestId` filter to the admin audit API and the MCP tool.
  Default: client-side scan; the row is proposed, not added.
- **D7 — Dependency on `T-OPS-01`**: `T-010-02` runs before the full stack exists; the
  compose run becomes a new row `T-010-03` that depends on `T-OPS-01`. Default: yes.
