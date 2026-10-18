# Feature Specification: Provider Routing

**Feature Branch**: `002-provider-routing`

**Created**: 2026-10-18

**Status**: Draft (awaiting review by Alex)

**Input**: User description: "Provider routing for Tamiz: rule-based task classification
(type and size), a declarative routing policy whose pure decision function returns a
routing decision with an ordered fallback chain (sensitivity stubbed as unknown; privacy
actions arrive in feature 005), model targets (provider, model, region, residency, cost
per token), an LLM provider port with adapters for Ollama, Mistral, Anthropic and OpenAI,
the OpenAI-compatible non-streaming chat completions endpoint, API-key authentication per
client with hashed keys, cost per request in USD, the `x-tamiz-route` response header, an
in-memory policy repository plus a declarative policy file validated at boot, and a
routing eval dataset with a ≥ 95 % expected-route threshold. Builds on the contracts,
branded types, `Result`/`DomainError` and layer layout of feature 001 without redefining
them."

**Backlog**: `T-002-01` (this spec), `T-002-02` … `T-002-08` (implementation). See
`docs/tasks/BACKLOG.md`, sections "Day 1" and "Days 2-3". `T-002-08` (routing dataset
and gate check) is added to the backlog by this spec.

**Builds on**: `specs/001-contracts-and-skeleton/` — `ChatCompletionRequest`,
`ChatCompletionResponse`, `ErrorEnvelope` and its error types, `RequestId`, `PolicyId`,
`Usd`, `Milliseconds`, `Result<T, E>`, `DomainError`, the clock port, the configuration
loader, the redacting logger and the four-layer gateway layout. This feature **extends**
those definitions (new fields, new error types, new error variants) and never redefines
them.

## Purpose

Tamiz exists to send every request to the best model it is allowed to use. This feature
delivers the first half of that promise: a client speaks the OpenAI chat completion
format to Tamiz, Tamiz works out what kind of task the request is, applies a routing
policy that the operator wrote as plain declarative rules, sends the request to the
chosen model on one of four providers (a local model server, an EU-resident provider and
two frontier providers), and returns the answer together with which route was taken and
what it cost. The decision itself is a pure, deterministic function that can be tested
exhaustively and later audited.

The second half, taking personal data into account, arrives in feature 005 and only adds
inputs to the same decision function. Resilience (retries, circuit breakers, executing
the fallback chain) arrives in feature 003 and only changes how the chain produced here
is executed. This feature therefore fixes the shape of the decision, the policy and the
provider boundary that those features build on.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A client gets a completion routed by policy through the OpenAI-compatible endpoint (Priority: P1)

A developer points an existing OpenAI-compatible client at Tamiz, sends a chat completion
request with a valid API key, and receives a response in the same format they already
parse. The response says which model answered, and a response header names the route
that Tamiz chose. The client never needs to know which provider was used or why.

**Why this priority**: It is the product. Every other story in this feature is a part of
this request path, and every later feature (resilience, privacy, audit, dashboard)
observes it.

**Independent Test**: With fake providers wired in, send a valid request in-process and
assert the status, the response contract, the `model` field and the `x-tamiz-route`
header; then send malformed and unauthenticated requests and assert the error envelopes.

**Acceptance Scenarios**:

1. **Given** a running gateway with a valid policy and a valid API key, **When** the
   client sends `POST /v1/chat/completions` with a valid non-streaming request body,
   **Then** the response has status 200, a body that validates against the chat
   completion response contract, `object: "chat.completion"`, one choice whose message
   has role `assistant`, token usage, and a `model` field naming the model that actually
   produced the answer.
2. **Given** the same request, **When** the client inspects the response headers,
   **Then** it finds `x-tamiz-route` set to the identifier of the policy target that
   produced the answer, `x-tamiz-rule` set to the identifier of the policy rule that
   selected it (or `default`), and the `x-request-id` header defined by feature 001.
3. **Given** a request body that fails the contract (unknown field, wrong type, empty
   `messages`, `stream: true`), **When** it is sent, **Then** the response has status
   400 and an error envelope of type `invalid_request` whose message names the offending
   field paths and expected formats but never echoes field values.
4. **Given** a request whose `model` field names something the policy does not know
   (for example `gpt-4o`), **When** it is sent, **Then** the request is still served:
   the policy's default chain applies and the response `model` field names the model
   actually used.
5. **Given** the gateway, **When** a client requests the API description document,
   **Then** it is served, describes the chat completion endpoint, the health endpoint
   and the error envelope, and is generated from the same contracts the gateway
   validates with (never written by hand).
6. **Given** the primary target fails for a request (provider error, timeout, malformed
   answer), **When** the response is produced, **Then** it is an error envelope of type
   `provider_error` (status 502) or `provider_timeout` (status 504), it still carries
   `x-tamiz-route` naming the target that failed, and the client never sees a stack
   trace or provider-internal payload.

---

### User Story 2 - An operator declares routing in a policy file and the gateway refuses a bad one (Priority: P1)

An operator writes a policy file: a list of model targets (which provider, which model,
where it runs, what it costs) and an ordered list of rules (when a request looks like
*this*, send it to *these* targets in *this* order), plus a default chain. The gateway
loads the file at boot. If anything is wrong, a rule pointing at a target that does not
exist, two targets with the same identifier, a missing default chain, the process stops
with a message that says exactly where the problem is. If the file is valid, the routing
decisions follow it.

**Why this priority**: The policy is the operator's whole interface to routing (and,
from feature 005, to privacy). It must be declarative, validated and boring before any
clever rule is added.

**Independent Test**: Start the gateway with each file of an invalid-policy corpus and
assert the exit code and the reported path; start it with the shipped default policy and
assert that a request is routed according to one of its rules.

**Acceptance Scenarios**:

1. **Given** a policy file in which a rule references a target identifier that is not
   declared, **When** the gateway starts, **Then** it exits with a non-zero code before
   binding any port and the message names the rule, the unknown target identifier and
   the location in the file.
2. **Given** a policy file with two targets sharing an identifier, or a chain that lists
   the same target twice, or an empty default chain, or an unknown provider name, or a
   negative price, **When** the gateway starts, **Then** it exits non-zero and the
   message names the offending path for each problem.
3. **Given** a policy that references a provider for which no credentials or endpoint
   are configured, **When** the gateway starts, **Then** it exits non-zero naming the
   target and the missing setting, never printing any configured secret.
4. **Given** the shipped default policy and a valid environment, **When** the gateway
   starts and receives a request matching one of the rules, **Then** the response
   header `x-tamiz-rule` names that rule and `x-tamiz-route` names the first target of
   its chain.
5. **Given** a valid policy file, **When** it is loaded, **Then** the loaded policy
   carries an identifier and a version, and both appear in the routing decision so that
   later features can audit which policy version made each decision.
6. **Given** a policy loader called in a test with an invalid policy object, **When** it
   runs, **Then** it returns a typed failure listing every problem (not an exception),
   so that the behaviour is covered without spawning a process.

---

### User Story 3 - The routing decision is pure, deterministic and always yields an ordered chain (Priority: P1)

A policy author wants to reason about routing without running anything: given a policy
and a classified request, the decision is a function of those two values alone. It
returns the ordered chain of targets to try, the rule that matched, and a privacy action
that in this feature is always "allow". The same inputs always produce the same output;
every target in the chain is declared in the policy; the chain is never empty.

**Why this priority**: The decision function is the one piece of the system that must be
provably correct; property-based tests and the routing eval both depend on its purity.

**Independent Test**: Exercise the decision function directly with hand-written policies
and classified requests, plus a property-based test over randomly generated valid
policies and requests.

**Acceptance Scenarios**:

1. **Given** a policy whose first rule matches the request's task type and size,
   **When** the decision is computed, **Then** the chain equals that rule's target list
   in the rule's order and the decision names that rule.
2. **Given** a policy where several rules match, **When** the decision is computed,
   **Then** the first matching rule in declaration order wins.
3. **Given** a request matching no rule, **When** the decision is computed, **Then** the
   chain equals the policy's default chain and the decision names `default`.
4. **Given** a rule with a condition on the requested model name (for example
   `tamiz-local`), **When** a request with that `model` value is decided, **Then** that
   rule matches regardless of task type or size.
5. **Given** a rule marked to order its targets by cost, **When** the decision is
   computed, **Then** the chain lists the rule's targets from cheapest to most expensive
   (by the sum of the input and output prices), ties keeping declaration order.
6. **Given** any valid policy and any classified request (property-based over at least
   1000 generated cases), **When** the decision is computed twice, **Then** both
   results are identical; the chain is non-empty; every target in the chain is declared
   in the policy; no target appears twice; the privacy action is `allow`; the decision
   carries the policy identifier, policy version, task type and size.
7. **Given** a classified request, **When** it is decided, **Then** the decision
   includes a `sensitivity` input recorded as `unknown`, reserving the slot that feature
   005 fills, and no rule condition on sensitivity is accepted by this feature's policy
   format.

---

### User Story 4 - Requests are classified by task type and size (Priority: P1)

Before routing, Tamiz looks at the messages and decides what kind of task this is (plain
chat, summarisation, extraction, classification, code, translation) and how big it is
(short, medium, long). The classification is rule-based: a fixed, documented set of
bilingual (Spanish and English) cues and length thresholds, deterministic and fast,
so that a policy author can predict it. A learned classifier may replace the cues later
without changing the policy format.

**Why this priority**: Rules can only route by task type and size if those exist; the
routing eval measures the whole chain classification → decision.

**Independent Test**: Run the classifier on a table of representative messages (Spanish
and English) and assert type and size for each.

**Acceptance Scenarios**:

1. **Given** a request whose last user message asks to summarise a text (for example
   "Resume este informe en tres frases" or "Summarize the following"), **When** it is
   classified, **Then** the task type is `summarize`.
2. **Given** a request that contains a fenced code block or asks to write, fix or
   explain code, **When** it is classified, **Then** the task type is `code`.
3. **Given** a request asking to translate ("Traduce al inglés", "Translate into
   Spanish"), to extract fields ("Extrae el nombre y la fecha", "Extract the invoice
   number as JSON") or to classify or label ("Clasifica el sentimiento", "Which
   category does this belong to"), **When** it is classified, **Then** the task types
   are `translate`, `extract` and `classify` respectively.
4. **Given** a request with no recognised cue, **When** it is classified, **Then** the
   task type is `chat`.
5. **Given** requests whose estimated input length is below the short threshold, between
   the thresholds, and above the long threshold, **When** they are classified, **Then**
   the sizes are `short`, `medium` and `long`; the thresholds are fixed constants
   documented with the feature.
6. **Given** the same request classified twice, **When** results are compared, **Then**
   they are identical; **Given** two cues of different types in one message, **Then**
   the documented precedence decides and the result is stable.

---

### User Story 5 - Only authenticated clients can use the endpoint (Priority: P1)

An operator issues one API key per client application. Tamiz stores only a one-way hash
of each key, never the key itself, and identifies the client on every request so that
later features can attribute cost and audit entries. A request without a key, or with an
unknown key, is refused before anything is classified or routed.

**Why this priority**: The endpoint sends requests to paid providers under the
operator's credentials; it cannot be open.

**Independent Test**: Send requests with no key, a malformed header, an unknown key and a
valid key, and assert 401 for the first three and 200 for the last; assert that the
stored configuration and every log line contain only hashes.

**Acceptance Scenarios**:

1. **Given** no `Authorization` header, or a header that is not `Bearer <key>`, **When**
   a chat completion is requested, **Then** the response is 401 with an error envelope
   of type `unauthorized` and no provider is called.
2. **Given** a well-formed key that matches no configured hash, **When** it is sent,
   **Then** the response is 401 `unauthorized`, no provider is called, and the log line
   for the request contains neither the presented key nor any configured hash.
3. **Given** a key whose hash matches a configured client, **When** it is sent, **Then**
   the request proceeds and the client identifier is available to the use case (and
   recorded in the request log line) while the key itself appears nowhere.
4. **Given** the key configuration contains a malformed entry (no client identifier, or
   a hash of the wrong length), **When** the gateway starts, **Then** it exits non-zero
   naming the entry position, never printing the entry itself; **Given** no key is
   configured at all, **Then** the gateway also refuses to start, because an open
   endpoint is never the default.
5. **Given** the health endpoint of feature 001, **When** it is requested without a key,
   **Then** it still answers 200 (liveness stays unauthenticated).

---

### User Story 6 - Any of the four providers can serve a target, and their failures become typed errors (Priority: P2)

An operator can declare targets on a local model server, on the EU-resident provider, or
on either frontier provider, each with its own credentials and endpoint. When a provider
answers successfully, the answer is normalised into the same completion shape. When it
fails (rate limit, server error, authentication failure, timeout, unparseable body), the
failure becomes a typed error that says which target failed, why, and whether retrying
could help, so that feature 003 can act on it and feature 006 can audit it. Nothing is
swallowed and nothing leaks.

**Why this priority**: Without normalised success and failure, neither resilience nor
audit can be built; but the behaviour is only observable through story 1.

**Independent Test**: For each of the four providers, run the adapter against a simulated
provider endpoint returning a success, HTTP 429, HTTP 500, HTTP 401, a malformed body and
a stalled connection, and assert the normalised result or typed error for each.

**Acceptance Scenarios**:

1. **Given** any of the four providers answering successfully, **When** the adapter is
   called, **Then** it returns a normalised completion with the assistant text, a finish
   reason from the contract's closed list, prompt and completion token counts, and the
   provider model name.
2. **Given** a provider answering HTTP 429 or HTTP 5xx, **When** the adapter is called,
   **Then** it returns a provider error marked retryable, carrying the target identifier
   and the upstream status, without throwing.
3. **Given** a provider answering HTTP 401/403 or HTTP 4xx other than 429, **When** the
   adapter is called, **Then** it returns a provider error marked not retryable, and the
   error message never includes the credential used.
4. **Given** a provider that does not answer within the target's timeout, **When** the
   adapter is called, **Then** it returns a timeout error after that duration (observed
   with a bounded real wait of a few hundred milliseconds in the test), marked
   retryable, and the underlying connection is aborted.
5. **Given** a provider answering with a body that does not match its documented shape,
   **When** the adapter is called, **Then** it returns a malformed-response error, not
   retryable, and the raw body is not included in the error.
6. **Given** a target whose timeout is set in the policy, **When** the adapter is called,
   **Then** that timeout (not a library default) bounds the call; **Given** no timeout
   on the target, **Then** the policy-level default timeout applies; **Given** the
   matched rule also sets a timeout, **Then** the rule's timeout wins over both.
7. **Given** a request with `temperature` and `max_tokens`, **When** it is forwarded,
   **Then** both reach the provider; the `user` field is never forwarded.

---

### User Story 7 - Every completion reports its cost (Priority: P2)

A finance-minded operator wants to know what each request cost. Each target declares its
price per million input tokens and per million output tokens in US dollars (zero for the
local server). Tamiz multiplies the provider's reported usage by those prices and returns
the cost with the response, ready for the audit log of feature 006 and the cost screen of
feature 008.

**Why this priority**: Cost is a headline metric of the project; it is cheap to compute
once usage and pricing exist.

**Independent Test**: Compute cost for a table of usage/pricing pairs including zero
usage and zero prices; send a request through fake providers and read the cost from the
response.

**Acceptance Scenarios**:

1. **Given** a target priced at 0.15 USD per million input tokens and 0.60 per million
   output tokens, **When** a completion uses 1 000 input and 500 output tokens, **Then**
   the cost is 0.00045 USD (within 1e-9) and is expressed in the `Usd` branded unit.
2. **Given** a target with zero prices (local model), **When** any completion is
   produced, **Then** the cost is exactly 0.
3. **Given** a provider reports zero usage, **When** the cost is computed, **Then** it
   is 0 and no error occurs.
4. **Given** a provider omits usage entirely, **When** the response is built, **Then**
   token counts are estimated from the exchanged text, the response marks usage as
   estimated, and the cost is computed from the estimate.
5. **Given** a successful completion, **When** the client reads the response, **Then**
   the `usage` object includes the cost in USD alongside the standard token counts, and
   the response still validates against the (extended) response contract.

---

### User Story 8 - Routing quality is measured against a versioned dataset (Priority: P1)

A maintainer changes a classification cue or a default rule. A versioned, synthetic
dataset of requests, each annotated with the expected task type, size and route under the
shipped default policy, runs in the automated checks and fails them if fewer than 95 %
of requests reach their expected route. The dataset is bilingual, contains no real data,
and lists every failing case by identifier so the regression is easy to inspect.

**Why this priority**: Constitution principle IV: an AI behaviour (here, classification
and routing) is only accepted with a dataset and a threshold. The threshold is the
project's published routing metric.

**Independent Test**: Run the dataset check; lower one expectation deliberately and watch
the check fail naming the case; restore it.

**Acceptance Scenarios**:

1. **Given** the routing dataset (version 1) and the shipped default policy, **When**
   the dataset check runs, **Then** at least 95 % of cases produce the expected route
   (first target of the chain) and the check passes.
2. **Given** a case whose expected route is deliberately wrong, **When** the check runs,
   **Then** the report lists that case identifier with its expected and actual route,
   and the check fails if the share of matches drops below 95 %.
3. **Given** the dataset file, **When** it is inspected, **Then** every case has a
   unique identifier, a messages array, an optional requested model, and expected task
   type, size and route; the file declares its version and the policy it was written
   against; at least 40 cases exist, in Spanish and English, covering every task type
   and size; none contains real personal data.
4. **Given** the dataset check, **When** it runs in the automated pipeline, **Then** it
   needs no network and no provider: it exercises only the classifier and the decision
   function.

---

### Edge Cases

- **Requested `model` equals a target identifier** (for example `ollama-llama`): no
  implicit pinning; the value only matters if a rule's condition matches it. Policy
  governs, not the client.
- **Empty or whitespace-only message content**: valid per the contract; classified as
  `chat` / `short`; forwarded as is.
- **Several cue types in one message** ("translate this code"): resolved by the fixed
  precedence documented with the classifier; the dataset includes such cases.
- **A rule with an empty condition**: matches every request (acts as a catch-all placed
  before the default chain). Allowed, because it is explicit.
- **A policy with zero rules**: allowed; the default chain serves everything.
- **Rule target order by cost with equal prices**: declaration order is kept (stable).
- **Provider returns a finish reason outside the contract's list** (tool calls, content
  filtered, unknown): mapped to the closest value of the closed list; content filtering
  maps to `content_filter`, a finish reason that signals a provider-side error is
  treated as a malformed response, anything else maps to `stop`, and the mapping is
  documented.
- **Provider returns more than one choice**: only the first is returned (`n > 1` is not
  in the request contract).
- **Provider usage missing**: estimated and flagged (story 7, scenario 4), never silently
  zero.
- **Oversized request body** (above 1 MiB): rejected as `invalid_request` before parsing
  the whole body.
- **Two API keys hash to the same client identifier** (rotation): both accepted; the
  client identifier is what the request carries.
- **Policy file changes while running**: not picked up; a restart is required in this
  feature (feature 008 adds an admin endpoint to replace the policy).
- **Fallback chain beyond the first target**: computed but not executed in this feature;
  the chain is returned in the decision and in the error for feature 003 to act on.

## Requirements *(mandatory)*

### Functional Requirements

Domain model and decision (backlog `T-002-02`):

- **FR-001**: The domain MUST define a `ModelTarget` with a unique identifier, a provider
  from the closed list (`ollama`, `mistral`, `anthropic`, `openai`), a provider model
  name, a region label, a residency from the closed list (`local`, `eu`, `us`,
  `global`), a price per million input tokens and per million output tokens in `Usd`,
  and an optional per-target timeout in `Milliseconds`.
- **FR-002**: The domain MUST define `TaskType` (`chat`, `summarize`, `extract`,
  `classify`, `code`, `translate`) and `TaskSize` (`short`, `medium`, `long`) as closed
  lists, and a `ClassifiedRequest` carrying the original messages, the requested model
  name, the task type, the task size, the estimated input tokens and a `sensitivity`
  slot whose only value in this feature is `unknown`.
- **FR-003**: The domain MUST define a `RoutingPolicy` with a `PolicyId`, an integer
  version, a non-empty list of targets, an ordered list of rules, a non-empty default
  chain and a default timeout; each rule MUST have an identifier, a condition (any
  subset of: task types, task sizes, requested model names) and a non-empty ordered list
  of target identifiers, plus an optional flag to order that list by cost and an
  optional timeout that applies to the requests the rule matches (the per-task-type
  timeout of the project conventions).
- **FR-004**: The domain MUST provide a policy validation function returning a typed
  result that rejects: duplicate target identifiers, duplicate rule identifiers, a rule
  identifier equal to the reserved word `default`, a rule or default chain referencing
  an undeclared target, a chain listing a target twice, an empty chain, a negative
  price, a non-positive timeout, and any unknown field; every problem MUST carry its
  path.
- **FR-005**: The domain MUST provide a pure `decide(policy, classifiedRequest)`
  function that, for a validated policy, always returns a `RoutingDecision` containing:
  the policy identifier and version, the matched rule identifier (or `default`), the
  ordered non-empty chain of `ModelTarget`s with no duplicates, the task type and size,
  the recorded sensitivity, and a privacy action whose only value in this feature is
  `allow`.
- **FR-006**: `decide` MUST evaluate rules in declaration order and select the first
  whose condition matches; a condition matches when each specified field contains the
  request's value, and an empty condition matches every request.
- **FR-007**: When a rule is flagged to order by cost, `decide` MUST sort its targets by
  the sum of input and output prices ascending, keeping declaration order for ties.
- **FR-008**: The domain MUST provide a pure classifier that maps the messages to a
  `TaskType` by a documented, bilingual (Spanish and English) cue list with a fixed
  precedence, and to a `TaskSize` by estimated input tokens against two fixed, documented
  thresholds; classification MUST be deterministic and MUST NOT depend on the clock,
  randomness or external services.

Application layer (backlog `T-002-03`):

- **FR-009**: The application layer MUST define an `LlmProviderPort` with a single
  completion operation that takes the target, the messages, the optional sampling
  parameters, and a timeout, and returns a typed result of either a normalised
  completion (assistant text, finish reason, usage, provider model name) or a
  `ProviderError`.
- **FR-010**: The application layer MUST define a `PolicyRepositoryPort` that returns the
  active policy, and MUST reuse the clock port of feature 001.
- **FR-011**: A `ClassifyTask` use case MUST turn a validated chat completion request
  into a `ClassifiedRequest` using the domain classifier.
- **FR-012**: A `RouteInference` use case MUST, in order: classify, obtain the active
  policy, decide, call the provider port for the first target of the chain with the
  effective timeout (the matched rule's timeout, else the target's, else the policy
  default), compute the cost, and return a typed result containing the completion, the
  decision and the cost; on provider failure it MUST return the `ProviderError`
  together with the decision, without trying further targets in this feature.
- **FR-013**: `DomainError` MUST be extended with a `ProviderError` variant (target
  identifier, provider, cause from the closed list `http_error`, `timeout`, `network`,
  `malformed_response`, `rate_limited`, `authentication`; a `retryable` flag; an
  optional upstream status) and an `UnauthorizedError` variant, each with a constructor.

Provider adapters (backlog `T-002-04`):

- **FR-014**: One adapter per provider (`ollama`, `mistral`, `anthropic`, `openai`) MUST
  implement `LlmProviderPort`, be constructed from explicit settings (endpoint,
  credential) and never read the environment itself.
- **FR-015**: Adapters MUST map upstream HTTP 429 and 5xx to a retryable `ProviderError`
  (`rate_limited` or `http_error`), upstream 401/403 and other 4xx to a non-retryable
  `ProviderError` (`authentication` or `http_error`), connection failures to `network`
  (retryable), unparseable bodies to `malformed_response` (not retryable), and
  exceeding the timeout to `timeout` (retryable) while aborting the connection.
- **FR-016**: Adapters MUST forward `temperature` and `max_tokens` when present, MUST
  NOT forward the `user` field, and MUST map the provider's finish reason to the
  contract's closed list (`stop`, `length`, `content_filter`).
- **FR-017**: Adapter errors MUST never contain the credential, the request messages or
  the raw upstream body; they MAY contain the upstream status and a short reason.
- **FR-018**: A provider registry MUST resolve a provider name to its adapter and MUST
  be built once in the composition root from validated configuration.

Policy file and repository (backlog `T-002-05`):

- **FR-019**: The policy MUST be expressible as a human-editable text file whose shape is
  defined as a schema in the contracts package (so the dashboard editor of feature 008
  and the gateway validate the same thing); the file MUST carry the policy identifier
  and version.
- **FR-020**: The gateway MUST load the policy file named by configuration at boot,
  validate it (FR-004 plus schema validation), and refuse to start on any problem with a
  non-zero exit code and one line per problem naming its path; secrets MUST never be
  printed.
- **FR-021**: Boot MUST also fail when a target references a provider whose settings
  (endpoint or credential) are absent, naming the target and the missing setting.
- **FR-022**: An in-memory implementation of `PolicyRepositoryPort` MUST be provided
  (seeded from the loaded file in the composition root, seeded directly in tests).
- **FR-023**: A default policy file MUST ship with the repository, declaring at least one
  target on each of the four providers, a rule routing by requested model name, a rule
  routing code tasks to a frontier target, a rule using cost ordering, and a default
  chain whose first target is EU-resident or local.

Endpoint, authentication and API description (backlog `T-002-06`):

- **FR-024**: The gateway MUST expose `POST /v1/chat/completions` (non-streaming)
  validating the body against the chat completion request contract and returning a body
  that validates against the chat completion response contract.
- **FR-025**: The response `model` field MUST be the provider model name of the target
  that answered; the response `id` MUST be derived from the request identifier.
- **FR-026**: Every response for which a routing decision was made MUST carry
  `x-tamiz-route` (target identifier) and `x-tamiz-rule` (rule identifier or `default`);
  responses refused before the decision (400, 401) MUST NOT carry them.
- **FR-027**: Validation failures MUST map to 400 `invalid_request` listing issue paths
  and expected formats without field values; `ProviderError` MUST map to 502
  `provider_error`, except `timeout` which maps to 504 `provider_timeout`;
  `UnauthorizedError` MUST map to 401 `unauthorized`.
- **FR-028**: The error type list of feature 001 MUST be extended with
  `provider_timeout` (HTTP 504); existing types and mappings are unchanged.
- **FR-029**: The endpoint MUST require `Authorization: Bearer <key>`; the gateway MUST
  store only one-way hashes of keys together with a client identifier, compare in
  constant time, attach the client identifier to the request, and reject missing,
  malformed or unknown keys with 401 before classification.
- **FR-030**: Key configuration MUST be validated at boot: at least one entry, each with
  a client identifier and a hash of the expected length; failures stop the process
  naming the entry position, never its content. A documented command MUST generate a
  new key and print its hash for the operator.
- **FR-031**: The gateway MUST serve a machine-readable API description generated from
  the contracts package covering the chat completion endpoint, the health endpoint and
  the error envelope; the hand-written review projection of feature 001 MUST be removed
  once the generated document exists.
- **FR-032**: Request bodies above 1 MiB MUST be rejected with 400 `invalid_request`.

Cost (backlog `T-002-07`):

- **FR-033**: Cost MUST be computed as `prompt_tokens × inputPrice / 1 000 000 +
  completion_tokens × outputPrice / 1 000 000`, expressed in `Usd`, exact to at least
  1e-9 for the pricing corpus.
- **FR-034**: When the provider omits usage, token counts MUST be estimated from the
  exchanged text with the same estimator the classifier uses, and the response MUST mark
  the usage as estimated.
- **FR-035**: The chat completion response contract MUST be extended with an optional
  `cost_usd` and an optional `estimated` flag inside `usage`; the gateway MUST populate
  `cost_usd` on every successful response.

Routing dataset and gate (backlog `T-002-08`):

- **FR-036**: A synthetic routing dataset, version 1, MUST exist with at least 40 cases
  in Spanish and English covering every task type and size; each case MUST carry a
  unique identifier, messages, an optional requested model, and the expected task type,
  size and route under the default policy; the file MUST declare its version and the
  policy it targets.
- **FR-037**: An automated check MUST run the classifier and `decide` over the dataset
  with the default policy, without network or providers, and fail when fewer than 95 %
  of cases reach the expected route; it MUST report every mismatching case with expected
  and actual values and also report the task-type accuracy.
- **FR-038**: The dataset MUST contain no real personal data: every name, identifier and
  text is invented, and the file says so in its header.

### Key Entities

- **ModelTarget**: a concrete model on a provider with its location, residency and
  prices (FR-001). Identified by a short string the policy author chooses.
- **TaskType / TaskSize / ClassifiedRequest**: what the classifier produces; the inputs
  to routing besides the policy (FR-002).
- **RoutingPolicy / RoutingRule**: the operator's declarative routing (FR-003); the same
  shape is a contract schema (FR-019) and a file.
- **RoutingDecision**: the output of `decide`: policy id and version, rule, ordered
  chain, task type and size, sensitivity (`unknown`), privacy action (`allow`) (FR-005).
  Later features add fields, never change these.
- **ProviderCompletion / ProviderError**: the normalised success and failure shapes at
  the provider boundary (FR-009, FR-013).
- **ApiKeyRecord**: a client identifier plus the one-way hash of its key (FR-029).
- **Cost**: `Usd` derived from usage and prices (FR-033).
- **RoutingDataset**: versioned synthetic cases with expectations (FR-036).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: At least 95 % of the routing dataset cases reach their expected route
  under the default policy, and the check is part of the automated pipeline; this is
  the published routing metric of the project.
- **SC-002**: 100 % of the acceptance scenarios in this spec have a matching automated
  test, named after the scenario, passing on `main`.
- **SC-003**: Over at least 1 000 generated policy/request pairs, 100 % satisfy
  determinism, non-empty chain, declared targets only and no duplicates.
- **SC-004**: For each of the four providers, 100 % of the simulated failure modes
  (429, 5xx, 401/403, other 4xx, malformed body, timeout, connection failure) produce a
  typed error and an error envelope; zero unhandled exceptions reach the client.
- **SC-005**: Zero API keys, key hashes or message contents appear in captured log output
  or error bodies across the authentication and provider test corpora.
- **SC-006**: 100 % of the invalid-policy and invalid-key-configuration corpus stops the
  process before a port is bound, with every problem's path in the output.
- **SC-007**: Classification plus decision add under 5 ms per request in-process (p95),
  and the endpoint's own overhead excluding provider time stays under 20 ms (p95) with
  fake providers.
- **SC-008**: Cost matches a hand-computed value within 1e-9 USD on 100 % of the pricing
  corpus, including zero usage and zero prices.
- **SC-009**: A reviewer can run the quickstart against the local model server alone
  (one target, one key) and see a routed, costed answer with `x-tamiz-route` within 10
  minutes of a fresh clone, model download excluded.

## Assumptions

- The contracts, branded types, `Result`, `DomainError`, clock port, configuration
  loader, logger and layer layout are those of feature 001 as specified; this feature
  only adds to them. If feature 001 changes during review, this spec follows it.
- The `model` field of the request is a client hint, not a command: the policy decides,
  and a rule may condition on the requested name (for virtual model names such as
  `tamiz-auto` or `tamiz-local`). The response `model` field reports the real model.
- Sensitivity is recorded as `unknown` and the privacy action is always `allow`;
  feature 005 widens both and adds rule conditions on sensitivity. The policy format of
  this feature rejects a sensitivity condition so that the extension is explicit.
- The fallback chain is computed and returned but only its first target is executed;
  feature 003 executes the rest with timeout, retry, circuit breaker and the residency
  guard. A primary failure in this feature is reported to the client as 502/504.
- Residency and region are declared data on targets, not yet enforced; features 003 and
  005 enforce them. The closed residency list (`local`, `eu`, `us`, `global`) is fixed
  here so that policies written now stay valid.
- Classification is rule-based with fixed, documented cue lists and thresholds in
  Spanish and English; the thresholds are constants of the domain (not configurable in
  the policy) until a need appears. A learned classifier is a later, cuttable item of
  the roadmap.
- API keys live in configuration (hashed) in this feature; feature 006 moves them to the
  database with the same record shape. One key per client application, high-entropy,
  generated by the documented command; a fast one-way hash is appropriate because keys
  are random, not human-chosen.
- Provider credentials and endpoints come from configuration; a target whose provider is
  not configured is a boot error, so a local-only setup uses a policy with only the
  local target. The default policy assumes all four providers are configured.
- The local model server speaks an OpenAI-compatible protocol; the other three are
  addressed through their native APIs. Which library does this is a plan decision.
- Prices in the default policy are illustrative list prices at the time of writing and
  are data, not code; operators are expected to maintain them.
- Streaming (`stream: true`) remains rejected by the request contract until feature 003.
- Audit entries, telemetry spans and the `x-tamiz-fallback` header are features 003 and
  006; this feature only makes the decision and the cost available to them.
- No rate limiting of clients is done here; the `rate_limited` error type stays reserved
  for a later feature.
