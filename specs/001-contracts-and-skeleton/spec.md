# Feature Specification: Contracts and Skeleton

**Feature Branch**: `001-contracts-and-skeleton`

**Created**: 2026-10-18

**Status**: Approved (reviewed by Alex, 2026-10-18)

**Input**: User description: "Monorepo foundation for Tamiz, the privacy-aware LLM gateway:
workspace tooling, shared contracts package with the OpenAI-compatible chat completions
schemas and branded types, gateway skeleton with Clean Architecture layers, typed results,
validated configuration, redacting logger and a health endpoint, test utilities, enforced
architecture limits and a CI pipeline that gates `main`."

**Backlog**: `T-001-01` (this spec), `T-001-02` … `T-001-06` (implementation). See
`docs/tasks/BACKLOG.md`, section "Day 1".

## Purpose

Every later feature of Tamiz (routing, resilience, privacy, audit, evals, dashboard)
builds on the same foundation: one repository where every package is checked with the
same strict rules, one shared place where every public contract is defined once, a
gateway whose layers cannot silently leak into each other, and a pipeline that refuses to
merge anything that breaks those rules. This feature delivers that foundation with a
single visible behaviour, a health endpoint, so that the whole chain from contract to
running service to automated gate can be verified end to end before any business logic
exists.

Readers of this repository are also its audience: a reviewer must be able to clone the
repository, run one install and one check command, and see every quality gate pass.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A contributor verifies the whole workspace with one command (Priority: P1)

A contributor (Alex or a Claude Code session) clones the repository, installs
dependencies once, and runs the lint, type and test checks from the root. Every
workspace package is covered, the commands exit successfully on a clean tree, and a
commit whose message does not follow the project's commit convention is rejected before
it is created.

**Why this priority**: Without a working workspace nothing else can be built or
verified. This is the first task of day 1 and the prerequisite of every other story.

**Independent Test**: Clone the repository at the end of the feature, run install, lint,
typecheck and test from the root, then attempt a commit with the message `wip`. The
first four succeed and the commit is refused.

**Acceptance Scenarios**:

1. **Given** a fresh clone with the pinned runtime version available, **When** the
   contributor runs the install command, **Then** it completes without errors and every
   workspace package (`apps/gateway`, `packages/contracts`, `packages/test-utils`,
   `packages/tsconfig`) is linked.
2. **Given** an installed workspace, **When** the contributor runs lint, typecheck and
   test from the root, **Then** each command exits with status 0 and reports every
   workspace package that defines that step.
3. **Given** a staged change, **When** the contributor commits with a message that does
   not follow Conventional Commits (for example `wip` or `Added stuff`), **Then** the
   commit is refused with a message naming the expected format.
4. **Given** a staged change, **When** the contributor commits with a valid message (for
   example `feat(contracts): add health schema`), **Then** the commit is created.
5. **Given** the repository, **When** a reader inspects the root package manifest,
   **Then** it is marked private, declares the Apache-2.0 licence and pins the Node 22
   runtime range.

---

### User Story 2 - A consumer validates requests and responses against shared contracts (Priority: P1)

A developer writing a client, the gateway, or a test imports the shared contracts
package and uses it to validate an OpenAI-compatible chat completion request, a chat
completion response, a health response or an error envelope. Invalid data is rejected
with a precise description of what is wrong; valid data is accepted and carries a
precise static type. Identifiers and units (request ids, policy ids, US dollars,
milliseconds) are distinct types that cannot be mixed by accident.

**Why this priority**: Constitution principle II (contract-first) makes this package the
single source of truth for every API. Routing (feature 002) cannot start without the
chat completion schemas.

**Independent Test**: Run the contracts package's unit tests. They exercise every
schema with valid and invalid samples and compile a type-level test that refuses to
assign a `Usd` to a `Milliseconds`.

**Acceptance Scenarios**:

1. **Given** a chat completion request with `model`, a non-empty `messages` array whose
   items have a valid `role` and string `content`, and optional `temperature`,
   `max_tokens`, `stream: false` and `user`, **When** it is validated, **Then** it is
   accepted and the inferred type exposes those fields.
2. **Given** a chat completion request that contains an unknown top-level field,
   **When** it is validated, **Then** it is rejected and the error names the unknown
   field.
3. **Given** a chat completion request with a field of the wrong type (for example
   `temperature: "hot"` or `messages: "hello"`), **When** it is validated, **Then** it
   is rejected and the error names the field and the expected type.
4. **Given** a chat completion request with `stream: true`, **When** it is validated,
   **Then** it is rejected, because the streaming subset is out of scope for this
   feature (feature 003 adds it).
5. **Given** a chat completion response with `id`, `object: "chat.completion"`,
   `created`, `model`, a `choices` array with `index`, `message` and `finish_reason`,
   and `usage` token counts, **When** it is validated, **Then** it is accepted.
6. **Given** a health response `{ status: "ok", version, uptimeMs }`, **When** it is
   validated, **Then** it is accepted; **Given** `status: "degraded"` with a non-empty
   `checks` list, **Then** it is also accepted; **Given** any other `status`, **Then**
   it is rejected.
7. **Given** an error envelope `{ error: { type, message, requestId? } }` where `type`
   is one of the documented error types, **When** it is validated, **Then** it is
   accepted; an unknown `type` is rejected.
8. **Given** the branded types, **When** a value typed `Usd` is passed where
   `Milliseconds` is expected (or `RequestId` where `PolicyId` is expected), **Then**
   the type checker rejects the program; **When** a plain string is passed as
   `RequestId` without going through the constructor, **Then** the type checker
   rejects it as well.
9. **Given** the contracts package, **When** it is built, **Then** the build succeeds
   and consumers can import the schemas and the inferred types from the package entry
   point.

---

### User Story 3 - An operator checks that the gateway is up (Priority: P1)

An operator (or a load balancer, or Docker Compose's health check) sends a request to
the gateway's health endpoint and receives a response that states whether the service
is healthy, which version is running and for how long. The response always matches the
shared health contract.

**Why this priority**: It is the only externally visible behaviour of this feature and
the proof that the whole chain works: contract, presentation layer, composition root,
running process.

**Independent Test**: Start the gateway with a valid configuration and request
`GET /health`; validate the body against the health contract from the contracts package.

**Acceptance Scenarios**:

1. **Given** a running gateway with a valid configuration, **When** a client requests
   `GET /health`, **Then** the response has status 200, a JSON body that validates
   against the health contract, `status: "ok"`, the running version and a non-negative
   uptime in milliseconds.
2. **Given** the gateway's HTTP application, **When** it is exercised in-process by a
   test without opening a network port, **Then** the same `GET /health` behaviour is
   observed, so that the endpoint is covered by a fast test.
3. **Given** a running gateway, **When** a client requests an unknown path (for example
   `GET /nope`), **Then** the response has status 404 and a body that validates against
   the error envelope contract with `type: "not_found"`.
4. **Given** every response from the gateway, **When** a client inspects the headers,
   **Then** it finds an `x-request-id` header; **Given** the client sent its own
   `x-request-id`, **Then** that value is echoed back.

---

### User Story 4 - The gateway refuses to start with an invalid configuration (Priority: P2)

An operator starts the gateway with a malformed environment variable. The
process stops immediately with a non-zero exit code and a message that names every
offending variable and what was expected. Secrets are never printed. With a valid
configuration the process starts and logs one structured line that states the bound
address and the version.

**Why this priority**: Constitution principle VI (fail fast). Cheap to do now and painful
to retrofit once many settings exist.

**Independent Test**: Start the gateway with `PORT=abc` and with `LOG_LEVEL=loud`,
assert the exit code and the message; start it with an empty environment and assert it
serves `/health` on the defaults.

**Acceptance Scenarios**:

1. **Given** an environment where a variable has an invalid value (for example
   `PORT=abc`, `LOG_LEVEL=loud`), **When** the gateway is started, **Then** the process exits with a non-zero code before binding any port and
   prints a message that lists each invalid variable with the expected format.
2. **Given** an empty environment (every setting has a default in this feature),
   **When** the gateway is started, **Then** settings take their documented defaults (`PORT=3000`,
   `HOST=0.0.0.0`, `LOG_LEVEL=info`, `NODE_ENV=development`) and the process serves
   `/health`.
3. **Given** the gateway's configuration loader, **When** it is called in a test with an
   invalid environment object, **Then** it returns a typed failure (not an exception)
   that lists the invalid variables, so that the behaviour is covered without spawning
   a process.

---

### User Story 5 - Logs never contain prompt content or credentials (Priority: P2)

A developer logs an object that happens to contain a `prompt`, a `messages` array or an
`authorization` header, at any nesting depth the project agrees to cover. The emitted
log line shows those fields as redacted and keeps every other field intact. Log lines
are structured (one JSON object per line) and carry the request id when one is in
scope.

**Why this priority**: Constitution principle V (privacy by default) must hold from the
first line of logging, before any prompt ever flows through the gateway.

**Independent Test**: Write a log line through the project logger with the sensitive
fields present at top level and nested under `req.headers` / `body`, capture the output
and assert the redaction placeholder replaced each value.

**Acceptance Scenarios**:

1. **Given** the project logger, **When** an object containing `prompt`, `messages` or
   `authorization` at the top level is logged, **Then** the emitted line replaces each
   of those values with a fixed redaction placeholder and keeps every other field.
2. **Given** the project logger, **When** an object containing `req.headers.authorization`,
   `body.prompt` or `body.messages` is logged, **Then** those nested values are redacted
   as well.
3. **Given** the project logger, **When** any line is emitted, **Then** it is a single
   JSON object with at least `level`, `time` and `msg`, and the configured `LOG_LEVEL`
   filters lower levels out.

---

### User Story 6 - The architecture limits are enforced by a machine, not a reviewer (Priority: P1)

A contributor accidentally imports an infrastructure module from the domain layer, or
imports infrastructure from anywhere but the composition root. The architecture check
fails locally and in CI with a message that names the offending file and the violated
rule. The same check passes on a compliant tree. The CI pipeline runs lint, typecheck,
architecture check, tests and build in that order on every pull request and on `main`,
and `main` cannot receive changes whose pipeline is not green.

**Why this priority**: Constitution principle I says a layering violation is a failed
build, not a review comment. This is the project's main architectural claim and must be
demonstrable.

**Independent Test**: Add a deliberate `domain → infrastructure` import, run the
architecture check, observe the failure naming the file and rule, remove the import,
observe the pass. Open a pull request and observe the required status check on `main`.

**Acceptance Scenarios**:

1. **Given** a compliant gateway tree, **When** the architecture check runs, **Then** it
   exits with status 0 and reports zero violations.
2. **Given** a file under `domain/` that imports from `infrastructure/`, `application/`,
   `presentation/`, a workspace package or an external library, **When** the check
   runs, **Then** it fails and names the file and the rule `domain-imports-nothing`.
3. **Given** a file under `application/` that imports from `infrastructure/` or
   `presentation/`, **When** the check runs, **Then** it fails with the rule
   `application-only-domain`.
4. **Given** a file under `presentation/` that imports from `infrastructure/`, **When**
   the check runs, **Then** it fails with the rule `only-main-imports-infrastructure`;
   **Given** `main.ts` imports from `infrastructure/`, **Then** the check passes.
5. **Given** a file under `infrastructure/` that imports from `presentation/`, **When**
   the check runs, **Then** it fails with the rule `infrastructure-no-presentation`.
6. **Given** a pull request against `main`, **When** it is opened or updated, **Then**
   the pipeline runs lint, typecheck, architecture check, tests and build in that order
   and reports a single required status; a failure in any step marks the pull request
   as not mergeable.
7. **Given** the `main` branch, **When** anyone tries to push to it directly or merge a
   pull request whose required status is not green, **Then** the hosting platform
   refuses.

---

### User Story 7 - Use cases can be tested without the clock or any infrastructure (Priority: P2)

A developer writing a use case test needs a controllable clock and ready-made valid
request objects. The shared test utilities package provides a fake clock whose time
only moves when the test says so, and builders that produce valid contract objects with
overridable fields. The test runner discovers tests in every workspace package from a
single root command and reports coverage.

**Why this priority**: Constitution principle VIII (testability). Needed by feature 002
on day 2; small enough to finish on day 1.

**Independent Test**: Write a test that creates the fake clock at a fixed instant,
advances it by a duration, and asserts `now()` moved by exactly that amount; run the
whole test suite from the root and see every package reported.

**Acceptance Scenarios**:

1. **Given** a fake clock created at a fixed instant, **When** the test reads `now()`
   twice without advancing, **Then** both reads are identical; **When** the test
   advances by 1500 ms, **Then** `now()` is exactly 1500 ms later.
2. **Given** the request builders, **When** a test calls the chat completion request
   builder without arguments, **Then** the result validates against the contract;
   **When** it passes an override (for example `{ model: "x" }`), **Then** the result
   keeps every default and applies the override.
3. **Given** the root test command, **When** it runs, **Then** tests from
   `packages/contracts`, `packages/test-utils` and `apps/gateway` are all executed and
   reported, and a coverage summary is produced.

---

### Edge Cases

- **Empty `messages` array** in a chat completion request: rejected (at least one
  message is required).
- **`choices` with zero items** in a chat completion response: rejected (a completion
  always has at least one choice).
- **Unknown `role`** (anything other than `system`, `user`, `assistant`): rejected.
- **`temperature` outside `[0, 2]`** or **`max_tokens` not a positive integer**: rejected.
- **Health endpoint while the process is still booting**: not applicable in this
  feature (there are no dependencies to warm up); `status: "degraded"` and `checks` are
  reserved for features 006 and OPS and only the contract shape is defined now.
- **Redaction key collision**: a legitimately named field `prompt` in a non-sensitive
  context is still redacted. Accepted: the rule is by key name, never by content.
- **`x-request-id` provided by the client but malformed** (longer than 128 characters
  or containing control characters): the gateway ignores it and generates its own.
- **Architecture check on an empty layer folder**: passes (no modules, no violations);
  each layer folder ships with a placeholder module so the rules are exercised.
- **Pipeline cache**: a cached task result is keyed on every input of the task, so it
  can never hide a failure; the hosted pipeline has no remote cache in this feature and
  therefore runs every step cold.
- **Commit convention and merge commits**: commit messages generated by the hosting
  platform for merges and reverts are accepted by the convention check.

## Requirements *(mandatory)*

### Functional Requirements

Workspace and tooling (backlog `T-001-02`):

- **FR-001**: The repository MUST be a single workspace in which every package is
  installed, linted, type-checked, tested and built from the root with one command per
  step, and in which a step runs only for the packages that define it.
- **FR-002**: The root manifest MUST be marked private, declare the Apache-2.0 licence
  and pin the supported runtime to Node 22 LTS; a runtime version file MUST be present
  for version managers.
- **FR-003**: Every TypeScript package MUST extend a shared base configuration with
  `strict`, `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` enabled and
  `any` forbidden by lint.
- **FR-004**: A commit whose message does not follow Conventional Commits MUST be
  refused by a local hook; merge and revert messages generated by the platform MUST be
  accepted.
- **FR-005**: Dependency updates MUST be proposed automatically as pull requests by a
  bot configuration committed to the repository, grouped so that patch and minor
  updates of the same ecosystem arrive together.

Contracts (backlog `T-001-03`):

- **FR-006**: The contracts package MUST define, as runtime-validated schemas with
  inferred static types, the OpenAI-compatible chat completion request and response
  (non-streaming subset), the health response and the error envelope.
- **FR-007**: Every contract schema MUST reject unknown fields and wrong types with an
  error that names the path of the offending field.
- **FR-008**: The chat completion request MUST accept `model`, `messages` (non-empty,
  roles `system` | `user` | `assistant`, string `content`), and optional `temperature`
  in `[0, 2]`, `max_tokens` (positive integer), `stream` (only `false`), `user`; the
  response MUST carry `id`, `object: "chat.completion"`, `created`, `model`,
  non-empty `choices` (`index`, `message`, `finish_reason`), and `usage` with
  `prompt_tokens`, `completion_tokens`, `total_tokens`.
- **FR-009**: The health response MUST carry `status` (`ok` | `degraded`), `version`
  and `uptimeMs`, plus an optional `checks` list of named sub-statuses.
- **FR-010**: The error envelope MUST carry `error.type` from a closed list
  (`invalid_request`, `not_found`, `internal`, `unauthorized`, `rate_limited`,
  `provider_error`, `policy_blocked`), `error.message`, and an optional
  `error.requestId`.
- **FR-011**: `RequestId`, `PolicyId`, `Usd` and `Milliseconds` MUST be branded types
  with constructor functions and runtime schemas, such that values of different brands
  are not assignable to each other and raw primitives are not assignable without the
  constructor.
- **FR-012**: The contracts package MUST have no runtime dependency other than the
  schema library and MUST build to a consumable entry point exporting schemas and
  types.

Gateway skeleton (backlog `T-001-04`):

- **FR-013**: The gateway source MUST be organised in `domain`, `application`,
  `infrastructure` and `presentation` folders plus a `main.ts` composition root, each
  folder containing at least a README and a real module so the architecture rules are
  exercised.
- **FR-014**: The domain MUST provide a `Result<T, E>` type with `ok`/`err`
  constructors and helpers (`isOk`, `isErr`, `map`, `mapErr`, `andThen`,
  `unwrapOr`), and a typed `DomainError` discriminated union with at least
  `ValidationError`, `ConfigurationError` and `NotFoundError` variants.
- **FR-015**: The gateway MUST load its configuration from environment variables
  through a runtime-validated schema; an invalid value (or, once a setting without a
  default exists, a missing one) MUST stop the process before any port is bound, with a
  non-zero exit code and a message listing each invalid variable, never printing secret
  values.
- **FR-016**: The gateway MUST log one JSON object per line through a logger that
  redacts `prompt`, `messages` and `authorization` at the top level, under
  `req.headers` and `body`, and one level deep under any key (`*.prompt`, `*.messages`,
  `*.authorization`), replacing values with a fixed placeholder.
- **FR-017**: The gateway MUST expose `GET /health` returning status 200 and a body
  that validates against the health contract, with the running version and uptime.
- **FR-018**: The gateway MUST attach an `x-request-id` header to every response,
  echoing a well-formed client-supplied value or generating one.
- **FR-019**: Unknown routes MUST return 404 with an error envelope of type
  `not_found`; unhandled exceptions MUST return 500 with an error envelope of type
  `internal` and no stack trace in the body.
- **FR-020**: Starting the gateway with a valid environment MUST serve `/health` over
  HTTP on the configured host and port and log one startup line with address and
  version.

Architecture limits and CI (backlog `T-001-05`):

- **FR-021**: An automated architecture check MUST enforce: `domain` imports nothing
  outside `domain`; `application` imports only `application` and `domain`;
  `infrastructure` imports `infrastructure`, `application`, `domain` and workspace
  packages; `presentation` imports `presentation`, `application`, `domain` and
  `packages/contracts`; only `main.ts` imports `infrastructure`.
- **FR-022**: A violation MUST fail the check with the offending file, the target and
  the rule name; a compliant tree MUST pass with zero violations.
- **FR-023**: A pipeline MUST run on every pull request and on pushes to `main`,
  executing lint, typecheck, architecture check, tests and build in that order, on
  Node 22, failing fast at the first failing step and publishing a single required
  status.
- **FR-024**: The `main` branch MUST be protected so that direct pushes are refused and
  a pull request can only be merged when the pipeline status is green.

Test utilities (backlog `T-001-06`):

- **FR-025**: The test utilities package MUST provide a fake clock implementing the
  application clock port, fixed at a chosen instant and advanced only explicitly, and
  builders that produce valid chat completion requests and health responses with
  per-field overrides.
- **FR-026**: A single root command MUST run the tests of every workspace package and
  produce a coverage summary; test files MUST never reach the network or the file
  system beyond fixtures.

### Key Entities

- **ChatCompletionRequest / ChatCompletionResponse**: the OpenAI-compatible contract
  (non-streaming subset) that every client of Tamiz speaks. Attributes listed in
  FR-008.
- **HealthResponse**: the liveness contract (`status`, `version`, `uptimeMs`,
  optional `checks`).
- **ErrorEnvelope**: the single error shape of every endpoint (`error.type`,
  `error.message`, optional `error.requestId`).
- **Branded identifiers and units**: `RequestId`, `PolicyId` (identity), `Usd`,
  `Milliseconds` (units). Distinct nominal types over primitives.
- **Result<T, E> and DomainError**: how the domain expresses success and typed failure
  without exceptions.
- **GatewayConfig**: the validated set of environment-derived settings (`PORT`, `HOST`,
  `LOG_LEVEL`, `NODE_ENV`, `APP_VERSION`).
- **ClockPort / FakeClock**: how time enters the application and how tests control it.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A reviewer with a fresh clone can go from install to all checks green
  (lint, typecheck, architecture, tests, build) in under 5 minutes of wall-clock time on
  a laptop and under 10 minutes in the hosted pipeline.
- **SC-002**: 100 % of the acceptance scenarios in this spec have a matching automated
  test or pipeline step, named after the scenario, and all of them pass on `main`.
- **SC-003**: A deliberate layering violation is caught in 100 % of attempts by the
  local check and by the pipeline, with the offending file named in the output.
- **SC-004**: 100 % of invalid chat completion requests in the contract test corpus
  (unknown field, wrong type, empty messages, bad role, streaming flag) are rejected,
  and 100 % of valid samples are accepted.
- **SC-005**: Zero sensitive values (`prompt`, `messages`, `authorization`) appear in
  captured log output across the logger test corpus.
- **SC-006**: Zero direct pushes to `main` and zero merges with a red pipeline are
  possible once branch protection is configured (verified by one refused attempt).
- **SC-007**: The health endpoint answers in under 50 ms in-process and under 200 ms
  over HTTP on a laptop, so that it is safe to poll every few seconds.

## Assumptions

- The stack is the one fixed by `CLAUDE.md` section 4 and the constitution; the spec
  does not re-decide tools, it only states observable behaviour. The plan maps each
  requirement to the chosen tool.
- Only the non-streaming subset of the chat completion contract is defined here.
  Streaming (`stream: true`, chunk objects) arrives with feature 003 and extends the
  schema instead of replacing it.
- The chat completion contract follows the public OpenAI shape for the fields listed in
  FR-008; fields outside that list (tools, response format, logprobs, multimodal
  content parts) are out of scope and therefore rejected as unknown until a later
  feature adds them.
- `GET /health` is unauthenticated. API-key authentication arrives with feature 002.
- `status: "degraded"` and `checks` are defined in the contract now so that features
  006 and OPS do not change the shape, but the skeleton always reports `ok`.
- The application version reported by `/health` comes from the gateway package
  manifest, overridable by an `APP_VERSION` environment variable for container builds.
- Branch protection is configured on the hosting platform by the maintainer during
  `T-001-05`, with the pipeline as the single required status check; it was deferred
  from `T-OPS-00` because the pipeline did not exist yet.
- The dependency-update bot runs on the hosting platform and needs an app installation
  by the maintainer; the committed configuration is the deliverable, the installation
  is a one-time manual step.
- `packages/tsconfig` has no tests; `pnpm test` reports it as having no test step.
- The `evals` and `docker build` stages of the constitution's pipeline are added by
  features 007 and OPS respectively; this feature leaves clearly named placeholders in
  the pipeline for them.
- Developer machine note from `T-000-01`: Node 24 is installed locally while the project
  targets Node 22; the runtime version file plus `engines` make the mismatch visible
  rather than silently accepted.
