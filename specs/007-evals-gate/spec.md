# Feature Specification: Evals Gate

**Feature Branch**: `007-evals-gate`

**Created**: 2026-10-30

**Status**: Approved (reviewed by Alex on 2026-10-30)

**Input**: User description: "007-evals-gate: the eval runner in packages/evals (versioned synthetic JSONL datasets, scorer interface, thresholds, JSON + Markdown report, non-zero exit below threshold, `pnpm evals`), the PII-leak and detection evals (0 % leak for critical identifiers, < 2 % for names, recall ≥ 0.95 on structured identifiers), the routing eval over /v1/simulate (≥ 95 %), the quality (LLM-as-judge, no more than 5 % below the frontier route) and cost (reported vs all-frontier baseline) evals, and a CI `evals` job with local models that blocks a PR below threshold and publishes the results table in the README. Backlog T-007-02 … T-007-06."

**Backlog**: `T-007-01` (this spec), `T-007-02` … `T-007-06` (implementation). See
`docs/tasks/BACKLOG.md`, section "Day 8".

**Builds on**: features 002 (routing dataset v1, cost), 004 (privacy service, its corpus
and metrics), 005 (privacy actions, `POST /v1/simulate`), 006 (baseline cost). **Feeds**:
`008-dashboard` (eval results screen), `T-DOC-01` (README results table).

## Purpose

The project's fifth promise is "proves it works": privacy-leak and routing-quality evals
that gate CI. Today each piece has its own check: the privacy service gates its detection
metrics on the corpus it was built against, and the gateway gates routing with a unit test
of the classifier and the policy. Nothing measures the behaviour that matters to a
regulated team, end to end and against the running services: **how much personal data
would reach a provider it must not reach**, **whether requests go where the policy says**,
**whether the cheaper route answers well enough**, and **what it saves**. This feature adds
one eval runner with versioned synthetic datasets, explicit thresholds, a report a reviewer
can read, and a CI job that blocks any change that makes those numbers worse than the
thresholds.

Constitution IV ("evals are executable spec") becomes enforceable here: every AI behaviour
of features 002–006 gets a dataset and a threshold, and below threshold the pull request
cannot be merged.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - One command runs the evals and says pass or fail (Priority: P1)

A developer changes the policy, a recognizer or the classifier and runs one command. It
runs every eval against the running services, prints a summary, writes a machine-readable
report and a human-readable one, and exits with a status that says whether every threshold
held.

**Why this priority**: Without the runner there is no gate; every other story plugs into it.

**Independent Test**: Run the runner on a toy dataset with a toy scorer whose result is
known; check the report contents and the exit status above, at and below the threshold.

**Acceptance Scenarios**:

1. **Given** datasets whose results meet every threshold, **When** the evals run, **Then**
   the command exits 0 and the report lists each eval with its metric, threshold and `pass`.
2. **Given** one metric below its threshold, **When** the evals run, **Then** the command
   exits with a failure status, the report marks that eval `fail`, and lists the failing
   cases by id with the reason (expected vs actual), never with their personal data values.
3. **Given** a service the evals need is unreachable or answers outside its contract,
   **When** the evals run, **Then** the command exits with a distinct error status and says
   which service failed; it never reports a pass.
4. **Given** a dataset file with an invalid line or a wrong header (dataset name, version,
   `synthetic: true`), **When** the evals run, **Then** they stop before scoring and name the
   file and line.
5. **Given** a selection of evals (for example only routing), **When** the command runs with
   that selection, **Then** only those evals run, and the report says which were skipped.
6. **Given** a run, **When** it finishes, **Then** the report records the dataset versions,
   the policy file and its version, the services' versions and the models used, so two
   reports can be compared.

---

### User Story 2 - Personal data never reaches a provider it must not reach (Priority: P1)

A compliance reviewer asks: "with the default policy, how often would a DNI or a name be
sent in clear to a cloud provider?" The leak eval answers with a number per entity kind,
over a synthetic Spanish dataset written to resemble the requests of health, legal,
fintech and HR teams.

**Why this priority**: It is the product promise in one number; the cut order says privacy
evals are never cut.

**Independent Test**: Run the leak eval against the privacy service and the gateway's
simulation with the default policy; check per-kind leak rates and the listed leaking cases.

**Acceptance Scenarios**:

1. **Given** a case with a critical identifier (DNI, NIE, NSS, IBAN, card number), **When**
   it is evaluated, **Then** it counts as a leak if that value, verbatim, would be sent to
   any target outside `local` residency in the decided chain (fallbacks included).
2. **Given** a case with a name, an email or a phone number, **When** it is evaluated,
   **Then** it counts as a leak if that value, verbatim, would be sent to any non-local
   target: the default policy anonymizes them, so a verbatim value means a missed detection
   or a broken anonymization.
3. **Given** a blocked request, **When** it is evaluated, **Then** none of its values leak.
4. **Given** the whole leak dataset, **When** the eval finishes, **Then** the leak rate is
   0 % for every critical kind and below 2 % for each of names, emails and phones; above
   that, the eval fails.
5. **Given** low-sensitivity values (company tax ids, places), **When** evaluated, **Then**
   they are reported but have no threshold: the default policy allows them to leave.

---

### User Story 3 - Detection is measured on data it was not tuned on (Priority: P1)

The privacy service already reports precision and recall on the corpus it was developed
with. A reviewer wants the same numbers on a held-out dataset with different wording and
harder formats, through the service's public contract.

**Why this priority**: Detection quality bounds the leak rate; numbers on the development
corpus alone overstate it.

**Independent Test**: Run the detection eval against the privacy service; compare its
findings with the dataset's annotated spans.

**Acceptance Scenarios**:

1. **Given** the held-out detection dataset, **When** evaluated, **Then** precision and
   recall are reported per entity kind, with a finding matching an annotation only when
   kind and offsets match.
2. **Given** the structured identifiers (DNI, NIE, CIF, IBAN, NSS, card, phone, email),
   **When** evaluated, **Then** recall is at least 0.95 for each; below, the eval fails.
3. **Given** names, **When** evaluated, **Then** recall is at least 0.80 (the privacy
   service's own gate); places are reported only.

---

### User Story 4 - Requests go where the policy says (Priority: P1)

A developer edits the default policy. The routing eval checks, through the gateway's
simulation endpoint with the real privacy service, that each request of the routing dataset
reaches its expected first target.

**Why this priority**: Routing is the gateway's core decision; the existing unit gate does
not include the real inspection.

**Independent Test**: Run the routing eval against a running gateway; check accuracy and
the listed mismatches.

**Acceptance Scenarios**:

1. **Given** the routing dataset, **When** evaluated through the simulation endpoint,
   **Then** at least 95 % of cases reach their expected route; below, the eval fails.
2. **Given** a mismatch, **When** reported, **Then** the report shows the case id, expected
   and actual route, rule, task type and sensitivity.
3. **Given** the simulation endpoint, **When** the routing eval runs, **Then** no model is
   called and no audit entry is written.

---

### User Story 5 - The cheaper route answers well enough, and the saving is visible (Priority: P2)

A team lead wants to know whether routing to small and local models costs answer quality.
The quality eval sends a dataset of requests with reference answers through the gateway,
has a judge model grade each answer against its reference, and compares the routed answers
with the frontier route's answers (or, without frontier access, with the last accepted
score for the same models, so regressions are caught). The cost eval reports what the dataset would cost on the routed targets and on the baseline
target.

**Why this priority**: Quality is the trade-off that makes cost savings acceptable; it runs
on real models, so it is slower and less deterministic than the P1 evals.

**Independent Test**: Run the quality eval with a local answering model and a local judge;
check scores, the relative threshold and the cost lines.

**Acceptance Scenarios**:

1. **Given** the quality dataset, **When** evaluated, **Then** each case gets a judge score
   on a fixed scale, with the judge's short rationale, and the mean routed score is
   reported.
2. **Given** frontier access is configured, **When** evaluated, **Then** the same cases are
   also answered by the frontier target and judged; the eval fails if the routed mean is
   more than 5 % below the frontier mean.
3. **Given** no frontier access (CI), **When** evaluated, **Then** the routed mean is
   compared with the accepted baseline score recorded for the same answering and judge
   models, versioned with the evals, and the eval fails if it is more than 5 % below it.
   Updating that baseline is a reviewed change, like a threshold.
4. **Given** the judge, **When** it grades, **Then** its prompt is a versioned file, its
   model and settings are recorded in the report, and it never sees which route produced the
   answer.
5. **Given** the quality and routing datasets, **When** the cost eval runs, **Then** it
   reports the total cost on the routed targets, on the baseline target and the saving, with
   no threshold.

---

### User Story 6 - A pull request that makes the numbers worse cannot be merged (Priority: P1)

A contributor's change lowers the leak, detection or routing results below their
thresholds. The CI job running the evals fails, the pull request cannot be merged, and the
report is attached to the run.

**Why this priority**: A gate that does not block is a dashboard; the README promise is
the block.

**Independent Test**: In a pull request, change one dataset expectation so a metric drops
below threshold; the evals job fails; revert, and it passes.

**Acceptance Scenarios**:

1. **Given** a pull request, **When** CI runs, **Then** an evals job starts the privacy
   service, the gateway and a local model, runs every eval, and uploads the JSON and
   Markdown reports.
2. **Given** a metric below threshold, **When** the job finishes, **Then** it fails, and the
   job summary shows the failing evals and cases.
3. **Given** the job is a required check, **When** it fails, **Then** the pull request
   cannot be merged.
4. **Given** a new report, **When** the maintainer runs the README command, **Then** the
   README results table is regenerated from the report, between fixed markers.
5. **Given** the evals job, **When** it runs on a pull request, **Then** it finishes in
   under 15 minutes.

---

### Edge Cases

- **A value split across messages** (a name in one message, the surname in the next): the
  leak check looks for each annotated value in the message where it is annotated.
- **The same value twice** in one case counts once per case and kind.
- **Placeholders that look like values** (`<PERSON_1>`) are never a leak.
- **Anonymization notice text** added by the gateway is part of what the provider receives
  and is searched too.
- **A detector failure** during an eval run: with the default policy the request is
  restricted to local (fail closed), so no leak is counted, but the run reports the number of
  detector failures; more than zero fails the run as an error, since the eval did not measure
  detection.
- **Non-deterministic judge output** that cannot be parsed into a score: retried once, then
  the case is scored as an error; more than 10 % errors fails the quality eval as an error.
- **A dataset bound to a policy file that changed**: the report records the policy version;
  the routing eval does not silently accept a different policy than the dataset declares.
- **Accents and Unicode**: values are compared after Unicode normalization (NFC), never
  case-folded for identifiers.

## Requirements *(mandatory)*

### Functional Requirements

Runner (backlog `T-007-02`):

- **FR-001**: A single command MUST run all evals, or a named selection, against services
  given by configuration, and MUST exit 0 when every selected eval meets its threshold, 1
  when any eval is below threshold, and 2 on a setup or service error.
- **FR-002**: Datasets MUST be versioned JSONL files with a header line (dataset name,
  version, `synthetic: true`, language, note) and one case per line with a unique id; the
  runner MUST validate them before scoring and stop with file and line on error.
- **FR-003**: Each eval MUST declare its metric(s), threshold(s) and comparison in one
  versioned place; changing a threshold MUST be a visible change in review.
- **FR-004**: The runner MUST write a JSON report (machine-readable, schema-validated) and a
  Markdown report, both listing per eval: metric, threshold, result, pass/fail, failing case
  ids with expected and actual, the dataset versions, policy, services and models used, and
  the run duration.
- **FR-005**: Reports, logs and the console MUST NOT contain dataset values of personal
  data (even synthetic): failing cases are shown by id, kind and position.

Leak and detection (backlog `T-007-03`):

- **FR-006**: The leak eval MUST, per case, obtain the gateway's decision and the exact
  messages a provider would receive (through the simulation endpoint), and count each
  annotated value as leaked when it appears verbatim in what any non-local target of the
  chain would receive.
- **FR-007**: The leak eval MUST fail when any critical kind (DNI, NIE, NSS, IBAN, card) has
  a leak rate above 0 %, or when names, emails or phones each have a leak rate of 2 % or
  more; low-sensitivity kinds are reported only.
- **FR-008**: The detection eval MUST call the privacy service's analysis contract on a
  held-out dataset distinct from the service's development corpus and report precision and
  recall per kind; it MUST fail when recall is below 0.95 for any structured identifier or
  below 0.80 for names.
- **FR-009**: The leak dataset MUST hold at least 150 cases and the detection dataset at
  least 150 annotated values, all synthetic, in Spanish, across health, legal, fintech and HR
  contexts, including harder formats (lowercase letters, missing or extra separators, values
  at sentence edges, several values per message, multi-message requests).

Routing (backlog `T-007-04`):

- **FR-010**: The routing eval MUST run the routing dataset through the gateway's simulation
  endpoint with the real privacy service and fail below 95 % expected first routes, listing
  each mismatch with expected and actual route, rule, task type and sensitivity.

Quality and cost (backlog `T-007-05`):

- **FR-011**: The quality eval MUST send each case of a dataset with reference answers
  through the gateway, have a judge model score each answer against its reference with a
  versioned prompt on a fixed scale, and fail when the routed mean score is more than 5 %
  below the comparison: the frontier route's answers judged the same way when frontier
  access is configured, otherwise the accepted baseline score recorded for the same
  answering and judge models.
- **FR-012**: The judge MUST run with deterministic settings, MUST NOT be told which route
  produced an answer, and its model and settings MUST be recorded in the report.
- **FR-013**: The cost eval MUST report, over the quality and routing datasets, the cost on
  the routed targets, on the policy's baseline target and the saving, with no threshold.

CI (backlog `T-007-06`):

- **FR-014**: CI MUST run the evals in a dedicated job on every pull request and on `main`,
  with the privacy service, the gateway and a local model, upload both reports, write the
  summary to the job page, and fail below threshold; the job MUST be a required check.
- **FR-015**: A command MUST regenerate the README results table from a report between fixed
  markers, so the published numbers come from a real run.

### Key Entities

- **Dataset**: a versioned JSONL file (header + cases) under `packages/evals/datasets/`;
  synthetic, never real data.
- **Case**: one request (messages, optional model) with its expectations: annotated values
  (kind, message, offsets) for leak and detection, expected route, or a reference answer.
- **Eval**: a named scorer over one dataset with metrics and thresholds.
- **Threshold**: a metric, a comparison and a bound, versioned with the evals.
- **Report**: the run's results (JSON and Markdown): per-eval metrics, pass/fail, failing
  case ids, and the run's provenance (datasets, policy, services, models, duration).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: With the default policy, 0 critical identifiers and fewer than 2 % of names,
  emails and phones of the leak dataset would reach a non-local provider verbatim.
- **SC-002**: Recall on the held-out detection dataset is at least 0.95 for each structured
  identifier and at least 0.80 for names.
- **SC-003**: At least 95 % of the routing dataset reaches its expected first route through
  the real inspection.
- **SC-004**: With frontier access, routed answers score no more than 5 % below the frontier
  answers on the quality dataset; in CI, no more than 5 % below the accepted baseline.
- **SC-005**: A pull request that lowers any gated metric below its threshold cannot be
  merged (demonstrated once and recorded in the task record).
- **SC-006**: The evals job finishes in under 15 minutes on a pull request.
- **SC-007**: 100 % of the acceptance scenarios have a matching automated test, and the
  README results table is generated from a report.

## Assumptions

- **What a provider "receives"** is taken from the simulation endpoint: the messages as
  anonymized (with the notice) for `anonymize`, the original messages otherwise. The
  simulation runs the same inspection, policy and anonymization code as real requests
  (feature 005), so no provider needs to be called for the leak and routing evals.
- **Every target in the chain counts** for the leak eval, not only the first: a fallback
  could send the request there.
- **The held-out detection dataset** is written for this feature with templates and formats
  different from the privacy service's development corpus; the development corpus and its
  gate stay in the privacy service.
- **The routing unit gate of feature 002** stays as a fast check without network; the eval
  is the end-to-end check. The routing dataset may need a version 2 if the real inspection
  changes a case's route (a case with incidental personal data); such changes are reviewed.
- **Quality in CI** uses a small local answering model and a small local judge, which fit a
  standard runner. Their absolute scores are modest and say little about the frontier gap,
  so in CI the gate catches regressions against the accepted baseline for those models.
  The "no more than 5 % below the frontier route" claim is measured when frontier keys are
  configured (locally or in a scheduled run) and is what the README reports; it never uses
  real data.
- **CI resources**: the job uses a quantized model small enough for a standard runner;
  model downloads are cached between runs.
- **Making the job a required check** is a repository setting changed by the maintainer
  when `T-007-06` merges.
