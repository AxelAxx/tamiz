# Feature Specification: MCP Server and Agent

**Feature Branch**: `009-mcp-agent`

**Created**: 2026-10-31

**Status**: Approved (reviewed by Alex on 2026-10-31)

**Input**: User description: "009-mcp-agent: apps/mcp-server exposes four read-only MCP tools over the gateway admin API (simulate_routing, query_audit_log, get_cost_report, get_provider_health) with input/output schemas from @tamiz/contracts, per-tool permissions, stdio and streamable HTTP transports, admin-key handling, and a dogfooding agent (AI SDK 6 + MCP client) whose LLM calls go through Tamiz and answers 'why did spend rise yesterday?'; tests with an in-process MCP client and a fake gateway; README config for Claude Desktop and Claude Code. Backlog T-009-02 … T-009-04."

**Backlog**: `T-009-01` (this spec), `T-009-02` … `T-009-04` (implementation). See
`docs/tasks/BACKLOG.md`, section "Day 12".

**Builds on**: features 005 (`POST /v1/simulate`), 006 (`GET /v1/admin/audit`,
`/v1/admin/cost`, `/v1/admin/providers`, API key roles), 002 and 003 (the OpenAI-compatible
endpoint the agent calls, the `pinned-local` rule). **Feeds**: `T-OPS-01` (the server in
the compose stack, optional), `T-DOC-01` (README section and demo).

**Scope note**: in the roadmap's cut order the MCP agent is the first thing to cut. This
spec keeps the feature lean: four read-only tools, two transports, one agent with one demo
question. Nothing here changes the gateway.

## Purpose

Operators already have the answers Tamiz can give: what a request would do (simulation),
what happened (audit log), what it cost (cost report) and how providers are doing (provider
health). Today they get them through HTTP calls or, soon, the dashboard. Teams that work in
an AI assistant (Claude Desktop, Claude Code, any MCP host) want to ask those questions in
their own words. This feature exposes the four capabilities as MCP tools, with the tools
read-only and individually switchable, the admin key held only by the server, and a small
agent that answers operational questions while making its own LLM calls **through Tamiz**:
the gateway audits, routes and protects its own operator tooling.

## User Scenarios & Testing *(mandatory)*

Scenario ids (`US1-1`, …) are the test names: every scenario maps to one automated test,
except `US5-6`, which is the recorded demo run (`tasks.md` coverage table).

### User Story 1 - An operator asks an AI assistant what Tamiz would do and how providers are doing (Priority: P1)

An operator connects the Tamiz MCP server to their assistant and asks "where would this
request go?" or "is any provider failing right now?". The assistant discovers the tools,
calls `simulate_routing` or `get_provider_health`, and gets the gateway's own answer in a
structured, validated form.

**Why this priority**: It is the smallest end-to-end slice (backlog `T-009-02`): a server,
two tools, the contracts and the error handling every other tool reuses.

**Independent Test**: Connect an in-process MCP client to the server, with a fake gateway
behind it; list the tools, call both, and validate every result against the shared
contracts.

**Acceptance Scenarios**:

1. **Given** the server with the default configuration, **When** a client lists the tools,
   **Then** it sees `simulate_routing`, `query_audit_log`, `get_cost_report` and
   `get_provider_health`, each with a description, an input schema, an output schema, and
   marked read-only.
2. **Given** a text that contains a DNI, **When** `simulate_routing` is called with it,
   **Then** the result is the gateway's simulation (sensitivity, entity kinds and positions,
   rule, task type, decision, privacy action, chain) and validates against the simulation
   contract.
3. **Given** a text, or a list of messages, and an optional requested model, **When**
   `simulate_routing` is called, **Then** the gateway receives exactly those messages (a
   text becomes one user message) and that model (the server's default model when none is
   given).
4. **Given** a window in minutes, or none, **When** `get_provider_health` is called,
   **Then** the result lists every declared target with its circuit state and window
   statistics, validates against the provider health contract, and uses 15 minutes when no
   window is given.
5. **Given** input outside a tool's schema (an empty text, a window of 0), **When** the tool
   is called, **Then** the call is rejected as invalid input and the gateway receives
   nothing.
6. **Given** the gateway is unreachable, does not answer within the server's timeout, or
   answers outside its contract, **When** any tool is called, **Then** the result is a tool
   error that names the cause (`gateway_unreachable`, `gateway_timeout`,
   `gateway_contract`), never a partial or unvalidated result.

---

### User Story 2 - An administrator decides which tools are exposed, and the key stays with the server (Priority: P1)

An administrator installs the server for a wider team. They choose which tools are
exposed (for example simulation and provider health, but not the audit log), and they need
certainty that no tool changes anything in the gateway and that the admin key never reaches
the assistant or its model.

**Why this priority**: Permission per tool and read-only defaults are the feature's privacy
promise (foundational document, section 4.6); the audit log is operator metadata that not
every assistant user should see.

**Independent Test**: Start the server with different tool allowlists and keys against a
fake gateway that records every request; inspect the tool list, the results, the errors
and the logs.

**Acceptance Scenarios**:

1. **Given** a configuration that enables only `simulate_routing` and
   `get_provider_health`, **When** a client lists the tools, **Then** only those two are
   listed; **and when** it calls `query_audit_log`, **Then** the call fails as an unknown
   tool and the gateway receives nothing.
2. **Given** a configuration that names a tool that does not exist, **When** the server
   starts, **Then** it refuses to start and names the unknown tool.
3. **Given** every tool is called, **When** the fake gateway's requests are inspected,
   **Then** they are only `GET /v1/admin/*` and `POST /v1/simulate` (which never calls a
   provider), and every tool is annotated read-only and idempotent.
4. **Given** the local-process transport, **When** the server runs, **Then** it reads the
   gateway key from its own environment only; the key appears in no tool list, tool input,
   tool result, error message or log line.
5. **Given** the local-process transport and no gateway key configured, **When** the server
   starts, **Then** it refuses to start and says which variable is missing.
6. **Given** the gateway answers `401` or `403` (an invalid key, or a client key used for an
   admin tool), **When** the tool is called, **Then** the result is a tool error
   (`gateway_unauthorized` or `gateway_forbidden`) that says the key is invalid or lacks the
   admin role, without the key.
7. **Given** the gateway answers `400` (for example `from` not before `to`), **When** the
   tool is called, **Then** the result is a tool error (`gateway_rejected`) carrying the
   gateway's error message.

---

### User Story 3 - An operator investigates traffic and spend from the assistant (Priority: P1)

An operator asks "show me last night's blocked requests with a DNI" or "what did we spend
per route this week?". The assistant calls `query_audit_log` with filters, pages through the
results, and calls `get_cost_report` grouped by day, route or model.

**Why this priority**: These two tools carry the demo question and most of the value
(backlog `T-009-03`); the audit log is the data no other tool can reach.

**Independent Test**: Same harness as US1 with a fake gateway serving audit pages and cost
reports.

**Acceptance Scenarios**:

1. **Given** filters (date range, route, rule, sensitivity, privacy action, entity kind,
   outcome), **When** `query_audit_log` is called, **Then** the gateway receives exactly
   those filters and the result is a page of entries, newest first, with a next cursor,
   validating against the audit page contract.
2. **Given** the next cursor of a previous page, **When** `query_audit_log` is called with
   it, **Then** the result is the following page as the gateway returns it.
3. **Given** no page size, **When** `query_audit_log` is called, **Then** it asks the gateway
   for 20 entries; **and given** a page size above 50, **Then** the call is rejected as
   invalid input.
4. **Given** a date range and a grouping (day, route or model, default day), **When**
   `get_cost_report` is called, **Then** the result has the rows, the baseline, the
   requests not served and the totals, validating against the cost report contract.
5. **Given** any audit or cost result, **When** it is returned, **Then** it contains only
   the fields of the contracts, which hold no message text, detected values or answers;
   a gateway answer with an extra field is a `gateway_contract` error.

---

### User Story 4 - A developer connects the server from Claude Desktop, Claude Code or over HTTP (Priority: P2)

A developer adds Tamiz to Claude Desktop or Claude Code with the snippet in the README
(the host starts the server as a local process), or a team runs one shared server over HTTP
where each user brings their own Tamiz admin key.

**Why this priority**: Without a working connection recipe nobody uses the tools; HTTP is
the shared-deployment option, secondary for a portfolio demo.

**Independent Test**: Start the built server as a child process and over HTTP against a
fake gateway; connect a client through each transport; check the README snippets.

**Acceptance Scenarios**:

1. **Given** the built server started as a local process with the gateway URL and key in its
   environment, **When** a client connects over standard input and output, **Then** it can
   list and call tools, and the server writes nothing but protocol messages to its standard
   output (logs go to standard error).
2. **Given** the HTTP transport, **When** a client sends a request with
   `Authorization: Bearer <Tamiz key>`, **Then** the server uses that key for the gateway
   calls of that request only, and tools work as over the local transport.
3. **Given** the HTTP transport, **When** a request has no bearer token, **Then** the server
   answers `401` before any tool runs and the gateway receives nothing.
4. **Given** the HTTP transport on its default local address, **When** a request carries a
   `Host` or `Origin` that is not local, **Then** the server answers `403` (DNS rebinding
   protection).
5. **Given** two HTTP clients with different keys calling tools at the same time, **When**
   the gateway requests are inspected, **Then** each carries its own client's key.
6. **Given** the README, **When** its configuration snippets are checked, **Then** the
   Claude Desktop snippet is valid JSON that starts the built server with the documented
   environment variables, and the Claude Code snippet adds the same server; both use
   placeholders, never a real key.

---

### User Story 5 - The agent answers "why did spend rise yesterday?" through Tamiz (Priority: P2)

An operator runs the bundled agent with a question. The agent discovers the tools from the
MCP server, asks its model (through the Tamiz gateway, on the local route) which tool to
call, calls it, and answers with the cause and the numbers. Every LLM call the agent makes
is a normal gateway request: inspected, routed, audited.

**Why this priority**: It is the dogfooding demo (backlog `T-009-04`) and the first thing to
cut if late; the tools are useful without it.

**Independent Test**: Run the agent against the in-process MCP server and a fake gateway
that serves both the admin endpoints and scripted chat completions; check the tool calls,
the requests to the gateway and the final answer.

**Acceptance Scenarios**:

1. **Given** a fixed date and cost data where yesterday's spend is twice the day before's
   because one route grew, **When** the agent is asked "why did spend rise yesterday?",
   **Then** it calls `get_cost_report` for those days (by day, then by route or model), and
   its answer names that route and the two amounts from the tool results.
2. **Given** the agent runs, **When** the requests to the fake gateway are inspected,
   **Then** every LLM call is a `POST /v1/chat/completions` with the agent's client key and
   the configured model (default `tamiz-local`, the gateway's local-only rule), and each
   body validates against the chat completion contract; the agent holds no provider key.
3. **Given** the model asks for a tool that is not listed, or gives arguments outside its
   schema, or answers in a format the agent cannot read, **When** the agent handles it,
   **Then** it sends the error back to the model as an observation and continues; **and
   when** the step limit (6 model calls) is reached, **Then** it stops with an explicit
   "could not answer" result.
4. **Given** the gateway blocks or fails an LLM call, **When** the agent receives the error,
   **Then** it stops with the gateway's error type and request id, and never calls a
   provider directly.
5. **Given** a run, **When** it finishes, **Then** the agent's result records the system
   prompt version, the tools called with their arguments, the request ids of its LLM calls
   and the final answer; the system prompt is a versioned file and states the current UTC
   date from the agent's clock.
6. **Given** the demo script against a running gateway with the default policy, **When** it
   asks the spend question, **Then** it answers using `get_cost_report`, and each of its LLM
   calls appears in the audit log with rule `pinned-local` and a local target (recorded in
   the `T-009-04` task record).

---

### Edge Cases

- **Simulation text typed into a cloud-hosted assistant**: the text reaches the
  assistant's own model before the tool runs, which Tamiz cannot prevent. The README says
  to simulate with synthetic text, or from a local host or the bundled agent.
- **Large audit pages**: the tool's page size is capped at 50 so a result fits an
  assistant's context; the operator pages with the cursor.
- **Dates**: the tools take ISO 8601 date-times with an offset, as the admin contracts do;
  cost days are UTC, and the agent's prompt states the UTC date so "yesterday" is a UTC day.
- **A client key with admin tools enabled**: the server does not probe the key at start
  (the gateway may be down when a host launches it); each admin tool call returns
  `gateway_forbidden`, and the README says to disable admin tools for client keys.
- **Gateway restarts mid-session**: each tool call is independent; a failed call is a tool
  error and the next one may succeed.
- **A model that wraps its action in prose or code fences**: the agent extracts the first
  JSON object; anything else is a format error observation (US5-3).
- **Tool results sent to the agent's model**: they are metadata (kinds, counts, costs,
  targets), and they travel through the gateway like any prompt, so the gateway inspects
  them; with `tamiz-local` they never leave the machine.

## Requirements *(mandatory)*

### Functional Requirements

Server and first two tools (backlog `T-009-02`):

- **FR-001**: The server MUST offer the tools `simulate_routing`, `query_audit_log`,
  `get_cost_report` and `get_provider_health`, each with a description, an input schema and
  an output schema derived from the shared contracts. Each result MUST carry the structured
  value, validated against the output schema, and a text rendering of it.
- **FR-002**: Every tool MUST be read-only: it MUST only call the gateway's simulation
  endpoint or its admin read endpoints, and MUST be annotated read-only, idempotent and
  closed-world.
- **FR-003**: The exposed tools MUST be configurable as an allowlist, defaulting to all four.
  A disabled tool MUST NOT be listed and MUST NOT be callable; an unknown name in the
  allowlist MUST stop the server at start.
- **FR-004**: The server MUST offer the same tools over two transports: a local process
  (standard input and output) and streamable HTTP. On the local transport, standard output
  MUST carry only protocol messages.
- **FR-005**: On the local transport the gateway key MUST come from the server's
  environment, and the server MUST refuse to start without it. On HTTP the key MUST come
  from each request's bearer token, be used for that request only and never be stored. The
  key MUST NOT appear in tool inputs, results, error messages or logs.
- **FR-006**: The HTTP transport MUST bind to a local address by default, MUST validate the
  `Host` and `Origin` headers against the configured hosts, and MUST answer `401` to a
  request without a bearer token before running any tool.
- **FR-007**: Gateway failures MUST become tool errors with a stable code:
  `gateway_unreachable`, `gateway_timeout` (configurable, default 10 s),
  `gateway_unauthorized` (401), `gateway_forbidden` (403), `gateway_rejected` (other 4xx,
  with the gateway's message), `gateway_error` (5xx) and `gateway_contract` (a body that
  does not validate). A tool MUST never return unvalidated data.
- **FR-008**: `simulate_routing` MUST take either a text or a list of chat messages, and an
  optional requested model, and return the gateway's simulation.
- **FR-009**: `get_provider_health` MUST take an optional window in minutes (1 … 1440,
  default 15) and return the gateway's provider health report.

Audit and cost tools, README (backlog `T-009-03`):

- **FR-010**: `query_audit_log` MUST take the admin audit filters (date range, route, rule,
  sensitivity, privacy action, entity kind, outcome), a cursor and a page size (1 … 50,
  default 20), and return the gateway's audit page.
- **FR-011**: `get_cost_report` MUST take a date range and a grouping (day, route or model,
  default day) and return the gateway's cost report.
- **FR-012**: The server's README MUST give a Claude Desktop configuration and a Claude Code
  command for the local transport, and the HTTP usage, with placeholder keys, the
  environment variables, how to choose the tools, and the simulation-text caveat.

Agent (backlog `T-009-04`):

- **FR-013**: The agent MUST connect to the MCP server as an MCP client and use only the
  tools it lists.
- **FR-014**: Every LLM call of the agent MUST go to the gateway's chat completion endpoint
  with the agent's own client key and a configurable model, default `tamiz-local`; the agent
  MUST NOT hold provider keys or call providers.
- **FR-015**: Because the gateway's chat completion contract carries text messages only,
  the model MUST choose tools by answering in a fixed text format (one JSON object: a tool
  call or a final answer). The agent MUST validate a tool call against that tool's input
  schema, send any error back as an observation, and stop after 6 model calls with an
  explicit "could not answer" result.
- **FR-016**: The system prompt MUST be a versioned file, and the agent MUST give it the
  current UTC date from an injectable clock. A run's result MUST record the prompt version,
  the tools called with their arguments, the request ids of the LLM calls and the answer.
- **FR-017**: A gateway error on an LLM call MUST stop the run with the error type and
  request id.
- **FR-018**: A command-line demo MUST run the agent on a question against configured
  server and gateway URLs and print the answer and the run record.

### Key Entities

- **Tool**: a name, a description, an input schema, an output schema, read-only annotations
  and the gateway call it makes.
- **Tool allowlist**: the configured set of exposed tools.
- **Gateway credential**: the Tamiz API key the server uses (from its environment) or
  forwards (from each HTTP request); never part of any tool data.
- **Tool error**: a stable code and a message, returned as the tool's result.
- **Agent step**: one model call through the gateway and, when the model asks for one, one
  tool call with its observation.
- **Agent run**: the question, the steps, the request ids, the prompt version and the final
  answer or the reason it stopped.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A developer following only the README connects the server to Claude Desktop
  or Claude Code and gets a provider health answer in under 5 minutes.
- **SC-002**: 100 % of tool results in the tests validate against the shared contracts, and
  0 calls reach the gateway for disabled tools or invalid input.
- **SC-003**: The gateway key appears 0 times in tool lists, results, errors and logs across
  the test suite.
- **SC-004**: The demo answers "why did spend rise yesterday?" with the cause and the two
  amounts in at most 6 model calls, and 100 % of its LLM calls appear in the audit log on
  the local route.
- **SC-005**: A tool adds less than 100 ms to the gateway's own response time on a developer
  machine.
- **SC-006**: 100 % of the acceptance scenarios have a matching automated test or, for
  `US5-6`, a recorded demo run.

## Assumptions

- **No gateway change.** The four gateway endpoints exist and are stable (features 005 and
  006). `POST /v1/simulate` accepts admin keys as well as client keys, so one admin key
  serves all four tools.
- **Read-only is the whole feature.** No tool writes anything; a future write tool (for
  example a policy change) needs its own spec and must default to disabled.
- **The agent's tool protocol is text-based.** The gateway's chat completion contract
  rejects `tools` and tool messages today. Adding native tool calling to the gateway would
  touch the contracts, every provider adapter and the privacy inspection of tool messages,
  which is far beyond a lean feature; it is proposed as a separate backlog task.
- **The agent runs on the local route.** With the default policy, the model `tamiz-local`
  matches the `pinned-local` rule, so the agent's prompts and the tool results it sends never
  leave the machine. A small local model may need the format corrections of US5-3; the demo
  records the model used.
- **The MCP server is not an MCP-level OAuth authorization server.** On HTTP the Tamiz API
  key is the bearer credential and the gateway decides what it may read; MCP authorization
  discovery is out of scope.
- **Hosting**: the server runs on the operator's machine or next to the gateway; adding it
  to the compose stack is optional in `T-OPS-01`.
