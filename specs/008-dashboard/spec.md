# Feature Specification: Dashboard

**Feature Branch**: `008-dashboard`

**Created**: 2026-10-31

**Status**: Approved (reviewed by Alex on 2026-10-31)

**Input**: User description: "008-dashboard: the Tamiz operator dashboard (apps/dashboard, Next.js 16). Screens: live traffic (polls GET /v1/admin/audit), policy simulator (POST /v1/simulate, shows entities, rule, taskType, size, action, chain), audit log (filters + keyset cursor), cost analytics (GET /v1/admin/cost vs all-frontier baseline), provider health (GET /v1/admin/providers), eval results (EvalReportSchema, CI artifact evals-report), policy editor (new GET/PUT /v1/admin/policy with Zod validation and version bump). Admin key held server-side only, never sent to the browser. Accessibility basics, Playwright flows, Given/When/Then mapping 1:1 to tests. Includes a Claude Design brief (design-brief.md) and an explicit design-received gate before UI tasks. Backlog T-008-02 … T-008-09."

**Backlog**: `T-008-01` (this spec), `T-008-02` … `T-008-11` (implementation; `T-008-10` is
the design gate and `T-008-11` the provider health screen, both added by this spec). See
`docs/tasks/BACKLOG.md`, section "Days 9-11".

**Builds on**: features 002 (policy file, targets, pricing), 005 (`POST /v1/simulate`), 006
(audit entry, `GET /v1/admin/audit`, `/cost`, `/providers`, admin keys), 007 (the eval report
contract and the `evals-report` CI artifact). **Feeds**: `T-DOC-02` (the simulator GIF),
`T-OPS-01` (the dashboard container in the full stack).

**Design**: screens are not designed in this spec or in code. [`design-brief.md`](design-brief.md)
is the component inventory that Alex takes to Claude Design; the design that comes back is
the visual source of truth, and no screen is implemented before it is received (`tasks.md`,
gate `G1`).

## Purpose

The gateway already decides, audits and measures everything a regulated team needs to see,
but only through JSON endpoints and a CI artifact. An operator who wants to know "where did
the request with a DNI go?", "what would happen if someone pasted this text?", "how much are
we saving?" or "are the privacy evals still green?" has to write `curl` commands with an
admin key. The dashboard turns those endpoints into a small operator console, and it is the
project's demo surface: the policy simulator is the README GIF.

Two constraints shape every screen:

1. **The dashboard never sees what was said.** It shows what the audit log holds (kinds,
   counts, routes, costs), never prompt or answer content, because none exists by contract.
   The only text it handles is what the operator types into the simulator, which stays in
   that browser tab.
2. **The admin key never reaches the browser.** The dashboard's own server holds it and
   calls the gateway; the browser talks only to the dashboard, behind an operator sign-in.

## User Scenarios & Testing *(mandatory)*

Scenario IDs (`US<story>-<n>`) are cited by the tests: each scenario has an automated test
whose title starts with its id (`tasks.md`, "Scenario coverage"). A scenario that spans the
gateway and the browser (US5) has one test on each side.

### User Story 1 - The operator signs in and the admin key stays on the server (Priority: P1)

An operator opens the dashboard, signs in with the operator passphrase, and works with every
screen. The admin key that the gateway requires is used only by the dashboard's server; it is
never in a page, a script, a cookie, a network response or the browser's storage.

**Why this priority**: Every screen reads admin data. Without this boundary, deploying the
dashboard would publish the admin key.

**Independent Test**: Start the dashboard against a fake gateway that records the headers it
receives; sign in, visit every screen, and search everything the browser received for the key.

**Acceptance Scenarios**:

1. **Given** a visitor without a session, **When** they open any dashboard page or call any
   dashboard data endpoint, **Then** pages redirect to the sign-in page and data endpoints
   answer `401` without calling the gateway.
2. **Given** the sign-in page, **When** the operator enters the right passphrase, **Then**
   they land on the live traffic screen and the session lasts at most 8 hours; **When** the
   passphrase is wrong, **Then** the page says so without revealing whether a passphrase is
   configured, and after 5 failures in a minute from the same address further attempts are
   refused for a minute.
3. **Given** a signed-in operator who visits every screen and runs a simulation and a policy
   save, **When** every response body, header, cookie and storage entry the browser received
   is searched, **Then** the admin key appears nowhere, and the fake gateway received it on
   every call as `Authorization: Bearer <key>`.
4. **Given** a signed-in operator, **When** they sign out, **Then** the session ends and the
   next data request answers `401`.
5. **Given** a state-changing dashboard request (simulate, save policy, sign out) sent from
   another origin, **When** it reaches the dashboard, **Then** it is refused with `403` and
   nothing reaches the gateway.
6. **Given** the dashboard's configuration lacks the gateway address, the admin key, the
   passphrase hash or the session secret, or any of them is malformed, **When** it starts,
   **Then** it refuses to start and lists every problem, never printing a secret.

---

### User Story 2 - Live traffic shows each request as it is decided (Priority: P1)

The operator keeps the live traffic screen open and sees each request appear as a new row:
when it started, which client sent it, which rule matched, the sensitivity, the detected
entity kinds with counts, the privacy action, the route it took (residency badge and target),
whether it fell back, the outcome, the latency and the cost.

**Why this priority**: This is the first screen of the demo and the most direct proof that
routing follows the data: a request with a DNI appears with a `local` badge.

**Independent Test**: With a fake gateway, add audit entries while the screen is open and
check that each appears once, newest first, with the right badges, and that no content field
is ever shown.

**Acceptance Scenarios**:

1. **Given** the screen is open, **When** a new audit entry is recorded, **Then** it appears
   as the top row within 5 seconds, highlighted briefly, with its residency badge (`local`,
   `eu`, `us`, `global`), target id, rule, action and one chip per detected kind with its
   count.
2. **Given** an entry whose request was answered after one or more targets were abandoned,
   **When** it is shown, **Then** the row carries a visible fallback marker that names the
   abandoned targets and reasons on hover or focus.
3. **Given** a blocked or failed entry, **When** it is shown, **Then** the row says `blocked`
   (with the block reason) or `failed` (with the error type) instead of a route badge, and its
   cost is shown as zero.
4. **Given** the operator pauses the stream, **When** new entries arrive, **Then** the rows
   stay still, a counter shows how many new entries are waiting, and resuming adds them in
   order without duplicates.
5. **Given** an entry that finishes after a later-started entry was already shown, **When**
   it is recorded, **Then** it still appears, in start-time order, and no entry ever appears
   twice.
6. **Given** the gateway stops answering, **When** a poll fails, **Then** the screen keeps
   the rows it has, shows a "disconnected, retrying" status with the time of the last
   successful update, and recovers on its own when the gateway is back.
7. **Given** any audit entry, **When** its row and detail are rendered, **Then** the page
   shows no message text, answer text or detected value, and the request is identified only
   by its request id and the first characters of its request hash.
8. **Given** the operator activates a row, **When** the detail opens, **Then** it shows
   every field of the entry (times, policy id and version, task type and size, usage and
   whether it was estimated, baseline cost and target, abandoned targets) and a link to the
   audit log filtered to that request's rule.

---

### User Story 3 - The policy simulator shows what the gateway would do with a text (Priority: P1)

The operator pastes a text (for example a summary request containing a DNI and a name),
optionally a system message and a requested model, and runs the simulation. The screen
highlights each detected entity in the text, shows the sensitivity, the classification (task
type and size), the matched rule, the privacy action, the decision and the ordered chain of
targets with their residencies; for `anonymize` it shows exactly what a provider would
receive, placeholders and notice included. No model is called.

**Why this priority**: It is the README GIF and the fastest way to understand a policy.

**Independent Test**: With a fake gateway that answers fixed simulations, submit texts and
check the highlighted spans, the decision summary and the inline validation messages.

**Acceptance Scenarios**:

1. **Given** a text with a valid DNI, **When** the operator simulates it with the default
   policy, **Then** the DNI's span is highlighted and labelled `DNI`, the sensitivity is
   `critical`, the action is `restrict_to_local`, and the chain shows only local targets.
2. **Given** a text with a name and an email that the policy anonymizes, **When** it is
   simulated, **Then** the outcome is `anonymize`, both spans are highlighted, and the
   "provider receives" panel shows the notice and the text with `<PERSON_1>` and `<EMAIL_1>`
   placeholders, exactly as the gateway returned them.
3. **Given** a text the policy blocks (or a detector outage with `onDetectorError: block`),
   **When** it is simulated, **Then** the decision is `block`, the block reason is shown in
   words, the chain is empty, and a detector outage says the gateway would fail closed.
4. **Given** an empty text, a text over the gateway's body limit or a requested model that is
   blank, **When** the operator submits, **Then** the form shows the error next to the field
   and sends nothing.
5. **Given** several messages (system and user), **When** they are simulated, **Then** each
   entity is highlighted in the message it was found in, at its exact offsets, including texts
   with accents and emoji.
6. **Given** the operator ran a simulation, **When** they leave the screen or reload it,
   **Then** the text is gone: it was never put in the address bar, browser storage, the
   dashboard's logs or any analytics.
7. **Given** a simulation result, **When** the operator looks at the decision flow, **Then**
   it reads in order: inspection (sensitivity, detector status) → classification (task type,
   size) → rule → privacy action → chain, and the step that decided a block is marked.

---

### User Story 4 - The audit log answers "what happened to requests like this?" (Priority: P1)

The operator filters the audit log by date range, route, rule, sensitivity, privacy action,
detected entity kind and outcome, sees a table of matching entries newest first, and loads
older pages until there are none.

**Why this priority**: It is the auditor's view and the evidence behind every other screen.

**Independent Test**: With a fake gateway holding a known set of entries, apply filters and
page through; compare the rows with the expected subset.

**Acceptance Scenarios**:

1. **Given** entries routed to several targets, **When** the operator filters by one route,
   **Then** only entries whose answering (or last failed) target is that route are listed.
2. **Given** more matching entries than one page, **When** the operator asks for older
   entries, **Then** the next page is appended with no repeated and no skipped entry, and when
   there are no more the control says so and is disabled.
3. **Given** filters set, **When** the operator copies the address and opens it elsewhere
   (signed in), **Then** the same filters are applied; the address holds only filter values
   (enums, ids, dates), never content.
4. **Given** filters that match nothing, **When** the table loads, **Then** it shows an empty
   state that names the active filters and offers to clear them.
5. **Given** a date range whose start is after its end, **When** the operator applies it,
   **Then** the form shows the error next to the date fields and sends nothing.
6. **Given** a page of entries, **When** the operator reads the table with a keyboard or a
   screen reader, **Then** the table has column headers, each row
   can be focused, and activating it opens the same detail as in live traffic (US2-8).

---

### User Story 5 - The policy editor changes routing safely (Priority: P2)

The operator opens the active policy, edits it as YAML, sees validation problems with their
path while typing, and saves. The gateway checks the policy again, gives it the next version
number and starts using it for new requests and simulations at once. A save that would break
the gateway is refused with the reason, and two operators cannot overwrite each other.

**Why this priority**: Editing a policy is the step after understanding it; the gateway
already validates policy files at boot, so this extends a proven check to runtime.

**Independent Test**: Gateway contract tests for reading and replacing the policy; a browser
flow that saves an invalid then a valid policy and simulates with it.

**Acceptance Scenarios**:

1. **Given** the editor opens, **When** the active policy loads, **Then** it is shown as YAML
   with its id, version, where it came from (file or saved version), when it was saved and by
   which admin, and whether saves survive a restart.
2. **Given** a policy with a shape error (unknown key, wrong enum, missing required section),
   **When** the operator types it, **Then** within a second the editor lists each issue with
   its path (for example `rules.2.route.0`) and the save control is disabled.
3. **Given** a policy whose shape is valid but whose cross-field rules fail (a chain naming an
   undeclared target, a duplicate rule id, a provider that is not configured on the gateway),
   **When** it is saved, **Then** the gateway refuses it with each issue and its path, the
   editor shows them, and the active policy does not change.
4. **Given** a valid policy, **When** it is saved, **Then** the gateway stores it with
   version = previous version + 1, the editor shows the new version, and the next simulation
   and the next request use it (their audit entries carry the new version).
5. **Given** two operators edited version 4, **When** the second saves after the first,
   **Then** the second save is refused as a conflict, the editor says the policy changed and
   offers to reload, and nothing is overwritten.
6. **Given** a client (non-admin) key, **When** it reads or replaces the policy on the
   gateway, **Then** the gateway answers `403`; without a key, `401`.
7. **Given** a saved policy, **When** the gateway restarts with persistence configured,
   **Then** it boots with the latest saved version; without persistence it boots from the
   file, and the editor had warned that saves were not persisted.
8. **Given** a policy whose `id` differs from the active one, **When** it is saved, **Then**
   it is refused: the editor changes the active policy, it does not switch to another one.

---

### User Story 6 - Eval results show whether the privacy and routing promises still hold (Priority: P2)

The operator opens the evals screen and sees the latest eval run: overall status, when and on
which commit it ran, which policy version and models, and for each eval its status, its
metrics against thresholds (pass or fail), and its failing cases by id. A history lists
earlier runs by policy version.

**Why this priority**: "Proves it works" is the project's fifth promise; the CI report
exists, this makes it visible.

**Independent Test**: Point the dashboard at a folder of report fixtures (passing, failing,
erroring, invalid) and check what the screen shows.

**Acceptance Scenarios**:

1. **Given** a passing report, **When** the screen loads, **Then** each gated metric shows its
   value, comparison and bound with a pass mark (colour plus icon plus word), and the run's
   provenance (start time, duration, git commit, policy id and version, models, datasets).
2. **Given** a report where one metric is below its threshold, **When** the screen loads,
   **Then** that eval and the run show `fail`, the metric shows a fail mark, and its failing
   cases are listed by id, reason, expected and actual, with the total when it exceeds the
   listed cap.
3. **Given** a report with an eval in `error` or `skipped`, **When** the screen loads,
   **Then** the eval shows the error type and service, or the skip reason, and never a pass.
4. **Given** several reports, **When** the history loads, **Then** runs are listed newest
   first with their policy version and status, and selecting one shows it.
5. **Given** a file in the reports folder that is not a valid report, **When** the screen
   loads, **Then** that file is listed as unreadable by name and the valid reports still show.
6. **Given** no reports, **When** the screen loads, **Then** it explains where reports come
   from (the CI artifact `evals-report`) and how to add one.

---

### User Story 7 - Cost analytics shows the saving against "everything to frontier" (Priority: P3)

The operator picks a date range and a grouping (day, route, model) and sees actual spend
against the baseline (the same requests priced on the policy's most expensive target), the
saving in money and percent, tokens, and the requests that were not served.

**Why this priority**: It is the business argument, and the first screen to cut if late (cut
order).

**Independent Test**: With a fake gateway answering a cost fixture, check the chart series,
the totals and the empty and unpriced states.

**Acceptance Scenarios**:

1. **Given** a cost report grouped by day, **When** the screen loads, **Then** a chart shows
   actual and baseline cost per UTC day, and the totals (actual, baseline, saving, saving %,
   requests, tokens) equal the report's totals to the cent.
2. **Given** grouping by route or by model, **When** the operator switches, **Then** the chart
   and a table show one row per route or model with the same totals.
3. **Given** blocked and failed requests in the range, **When** the screen loads, **Then**
   they are shown apart as "not served" with their counts and no cost.
4. **Given** a policy with no priced target (`baseline: null`), **When** the screen loads,
   **Then** the baseline and saving are shown as unavailable with the reason, not as zero.
5. **Given** a range with no requests, **When** the screen loads, **Then** an empty state
   says so for that range.
6. **Given** the chart, **When** it is read with a screen reader or without colour, **Then**
   the same numbers are available as a table and the series are told apart by more than
   colour.

---

### User Story 8 - Provider health shows which targets are failing (Priority: P3)

The operator sees every target the policy declares, including idle ones: its provider, model
and residency, its circuit state now (closed, open with the remaining cool-down, half-open),
and over a window (5, 15 or 60 minutes) its attempts, errors, error rate and p50/p95 latency.

**Why this priority**: It explains fallbacks seen in live traffic; it is small because the
gateway already computes everything.

**Independent Test**: With a fake gateway answering a providers fixture, check states, the
countdown and the window switch.

**Acceptance Scenarios**:

1. **Given** a providers report, **When** the screen loads, **Then** each declared target is a
   row with its circuit state shown by word and icon, and idle targets show zero attempts and
   no latency instead of being hidden.
2. **Given** a target whose circuit is open, **When** it is shown, **Then** its remaining
   cool-down counts down and the row is refreshed at least every 10 seconds.
3. **Given** the operator picks another window, **When** it applies, **Then** the numbers are
   those of the new window and the window is shown in the header.

---

### User Story 9 - Every screen is usable by keyboard, screen reader, both themes and small screens (Priority: P1)

Any operator can use every screen with a keyboard only, with a screen reader, in light or
dark theme, with reduced motion, and on a laptop, a tablet or a phone.

**Why this priority**: Accessibility basics are part of the feature's definition of done;
retrofitting them is more expensive than building them in.

**Independent Test**: An automated accessibility scan and keyboard-only flows over every
screen in both themes and at desktop and mobile widths.

**Acceptance Scenarios**:

1. **Given** each screen in light and dark theme, **When** it is scanned for accessibility,
   **Then** there are no violations of serious or critical impact.
2. **Given** a keyboard only, **When** the operator moves through each screen, **Then** every
   control is reachable in a logical order, focus is always visible, a "skip to content" link
   is first, and dialogs and drawers trap and return focus.
3. **Given** the operator prefers reduced motion, **When** rows arrive or panels open,
   **Then** nothing animates beyond a fade.
4. **Given** live traffic with a screen reader, **When** entries arrive, **Then** the arrival
   is announced politely and at most once every 10 seconds as a count, not row by row.
5. **Given** a theme choice (light, dark, system), **When** the operator changes it, **Then**
   it applies at once, persists across visits and never flashes the other theme on load.
6. **Given** a phone-width screen, **When** any screen is opened, **Then** navigation moves
   to a menu, tables become stacked lists, there is no horizontal page scroll, and every
   action remains available.

---

### Edge Cases

- **The gateway is down or slow**: every screen keeps what it has, shows a non-blocking
  connection status with the last update time, and retries with backoff; nothing shows a raw
  error or stack trace. A gateway error envelope is shown by type and request id.
- **The admin key is revoked or wrong**: the gateway answers `401`/`403` to the dashboard's
  server; the screens say "the dashboard's gateway credentials are not accepted" (an operator
  problem, not a sign-in problem) and do not sign the operator out.
- **A gateway response that does not match the contract** (version skew): the dashboard
  refuses it, shows "unexpected answer from the gateway" with the endpoint, and logs the
  contract issue paths without the body.
- **Very large numbers**: costs below one cent show up to 4 decimals; token counts and
  request counts use grouping separators; latencies above a second show seconds.
- **Clock and time zones**: times are stored and queried in UTC; the screens show them in the
  operator's time zone with the zone visible, and cost days are labelled as UTC days.
- **A policy change while screens are open**: live traffic and the audit log show each
  entry's policy version; the simulator shows the version it simulated with.
- **Simulator text with control characters or very long lines**: shown as typed; highlighting
  never changes the text.
- **Many live entries per second**: the screen keeps the newest 100 rows; older ones are in
  the audit log.
- **Session expiry mid-edit**: a save after expiry asks the operator to sign in again
  without leaving the editor, so the draft (held in that tab's memory, never in storage) is
  not lost, and the save can be retried.

## Requirements *(mandatory)*

### Functional Requirements

Access and boundary (backlog `T-008-02`):

- **FR-001**: The dashboard MUST require an operator sign-in for every page and data endpoint,
  with a session of at most 8 hours, sign-out, and a limit of 5 failed attempts per minute
  per address.
- **FR-002**: The admin key MUST be used only by the dashboard's server when it calls the
  gateway, and MUST NOT appear in any page, script, response, cookie, browser storage or log.
- **FR-003**: The browser MUST reach the gateway only through a fixed list of dashboard data
  endpoints (one per gateway call the screens need), never through a generic proxy.
- **FR-004**: State-changing dashboard requests MUST be refused when they come from another
  origin.
- **FR-005**: The dashboard MUST validate its configuration at start and refuse to start on
  any problem, listing every problem without printing secrets.
- **FR-006**: Every gateway response MUST be checked against the shared contract before it
  reaches a screen; a mismatch is shown as an error, never rendered partially.

Screens (backlog `T-008-03` … `T-008-07`, `T-008-11`):

- **FR-007**: Live traffic MUST show new audit entries within 5 seconds, newest first,
  without duplicates or misses (including entries that finish late), keep at most 100 rows,
  support pause and resume, and show residency, target, rule, sensitivity, entity kinds with
  counts, action, fallback, outcome, latency and cost.
- **FR-008**: The simulator MUST validate its form before sending, call the gateway's
  simulation, highlight each entity at its exact offsets in its message, and show the
  sensitivity, detector status, task type, size, rule, action, decision, block reason, chain
  with residencies and, for `anonymize`, the provider messages and notice.
- **FR-009**: The audit log MUST offer every filter the gateway's audit query supports, keep
  the filters in the address, and load older pages with the gateway's cursor until none
  remain.
- **FR-010**: Cost analytics MUST show actual against baseline cost by day, route or model for
  a chosen range, the saving, tokens and requests not served, and an accessible table of the
  same numbers.
- **FR-011**: Provider health MUST show every declared target with its circuit state,
  remaining cool-down and window statistics for a chosen window, refreshed at least every 10
  seconds.
- **FR-012**: The evals screen MUST read eval reports from a configured folder, validate each
  against the shared report contract, show the latest valid report and a history by policy
  version, and list unreadable files by name.
- **FR-013**: No screen MUST display message content, answer content or detected values from
  the gateway; the only text shown is what the operator typed into the simulator or the
  policy editor in that tab, and the provider messages the simulation returns.
- **FR-014**: Simulator input MUST NOT be written to the address bar, browser storage,
  dashboard logs or analytics.

Policy editing (backlog `T-008-08`):

- **FR-015**: The gateway MUST expose reading the active policy (with its version, source,
  save time, saving admin and whether saves persist) and replacing it, for admin keys only.
- **FR-016**: Replacing the policy MUST run the same validation as boot (shape, cross-field
  rules, configured providers), refuse invalid policies with every issue and its path, refuse
  a different policy id, assign version = previous + 1, and refuse a save based on a version
  that is no longer active as a conflict.
- **FR-017**: A saved policy MUST apply to every request and simulation that starts after the
  save, and the change MUST be recorded (version, admin, time, content hash) in the gateway's
  logs and, when persistence is configured, in a version history the gateway boots from.
- **FR-018**: The editor MUST validate the policy shape in the browser with the same shared
  schema while typing, show issues with their paths, and show the gateway's issues after a
  refused save.

Cross-cutting (backlog `T-008-09`, every screen task):

- **FR-019**: Every screen MUST have a loading, an empty and an error state, as listed in the
  design brief.
- **FR-020**: Every screen MUST meet the accessibility basics of US9 (no serious or critical
  scan violations, keyboard operable, visible focus, reduced motion, polite live
  announcements, information not conveyed by colour alone, contrast in both themes).
- **FR-021**: The dashboard MUST offer light, dark and system themes, persisted per browser.
- **FR-022**: Every acceptance scenario of this spec MUST have an automated test that names
  it; browser flows MUST run in CI against the gateway with fake providers and a fake
  detector.
- **FR-023**: The dashboard MUST ship as a container that runs as a non-root user and joins
  the project's local stack.
- **FR-024**: Screens MUST follow the design received from Claude Design for layout, tokens and
  components; deviations are recorded in the task record of the screen.

### Key Entities

- **Operator session**: who is signed in, since when, until when; holds no gateway credential.
- **Audit entry** (feature 006): what was decided for one request and what it cost; never what
  was said.
- **Simulation** (feature 005): the decision the gateway would take for given messages, with
  entity positions and, for `anonymize`, the provider messages.
- **Cost report** and **provider health report** (feature 006): aggregates over audit entries.
- **Eval report** (feature 007): one run's results with provenance; stored as a file.
- **Policy version**: a routing policy with its version number, source, save time, saving
  admin and content hash.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A request recorded by the gateway appears in live traffic within 5 seconds in
  95 % of cases, and no entry is ever shown twice or missed in a 10-minute run with
  late-finishing requests.
- **SC-002**: From a pasted text, the operator sees the full simulated decision in under 2
  seconds with the fake detector (excluding real detection time).
- **SC-003**: The admin key appears in 0 of the bytes the browser receives across a full
  session that visits every screen (automated search).
- **SC-004**: 0 accessibility violations of serious or critical impact on every screen, in
  both themes, at desktop and mobile widths.
- **SC-005**: An invalid policy never becomes active: 100 % of the policy fixtures that fail
  boot validation are refused at save time with at least one issue path.
- **SC-006**: 100 % of the acceptance scenarios have a matching automated test, and the
  browser flows run green in CI in under 10 minutes.
- **SC-007**: Every screen matches the received design's layout and components, as checked by
  Alex on the pull request of each screen.

## Assumptions

- **One operator role.** Everyone who signs in is an admin of this gateway; there are no
  read-only operators in this feature. The sign-in is a shared operator passphrase (stored
  hashed in the dashboard's configuration), suited to a small team self-hosting the gateway;
  single sign-on is out of scope.
- **One gateway instance per dashboard** for policy edits: a saved policy applies to the
  instance that stored it, and to others only when they restart from the shared history.
  Multi-instance live reload is out of scope.
- **Live traffic polls** the audit query; no push channel is added to the gateway.
- **Eval reports reach the dashboard as files** (the CI artifact `evals-report` downloaded
  into the configured folder, or a committed snapshot for the demo); the gateway serves no
  eval data.
- **The route badge is the answering target's residency** (`local`, `eu`, `us`, `global`).
  The backlog's wording `local`/`eu`/`frontier` predates residencies; "frontier" is a model
  tier, not a place, and the target id next to the badge names the model.
- **Simulations are not audited** (features 005 and 006), so running them does not add rows
  to live traffic.
- **The design comes from Claude Design.** This spec fixes what each screen shows and how it
  behaves; the look (layout, tokens, component styling) is fixed by the received design, and
  `design-brief.md` is the hand-off.
- **Browser support**: the two latest versions of Chromium, Firefox and Safari; the browser
  flows run on Chromium in CI.
