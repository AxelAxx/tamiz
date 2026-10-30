# Feature Specification: Resilience

**Feature Branch**: `003-resilience`

**Created**: 2026-10-30

**Status**: Approved (reviewed by Alex, 2026-10-30)

**Input**: User description: "003-resilience: timeouts, retry with exponential backoff
and jitter, per-target circuit breaker (closed/open/half-open) with a circuit state port,
execution of the decided fallback chain with a residency guard that blocks instead of
degrading, observable fallback events and the `x-tamiz-fallback` header, and streaming
(`stream: true`, OpenAI-compatible server-sent events) with fallback only before the
first token. Backlog T-003-02 … T-003-06."

**Backlog**: `T-003-01` (this spec), `T-003-02` … `T-003-06` (implementation). See
`docs/tasks/BACKLOG.md`, sections "Day 4" and "Day 7" (`T-003-06`).

**Builds on**: `specs/002-provider-routing/`, as merged on `main` (2026-10-30). That
feature already provides the routing decision with its ordered fallback chain, the
effective timeout (rule, then target, then policy), typed `ProviderError`s with a
`retryable` flag, the four provider adapters (no library retries, explicit abort on
timeout), the non-streaming endpoint with `x-tamiz-route` / `x-tamiz-rule`, cost per
request, the policy file and its boot validation. This feature **extends** those
definitions (new policy fields, new error types, new response header, a streaming
contract) and never redefines them.

## Purpose

In feature 002 Tamiz picks a route and calls only its first target: when that provider
is slow, rate-limited or down, the client gets an error, although the decision already
names other targets that could have answered. This feature makes the gateway resilient:
each call is bounded in time, transient failures are retried with backoff, targets that
keep failing are temporarily taken out of rotation by a circuit breaker, and the rest of
the chain is tried in order. Every one of those steps is visible, both to the client (a
response header) and to operators (an event per step). One rule overrides availability:
a fallback never moves a request to a place the policy does not allow its data to go. If
the next target would break the allowed residency, the request fails instead of
degrading.

The same guarantees cover streaming: a client may ask for the answer as a stream of
tokens. Falling back is possible only until the first token has been sent; after that,
a failure ends the stream with a typed error event, never with a silent switch to a
different model mid-answer.

Resilience is the core of the project and is written in the project, not imported: the
retry, timeout and breaker logic are small, composable, tested functions over the clock
port, so that every behaviour in this spec is testable without real waiting.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A request survives the failure of its primary target (Priority: P1)

A client sends a chat completion. The first target of the decided chain fails (it times
out, returns a server error, or is rate-limited). Instead of passing the error on, the
gateway tries the next target of the chain and the client gets a normal answer. The
response says which target finally answered and which ones failed before it, so the
client and the operator can see that a fallback happened.

**Why this priority**: It is the visible value of the feature: a provider outage stops
being a client outage. Every other story refines when and how the chain advances.

**Independent Test**: With scripted providers, make the first target of the default
chain fail and the second succeed; assert a 200, the second target in `x-tamiz-route`
and the first in `x-tamiz-fallback`.

**Acceptance Scenarios**:

1. **Given** a chain of two targets whose first fails with a retryable error on every
   attempt and whose second succeeds, **When** a request is sent, **Then** the response
   is 200 with the second target's answer, `x-tamiz-route` names the second target and
   `x-tamiz-fallback` names the first target and the reason it was left.
2. **Given** a chain whose first target fails with a non-retryable error (credential
   rejected, request rejected, malformed body), **When** a request is sent, **Then**
   that target is not retried, the next target is tried, and the reason appears in
   `x-tamiz-fallback`.
3. **Given** a chain whose first target succeeds, **When** a request is sent, **Then**
   no fallback happens and the response carries no `x-tamiz-fallback` header.
4. **Given** a chain whose every target fails, **When** a request is sent, **Then** the
   client receives a provider error: 504 `provider_timeout` if the last failure was a
   timeout, 502 `provider_error` otherwise. `x-tamiz-route` names the last target that
   was tried and `x-tamiz-fallback` names every earlier one, in order.
5. **Given** a fallback that produced the answer, **When** the response is built,
   **Then** the cost and the reported model are those of the target that answered.

---

### User Story 2 - A fallback never sends data where the policy does not allow it (Priority: P1)

An operator states, for a rule (or for the default chain), where the data of the
requests it matches may be processed: for example only on the local model server and in
the EU. Every target of the chain is checked against that statement before it is
called. If the gateway reaches a target that is not allowed (because a later feature
narrows the allowed places per request, or because the chain was built for a wider
statement), it stops and returns a blocking error. It never "degrades" to a less
private location to save the request.

**Why this priority**: It is the project's privacy promise (constitution V and VI) in
the place where availability pressure is highest. A resilient gateway that leaks data
under load is worse than one that fails.

**Independent Test**: Give a decision whose allowed residencies exclude the second
target, make the first fail, and assert a blocking error, no call to the second target,
and a residency event.

**Acceptance Scenarios**:

1. **Given** a decision that allows `local` and `eu` and a chain `eu-target → us-target`
   whose first target fails, **When** the chain advances, **Then** the `us-target` is
   not called, the client receives 451 `policy_blocked` naming the residency rule (not
   the data), and a residency event is emitted.
2. **Given** a decision whose first target is itself outside the allowed residencies,
   **When** the request is executed, **Then** no provider is called and the client
   receives 451 `policy_blocked`.
3. **Given** a policy file in which a rule declares allowed residencies and lists a
   target outside them in its own chain, **When** the gateway starts, **Then** it
   refuses to boot naming the rule, the target and its residency (a contradiction in
   configuration is a boot error, not a runtime surprise).
4. **Given** a rule without a residency statement, **When** its chain is executed,
   **Then** every residency is allowed (the behaviour of feature 002 is kept) and the
   fallback events still record each target's residency.

---

### User Story 3 - Transient failures are retried with backoff, permanent ones are not (Priority: P1)

A provider answers 503 once and then recovers. The gateway retries the same target
after a short, growing, randomised wait instead of moving to a more expensive or less
preferred target at the first hiccup. A provider that rejects the credential is not
retried: retrying cannot help.

**Why this priority**: Without retries every blip becomes a fallback, which costs money
(frontier targets are later in cheap chains) and hides flapping providers.

**Independent Test**: With the fake clock and a script that fails once with a retryable
error and then succeeds, assert two calls to the same target, the waited delay inside
the configured bounds, and no fallback.

**Acceptance Scenarios**:

1. **Given** a target that fails once with a retryable error and then succeeds, **When**
   a request is executed, **Then** the same target is called twice, the response comes
   from it and no fallback is reported.
2. **Given** a retryable failure on every attempt, **When** a request is executed,
   **Then** the target is called exactly the configured maximum number of attempts and
   then the chain advances.
3. **Given** a non-retryable failure, **When** a request is executed, **Then** the
   target is called exactly once.
4. **Given** the retry settings (base delay, maximum delay, maximum attempts), **When**
   the waits between attempts are observed with the fake clock, **Then** each wait is
   within `[0, min(maxDelay, base × 2^(attempt-1))]` (exponential backoff with full
   jitter), drawn from an injected random source so that tests are deterministic.
5. **Given** a request deadline that would be exceeded by the next wait or attempt,
   **When** the executor considers retrying or advancing, **Then** it stops and returns
   504 `provider_timeout` instead of starting work it cannot finish.

---

### User Story 4 - A target that keeps failing is taken out of rotation for a while (Priority: P1)

A provider is down. After a few consecutive failures the gateway stops calling it for a
cool-down period and goes straight to the next target, so clients do not each wait for
a timeout. After the cool-down, one trial request is let through; if it succeeds the
target is back in rotation, if it fails the cool-down starts again.

**Why this priority**: Retries alone make an outage slower for everyone; the breaker is
what keeps latency bounded during an outage. It also gives operators (and the MCP tool
`get_provider_health` of feature 009) a clear health signal per target.

**Independent Test**: Drive one target through closed → open → half-open → closed and
→ open again with the fake clock and scripted failures; assert the calls the target
received in each state.

**Acceptance Scenarios**:

1. **Given** a closed circuit and the configured number of consecutive counted failures
   on a target, **When** the threshold is reached, **Then** the circuit opens and a
   state-change event is emitted.
2. **Given** an open circuit, **When** a request's chain reaches that target before the
   cool-down has elapsed, **Then** the target is not called, it is skipped with reason
   `circuit_open` (listed in `x-tamiz-fallback`) and the next target is tried.
3. **Given** an open circuit whose cool-down has elapsed, **When** a request reaches the
   target, **Then** exactly one trial call is allowed (half-open); concurrent requests
   meanwhile skip the target as if open.
4. **Given** a half-open circuit, **When** the trial succeeds, **Then** the circuit
   closes and the failure count resets; **When** it fails, **Then** the circuit opens
   again for a full cool-down.
5. **Given** two targets, **When** one target's circuit opens, **Then** the other's
   state is unaffected (per-target isolation).
6. **Given** a failure that says nothing about the provider's health (credential or
   request rejected), **When** it happens, **Then** it does not count towards opening
   the circuit.
7. **Given** a chain in which every target is skipped because its circuit is open,
   **When** a request is sent, **Then** no provider is called and the client receives
   503 `provider_unavailable` with a `retry-after` header equal to the shortest
   remaining cool-down, in whole seconds rounded up.

---

### User Story 5 - Every resilience step is observable, without content (Priority: P1)

An operator wants to know, after the fact, that a request was retried twice on one
provider, skipped another whose circuit was open, and was answered by a third; and when
a circuit opened and closed. Each of those steps produces a structured event with the
request identifier, the target, the step, the reason and the timing, but never the
prompt or the answer.

**Why this priority**: Constitution VI: "every fallback is an observable event". Feature
006 turns the same events into trace events, metrics and audit entries; this feature
defines them and emits them through a port so that 006 only adds a sink.

**Independent Test**: Record events with an in-memory sink while driving the scenarios
of stories 1, 3 and 4; assert the sequence and that no event contains message content.

**Acceptance Scenarios**:

1. **Given** any request, **When** it is executed, **Then** each attempt, retry wait,
   fallback step, skipped target, residency block and circuit state change is emitted
   as one event, in order, with the request identifier.
2. **Given** a request that fell back, **When** the response is sent, **Then** the
   `x-tamiz-fallback` header lists the abandoned targets in order as `target:reason`
   pairs, and the events contain the same information.
3. **Given** the captured events and log output of the whole test suite, **When** they
   are searched for message content and credentials, **Then** none is found.
4. **Given** no explicit sink, **When** the gateway runs, **Then** events are written as
   structured log lines through the existing redacting logger.

---

### User Story 6 - A client receives the answer as a stream, with fallback before the first token (Priority: P2)

A chat interface asks for `stream: true` and renders tokens as they arrive, in the
OpenAI streaming format it already parses. If the primary target fails before sending
anything, the gateway falls back exactly as for a normal request and the client never
notices. Once tokens have been sent, switching models would produce an answer stitched
from two models; instead, a failure ends the stream with a typed error event.

**Why this priority**: Streaming is what interactive clients use; the backlog places it
after the non-streaming resilience it reuses.

**Independent Test**: With mocked provider endpoints, stream a successful answer and
assert the chunk sequence; fail the primary before its first chunk and assert the
fallback target's stream; fail after two chunks and assert the error event and the end
of the stream.

**Acceptance Scenarios**:

1. **Given** a request with `stream: true`, **When** the primary succeeds, **Then** the
   client receives an event stream of chat completion chunks in the OpenAI format: a
   first chunk with the assistant role, content deltas, a final chunk with the finish
   reason, a usage chunk with token counts and cost, and the `[DONE]` terminator.
2. **Given** a streaming request, **When** the response starts, **Then** it carries the
   same routing headers as a non-streaming response (`x-tamiz-route`, `x-tamiz-rule`,
   `x-request-id`, and `x-tamiz-fallback` when a fallback happened before the first
   token), because the headers are sent only once the first token is available.
3. **Given** a primary that fails (error or timeout) before its first token, **When** a
   streaming request is executed, **Then** retry, breaker, residency and fallback rules
   apply exactly as in stories 1–4 and the client receives the fallback target's stream.
4. **Given** a target that fails after at least one content chunk was sent, **When**
   the failure happens, **Then** the gateway sends one error event with a typed error
   (type and message, no stack trace, no upstream body), does not send `[DONE]`, closes
   the stream, does not fall back, and emits an event.
5. **Given** a streaming target that stops sending for longer than the effective
   timeout, before the first token or between chunks, **When** the timeout elapses,
   **Then** it is treated as a timeout failure (before the first token: fallback rules;
   after: error event).
6. **Given** a client that disconnects during a stream, **When** the disconnect is
   detected, **Then** the upstream call is aborted and no further chunks are requested.
7. **Given** a streaming request that fails before the first token on every target,
   **When** the chain is exhausted, **Then** the client receives the same JSON error
   response and status as a non-streaming request (no event stream is started).

---

### User Story 7 - Circuit state is shared between gateway instances (Priority: P3)

The gateway runs as two instances behind a load balancer. When one instance opens the
circuit of a failing provider, the other stops calling it too, instead of each instance
learning the outage separately. If the shared store is unavailable, each instance keeps
working with its own in-memory state and says so in its log.

**Why this priority**: Needed for a real deployment, not for a single-instance demo; the
backlog places it on day 7, with the rest of the infrastructure.

**Independent Test**: With a real key-value store in a container, open a circuit
through one breaker instance and assert the other observes it; stop the store and
assert both keep serving with in-memory state and a logged warning.

**Acceptance Scenarios**:

1. **Given** two breaker instances on the same shared store, **When** one opens a
   target's circuit, **Then** the other treats the target as open within one second.
2. **Given** an open circuit in the shared store, **When** the cool-down elapses,
   **Then** the stored open state expires by itself (no instance has to clean it up).
3. **Given** the shared store is unreachable at boot or later, **When** the breaker
   needs state, **Then** it uses in-memory state, logs one warning per transition
   between shared and local mode, and requests are not failed because of the store.

### Edge Cases

- **A chain of one target** (for example the local-only policy): retries and the
  breaker apply; when it fails or is open there is nothing to fall back to, and the
  errors of story 1 scenario 4 or story 4 scenario 7 are returned.
- **The same provider appears twice in a chain with two targets** (two models of one
  provider): circuits are per target, not per provider; one model's outage does not
  skip the other.
- **Retryable failure on the last attempt of the last target**: no wait is started
  after the final attempt; the error is returned at once.
- **Upstream asks the client to slow down with a retry-after hint**: honoured as a
  lower bound for the next wait on that target, capped by the maximum delay and the
  request deadline.
- **A half-open trial is in flight and the request deadline of the trial request
  expires**: the trial counts as a failure for the circuit.
- **Client disconnects before the first token** of a streaming request: the upstream
  call is aborted; no fallback is started for a client that is gone.
- **Provider stream ends without a finish reason** (connection closed cleanly): treated
  as a failure after the first token (error event), never as a successful completion.
- **Streaming provider does not report usage**: usage is estimated from the text sent,
  flagged as estimated, and the cost is computed, as for non-streaming requests.
- **Rate limit (429)**: retryable, but counts towards the circuit only when it repeats
  past the threshold like any other counted failure; the operator sees `rate_limited`
  as the reason.
- **Clock jumps backwards** (system time adjusted): durations come from the clock port;
  cool-downs never become negative and a circuit is never stuck open.
- **Policy without a `resilience` section**: defaults apply (see Assumptions); existing
  policy files stay valid.
- **Several gateway instances with different breaker settings**: each instance applies
  its own threshold and cool-down to the shared state; operators are expected to deploy
  the same policy everywhere.

## Requirements *(mandatory)*

### Functional Requirements

Timeout and retry policies (backlog `T-003-02`):

- **FR-001**: Every provider attempt MUST be bounded by the effective timeout of feature
  002 (rule, then target, then policy default), further capped by the time left before
  the request deadline.
- **FR-002**: A request deadline MUST bound the whole execution of a request (all
  attempts, waits and fallbacks); its default and its override are part of the policy's
  resilience settings. When it is exceeded, the request fails with `provider_timeout`.
- **FR-003**: Retries MUST apply only to failures marked retryable (rate limited, server
  error, network failure, timeout); non-retryable failures MUST NOT be retried on the
  same target.
- **FR-004**: The wait before retry `n` (n ≥ 1) MUST be drawn uniformly from
  `[0, min(maxDelay, base × 2^(n-1))]` using an injected random source, raised to an
  upstream retry-after hint when one exists, and never longer than the time left before
  the deadline.
- **FR-005**: Timeout and retry MUST be composable functions over the clock port (no
  direct timers or system time), so that tests run without real waiting.

Circuit breaker (backlog `T-003-03`):

- **FR-006**: Each target MUST have its own circuit with the states closed, open and
  half-open, persisted through a circuit-state port.
- **FR-007**: A closed circuit MUST open after the configured number of consecutive
  counted failures; counted failures are those marked retryable. A success MUST reset
  the count.
- **FR-008**: An open circuit MUST skip its target without calling it until the
  configured cool-down has elapsed, then allow exactly one trial call (half-open); the
  trial's success MUST close the circuit, its failure MUST reopen it for a full
  cool-down.
- **FR-009**: Every circuit state change MUST emit an event with the target, the old
  and new states and the reason.
- **FR-010**: An in-memory circuit-state adapter MUST exist for single-instance
  deployments and tests.

Fallback chain execution and residency guard (backlog `T-003-04`):

- **FR-011**: The executor MUST try the decided chain in order, applying per target:
  residency check → circuit check → attempts with timeout and retry → circuit update;
  it MUST advance to the next target after any final failure or skip of the current one.
- **FR-012**: A rule and the default chain MAY declare the residencies their requests'
  data may be processed in; the routing decision MUST carry the allowed set (every
  residency when none is declared). Feature 005 narrows this set per request; this
  feature only enforces it.
- **FR-013**: The executor MUST NOT call a target whose residency is outside the
  decision's allowed set. Reaching such a target (first or later) MUST stop execution
  with a residency violation, reported as 451 `policy_blocked`, whose message names the
  rule and the target's residency and never request content.
- **FR-014**: Policy validation MUST reject, at boot, a rule or default chain that
  declares allowed residencies and lists a target outside them, naming the path.
- **FR-015**: When every target fails, the client MUST receive 504 `provider_timeout` if
  the last failure was a timeout or the deadline was reached, and 502 `provider_error`
  otherwise; when every target was skipped because its circuit was open, the client
  MUST receive 503 `provider_unavailable` with `retry-after`.
- **FR-016**: Responses MUST carry `x-tamiz-route` naming the target that answered or,
  on failure, the last target tried; and, only when at least one target was abandoned,
  `x-tamiz-fallback` listing the abandoned targets in order as `targetId:reason` with
  reason in the closed list `rate_limited`, `http_error`, `timeout`, `network`,
  `malformed_response`, `authentication`, `circuit_open`.
- **FR-017**: Each attempt, retry wait, fallback step, skip and residency block MUST be
  emitted as an event through a routing-events port, with request identifier, target,
  provider, residency, step, reason, attempt number and duration, and never message
  content, credentials or upstream bodies.
- **FR-018**: The default sink of the routing-events port MUST write one structured log
  line per event through the existing redacting logger; feature 006 adds the trace,
  metric and audit sinks.
- **FR-019**: The error type list of the contract MUST be extended with
  `provider_unavailable` (503); `policy_blocked` (451) and `provider_timeout` (504) are
  reused.
- **FR-020**: The policy file MUST accept an optional `resilience` section (request
  deadline, maximum attempts per target, base and maximum backoff delay, failure
  threshold and cool-down of the breaker) and optional `residency` lists on rules and on
  the default chain; files without them stay valid and get documented defaults.

Streaming (backlog `T-003-05`):

- **FR-021**: The request contract MUST accept `stream: true`; such requests MUST be
  answered as a server-sent event stream of chat completion chunks compatible with the
  OpenAI streaming format, ending with `[DONE]` on success.
- **FR-022**: The streaming response MUST start only when the first content token of
  the answering target is available, and its headers MUST be those of FR-016 plus
  `x-tamiz-rule` and `x-request-id`.
- **FR-023**: Before the first token, the rules of FR-001 … FR-016 MUST apply unchanged;
  when the chain is exhausted before any token, the client MUST receive the JSON error
  response of FR-015.
- **FR-024**: After the first token, a failure MUST end the stream with one error event
  carrying a typed error (contract error envelope), without `[DONE]`, without fallback,
  and MUST count as a failure for the circuit.
- **FR-025**: The effective timeout MUST bound both the wait for the first token and
  each gap between chunks.
- **FR-026**: The last chunk before `[DONE]` MUST carry usage with token counts,
  `cost_usd` and `estimated`, with the estimation rules of feature 002.
- **FR-027**: A client disconnect MUST abort the upstream call.
- **FR-028**: The provider port MUST offer a streaming operation implemented by the four
  adapters with the same error mapping as the non-streaming one.

Shared circuit state (backlog `T-003-06`):

- **FR-029**: A circuit-state adapter over the key-value store (Redis/Valkey) MUST share
  state between gateway instances, store open states with an expiry equal to the
  cool-down, and keep the half-open single-trial guarantee across instances.
- **FR-030**: When the store is unreachable, the adapter MUST fall back to in-memory
  state, log one warning when it switches mode (and one when it recovers), and never
  fail a request because of the store.
- **FR-031**: The local stack definition MUST gain the key-value store, and the example
  environment MUST document its connection setting; without that setting the gateway
  uses in-memory state.

### Key Entities

- **ResilienceSettings**: the policy's request deadline, maximum attempts, backoff base
  and cap, breaker failure threshold and cool-down (FR-002, FR-020).
- **AllowedResidencies**: the set of residencies a decision may use, from the matched
  rule or default chain (FR-012); narrowed by feature 005.
- **CircuitState**: per target: state, consecutive counted failures, opened-at time and
  whether a half-open trial is in flight (FR-006 … FR-008).
- **ExecutionOutcome**: the answering target or the final failure, plus the ordered
  list of abandoned targets with reasons (FR-015, FR-016).
- **RoutingEvent**: one observable step of an execution, without content (FR-017).
- **ResidencyViolation**: a new domain error variant naming rule, target and residency
  (FR-013).
- **ChatCompletionChunk**: one streaming chunk in the OpenAI format, plus the usage
  chunk and the error event (FR-021, FR-024, FR-026).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: With the primary target failing on 100 % of calls and a healthy, allowed
  second target, 100 % of requests in the scenario suite are answered (200), and once
  the primary's circuit is open, the primary receives 0 calls until its cool-down ends.
- **SC-002**: Over at least 1 000 generated chains, residency sets and failure scripts,
  0 calls reach a target outside the allowed residencies (property test).
- **SC-003**: Over the same generated runs, 0 non-retryable failures are retried, the
  number of attempts per target never exceeds the configured maximum, and every wait is
  within its backoff bound.
- **SC-004**: 100 % of fallbacks, skips and residency blocks in the scenario suite
  produce both the matching `x-tamiz-fallback` entry and the matching event; 0 events or
  log lines contain message content or credentials.
- **SC-005**: When every target is healthy, the resilience layer adds under 2 ms per
  request (p95, in-process, fake providers) over the feature 002 path.
- **SC-006**: The resilience unit and property suites complete without any real waiting
  (fake clock only), in under 10 seconds.
- **SC-007**: Streaming: in the scenario suite, the first chunk reaches the client
  within 20 ms (p95, in-process) of the provider emitting it, and 100 % of mid-stream
  failures end with exactly one error event and no `[DONE]`.
- **SC-008**: With two instances on a shared store, a circuit opened by one is observed
  as open by the other within 1 second in 100 % of runs of the integration test.
- **SC-009**: 100 % of the acceptance scenarios of this spec have a matching automated
  test named after the scenario, passing on `main`.

## Assumptions

- Defaults of the `resilience` section, chosen for interactive use and stated in the
  plan: request deadline 60 s; at most 2 attempts per target (one retry); backoff base
  250 ms, cap 2 s; breaker threshold 5 consecutive counted failures, cool-down 30 s.
  They are policy data, not code, and can be tuned per deployment.
- Settings are per policy, not per target, in this feature (constitution X: a per-target
  override appears when a real need does). The per-rule and per-target timeouts of
  feature 002 are kept unchanged.
- Any final failure advances the chain, retryable or not: a non-retryable failure of one
  provider (for example a rejected credential) says nothing about the next provider.
  Only retryable failures are retried and counted by the breaker.
- A rule without a residency statement allows every residency, which keeps feature 002
  behaviour; the shipped default policy gains explicit statements where they matter
  (decided in the plan, reviewed with the policy). Feature 005 derives narrower sets
  from the detected sensitivity, and the guard of this feature is what enforces them.
- Residency is a declared property of each target (feature 002); the gateway does not
  verify where a provider actually processes data.
- `policy_blocked` (451) already exists in the contract of feature 001 and is reused for
  residency violations; `provider_unavailable` (503) is new.
- Events are the observable record in this feature (log lines); traces, metrics, audit
  entries and the dashboard views are feature 006 and 008, which consume the same
  events.
- Streaming uses the same providers and adapters; whether a provider supports streaming
  usage reporting varies, so missing usage is estimated as in feature 002.
- The streaming error event uses the contract's error envelope inside a server-sent
  event, since the OpenAI format has no standard mid-stream error; the shape is fixed in
  the plan's contract document.
- Privacy actions (`anonymize`, `restrict_to_local`, `block`) and streaming
  de-anonymization are feature 005; this feature leaves the privacy action at `allow`.
- Shared circuit state uses the key-value store of the stack (Redis/Valkey); without
  its connection setting the gateway runs with in-memory state, which is correct for a
  single instance.
