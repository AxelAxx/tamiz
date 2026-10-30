# Feature Specification: Privacy Service

**Feature Branch**: `004-privacy-service`

**Created**: 2026-10-30

**Status**: Draft (awaiting Alex's review)

**Input**: User description: "004-privacy-service: a Python service that tells the
gateway which personal data a text contains and how sensitive it is (`/analyze`), and
replaces that data with reversible placeholders (`/anonymize`, the map is returned and
never stored). Spanish recognizers with checksum validation for DNI, NIE, CIF, IBAN,
social security number (NSS) and phone numbers, on top of name, location and email
detection; a synthetic Spanish corpus with detection thresholds (recall ≥ 0.95 on
structured identifiers). Backlog T-004-02 … T-004-07."

**Backlog**: `T-004-01` (this spec), `T-004-02` … `T-004-07` (implementation). See
`docs/tasks/BACKLOG.md`, section "Day 5".

**Feeds**: `005-privacy-aware-routing` (the gateway calls this service, maps sensitivity
to privacy actions, anonymizes before a provider call and restores the answer) and
`007-evals-gate` (detection and PII-leak evals reuse the corpus and the endpoints). This
feature stops at the service boundary: it does not change the gateway.

## Purpose

Tamiz's promise is that personal data never reaches a model it is not allowed to reach.
The gateway cannot keep that promise without knowing, for each request, *what* personal
data is present and *how sensitive* it is. This feature delivers that knowledge as a
small, separate service: given a text, it lists the personal data it found (what kind,
where, how confident) and summarises the text's sensitivity in one level the routing
policy can act on; given the same text, it can also replace each piece of personal data
with a numbered placeholder and hand back the table needed to restore it, so that an
anonymized text can go to a provider and the answer can be restored afterwards.

The audience is small European teams; the first market is Spain. Generic detectors miss
Spanish identifiers or confuse them with any eight-digit number, so this service adds
Spanish recognizers that validate the check digits of each identifier: a DNI with the
wrong letter is not a DNI. Detection is statistical and is presented with published
metrics on a synthetic corpus, never as a guarantee.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The gateway learns which personal data a text contains and how sensitive it is (Priority: P1)

The gateway sends the text of a request and receives the list of personal data found,
each with its kind, its position in the text and a confidence score, plus one overall
sensitivity level (none, low, high or critical). It never receives the personal data
back as values: positions are enough, since it holds the text.

**Why this priority**: It is the input of every privacy decision in feature 005. Without
it the gateway can only route blindly.

**Independent Test**: Send texts with known personal data to the analysis endpoint and
compare the reported kinds, positions and levels with the expected ones.

**Acceptance Scenarios**:

1. **Given** a Spanish text containing a person's name, an email address and a phone
   number, **When** it is analyzed, **Then** the response lists one finding of each kind
   with start and end positions that delimit exactly that data, a score between 0 and 1,
   and the sensitivity level `high`.
2. **Given** a text that also contains a valid DNI, **When** it is analyzed, **Then** the
   DNI is listed and the level is `critical`.
3. **Given** a text with no personal data, **When** it is analyzed, **Then** the list is
   empty and the level is `none`.
4. **Given** a text containing only a city name or a company tax identifier (CIF), **When**
   it is analyzed, **Then** the level is `low`.
5. **Given** a caller that asks for a higher minimum score, **When** a finding scores
   below it, **Then** the finding is not listed and does not count towards the level.
6. **Given** any analysis, **When** the response is built, **Then** it contains no text
   copied from the input: only kinds, positions, scores and counts.

---

### User Story 2 - Spanish identifiers are recognised only when their check digits are valid (Priority: P1)

An operator in a Spanish clinic sends texts full of numbers: order numbers, dates,
postcodes, phone numbers and real identifiers. The service recognises a DNI, NIE, CIF,
IBAN or social security number only when its control letter or digits are correct, and
recognises Spanish phone numbers in their usual written forms, so that sensitive data is
not missed and ordinary numbers do not make every request look critical.

**Why this priority**: Structured identifiers are the data the PII-leak threshold treats
as critical (0 % leak). Missing them breaks the promise; over-detecting them makes the
gateway send everything to the local model.

**Independent Test**: Run each recognizer over valid identifiers, identifiers with a
wrong control character, and look-alike numbers, and count hits and misses.

**Acceptance Scenarios**:

1. **Given** a valid DNI (eight digits and the matching letter), with or without a
   separator, **When** it is analyzed, **Then** it is found as `DNI` with a score of at
   least 0.9.
2. **Given** a DNI whose letter does not match its digits, **When** it is analyzed,
   **Then** it is not reported as `DNI`.
3. **Given** a plain eight-digit number (an order number, a postcode followed by digits),
   **When** it is analyzed, **Then** it is not reported as any identifier.
4. **Given** a valid NIE (X, Y or Z, seven digits and the matching letter), **When** it is
   analyzed, **Then** it is found as `NIE`; with a wrong letter it is not.
5. **Given** a valid CIF (organisation letter, seven digits and the matching control
   digit or letter), **When** it is analyzed, **Then** it is found as `CIF`; with a wrong
   control it is not.
6. **Given** a Spanish IBAN written with or without spaces, **When** its check digits pass
   the international mod-97 check and the bank account's own control digits, **Then** it
   is found as `IBAN`; when either check fails, it is not.
7. **Given** a social security number (two province digits, the number and two control
   digits) whose control digits match, **When** it is analyzed, **Then** it is found as
   `NSS`; with wrong control digits it is not.
8. **Given** Spanish mobile and landline numbers written with or without `+34` or
   `0034` and with spaces, dots or dashes, **When** they are analyzed, **Then** each is
   found as `PHONE`; nine-digit numbers that cannot be Spanish phone numbers are not.

---

### User Story 3 - Personal data is replaced by numbered placeholders, and the caller gets the map to restore it (Priority: P1)

Before sending a request to a provider that may not see personal data, the gateway asks
for an anonymized version of the text. Each piece of personal data is replaced by a
placeholder that names its kind and a number (`<DNI_1>`, `<PERSON_2>`); the same value
always gets the same placeholder within the text; and the response includes the map from
placeholders to original values. The service keeps nothing: the map exists only in the
response.

**Why this priority**: It is the action that lets non-local providers serve sensitive
requests (privacy action `anonymize` in feature 005).

**Independent Test**: Anonymize texts, check that no original value remains in the
anonymized text, restore it with the returned map, and compare with the original.

**Acceptance Scenarios**:

1. **Given** a text with two names, one DNI and one email, **When** it is anonymized,
   **Then** each is replaced by `<PERSON_1>`, `<PERSON_2>`, `<DNI_1>` and `<EMAIL_1>`
   (numbered in order of first appearance per kind), and none of the original values
   remains in the anonymized text.
2. **Given** a text in which the same name appears three times, **When** it is
   anonymized, **Then** the three occurrences share one placeholder.
3. **Given** an anonymized text and its map, **When** every placeholder is replaced by its
   original value, **Then** the result equals the original text exactly.
4. **Given** a text with no personal data, **When** it is anonymized, **Then** the text
   comes back unchanged with an empty map.
5. **Given** any anonymization, **When** the service is inspected afterwards (files,
   storage, logs), **Then** neither the map nor any original value has been written
   anywhere.
6. **Given** a text that already contains a string shaped like a placeholder
   (`<DNI_1>`), **When** it is anonymized, **Then** the generated placeholders do not
   collide with it, so that restoration stays exact.
7. **Given** the anonymization response, **When** it is read, **Then** it also carries the
   findings and the sensitivity level of the original text, so that the caller does not
   need a second call.

---

### User Story 4 - Detection quality is measured against a synthetic corpus with thresholds (Priority: P1)

A maintainer changes a recognizer. A versioned, labelled, synthetic Spanish corpus runs in
the automated checks and reports precision and recall per kind of personal data; the
checks fail when the recall of any structured identifier drops below 0.95 or its
precision below 0.95. The corpus contains no real data: every name, identifier and
sentence is generated.

**Why this priority**: Constitution IV: an AI behaviour (here, detection) is accepted
only with a dataset and a threshold. These numbers are the published detection metric of
the project.

**Independent Test**: Run the metrics check; deliberately break a recognizer and watch
the check fail naming the kind and the metric.

**Acceptance Scenarios**:

1. **Given** the corpus (version 1), **When** the metrics check runs, **Then** it reports
   precision, recall and the number of cases for every kind, and passes when recall and
   precision are at least 0.95 for DNI, NIE, CIF, IBAN, NSS, PHONE and EMAIL.
2. **Given** a recognizer change that makes one structured kind miss cases, **When** the
   check runs, **Then** it fails and names the kind, the metric and the value.
3. **Given** the corpus, **When** it is inspected, **Then** it declares its version and
   that it is synthetic, contains at least 300 labelled texts with at least 30 positive
   cases per structured kind, at least 50 hard negatives (wrong check digits, look-alike
   numbers), and was produced by a reproducible generator.
4. **Given** names and locations, **When** the check runs, **Then** their precision and
   recall are reported; recall for names must be at least 0.80 (they are statistical,
   and the gateway's PII-leak threshold for names is enforced in feature 007).

---

### User Story 5 - The service never keeps or leaks what it reads (Priority: P2)

An operator deploys the service next to the gateway. Whatever it analyzes, nothing of the
text, the findings' values or the anonymization maps ends up in its logs, files or any
store; its log lines carry only counts, kinds, levels and timings. It refuses oversized
inputs, answers health checks only when its models are loaded, and returns typed errors
without echoing input.

**Why this priority**: Constitution V applies to the service that handles the most
sensitive data in the system.

**Independent Test**: Run the whole test suite with log capture and a filesystem watch,
search the captured output for the test inputs, and probe the limits and the health
endpoint.

**Acceptance Scenarios**:

1. **Given** the full test suite, **When** its captured logs are searched for any input
   text or detected value, **Then** nothing is found.
2. **Given** a running service, **When** it handles requests, **Then** it writes no files
   and uses no database or cache.
3. **Given** a body larger than the limit (1 MiB, the gateway's own limit), **When** it is
   sent, **Then** the service answers a typed client error without processing it.
4. **Given** a malformed request (missing text, unknown field, unsupported language),
   **When** it is sent, **Then** the service answers a typed client error naming the
   field, without echoing its value.
5. **Given** the service starting, **When** its language model has not finished loading,
   **Then** the health endpoint does not report ready; once loaded, it does.

---

### User Story 6 - The gateway consumes a published, versioned contract (Priority: P2)

The service publishes its request and response shapes as an OpenAPI document committed
in the repository, so the gateway (feature 005) can mirror them as typed schemas and a
test can detect any drift between the two.

**Why this priority**: Constitution II: the Python service publishes an OpenAPI contract
that the gateway consumes through a mirrored schema.

**Independent Test**: Export the document, compare it with the committed one, and check
it lists both endpoints, the kinds of personal data and the sensitivity levels as closed
lists.

**Acceptance Scenarios**:

1. **Given** the service's code, **When** the contract is exported, **Then** it matches
   the committed document byte for byte (a check fails otherwise).
2. **Given** the committed document, **When** it is read, **Then** the kinds of personal
   data and the sensitivity levels are closed lists, and every request object rejects
   unknown fields.

### Edge Cases

- **Overlapping findings** (a phone number inside an IBAN, a DNI inside a NIE-looking
  string): one finding per span; the one with the higher score wins, and on a tie the more
  specific kind (identifier over phone) wins.
- **The same value of two kinds** (a number that is both a valid NSS and a phone number
  shape): reported once, as the kind with the higher score.
- **Identifiers split by line breaks or extra spaces inside**: not recognised (accepted
  miss); common single separators (space, dot, dash) are.
- **Lower-case DNI letters** (`12345678z`): recognised.
- **Empty text or whitespace only**: valid; no findings; level `none`.
- **Very long texts** within the limit: processed; the time bound of SC-004 applies to the
  reference size, longer texts take proportionally longer.
- **English text**: analyzed with the same Spanish setup. Structured identifiers, emails
  and phones are detected regardless of language; names and places in English are
  detected less reliably (accepted, documented, measured later by the PII-leak eval).
- **Text that already contains placeholder-like strings**: generated placeholders skip
  numbers already present (story 3, scenario 6).
- **A name that is also a common word** ("Rosa", "Pilar", "Leon"): may be missed or
  falsely detected; measured by the corpus, never guaranteed.
- **Concurrent requests**: independent; no state shared between requests.

## Requirements *(mandatory)*

### Functional Requirements

Service skeleton (backlog `T-004-02`):

- **FR-001**: The service MUST be a separate HTTP service with a health endpoint that
  reports ready only after its language model and recognizers are loaded.
- **FR-002**: The service MUST follow the same layering as the gateway (domain,
  application, infrastructure, API) with the domain free of framework and library
  imports, and the layering MUST be checked automatically.
- **FR-003**: The service MUST run its quality checks (lint, strict type check, tests) in
  the project's automated pipeline, and its container MUST run as a non-root user.

Analysis (backlog `T-004-03`):

- **FR-004**: `POST /analyze` MUST accept a text (and optionally a minimum score and a
  subset of kinds) and return the findings (kind, start, end, score) sorted by start, a
  count per kind, and the sensitivity level, and MUST NOT return any substring of the
  input.
- **FR-005**: The kinds of personal data MUST be the closed list `DNI`, `NIE`, `CIF`,
  `IBAN`, `NSS`, `PHONE`, `EMAIL`, `CREDIT_CARD`, `PERSON`, `LOCATION`.
- **FR-006**: The sensitivity level MUST be the closed list `none`, `low`, `high`,
  `critical`, computed as the highest level among the reported findings: `critical` for
  `DNI`, `NIE`, `NSS`, `IBAN`, `CREDIT_CARD`; `high` for `PERSON`, `PHONE`, `EMAIL`;
  `low` for `CIF`, `LOCATION`; `none` without findings.
- **FR-007**: Findings below the minimum score (default 0.5) MUST be dropped before the
  level is computed; overlapping findings MUST be resolved as described under Edge Cases.
- **FR-008**: Names and locations MUST be detected with a Spanish language model; email
  addresses and payment card numbers with checksum-aware generic recognizers.

Spanish recognizers (backlog `T-004-04`, `T-004-05`):

- **FR-009**: `DNI`, `NIE` and `CIF` MUST be recognised only when their control letter or
  digit is valid, with a score of at least 0.9 when valid.
- **FR-010**: `IBAN` MUST be recognised only when it passes the mod-97 check and, for
  Spanish IBANs, the bank account's control digits; other countries' IBANs that pass
  mod-97 MUST also be recognised as `IBAN`.
- **FR-011**: `NSS` MUST be recognised only when its two control digits match the
  province and number.
- **FR-012**: `PHONE` MUST recognise Spanish mobile and landline numbers (nine digits
  starting with 6, 7, 8 or 9) with optional `+34`/`0034` and single separators, with a
  higher score when a phone-related word is nearby.
- **FR-013**: Plain numbers without a valid identifier structure MUST NOT be reported as
  any identifier.

Anonymization (backlog `T-004-06`):

- **FR-014**: `POST /anonymize` MUST return the text with each finding replaced by
  `<KIND_n>` (numbered from 1 per kind in order of first appearance, one placeholder per
  distinct value), the map from placeholders to original values, and the findings and
  level of the original text.
- **FR-015**: Generated placeholders MUST NOT collide with placeholder-shaped strings
  already present in the input.
- **FR-016**: The map MUST exist only in the response: the service MUST NOT write it, or
  any input text or detected value, to logs, files or any store.

Corpus and metrics (backlog `T-004-07`):

- **FR-017**: A versioned synthetic Spanish corpus MUST exist with labelled spans,
  generated by a committed, seeded generator, meeting the sizes of story 4 scenario 3,
  and declaring that it contains no real data.
- **FR-018**: An automated metrics check MUST report precision and recall per kind and
  fail below the thresholds of story 4; its report MUST be produced as a file the evals
  feature can consume.
- **FR-019**: The corpus MUST be available to `packages/evals` (feature 007) without
  being copied by hand.

Operations and contract (cross-cutting):

- **FR-020**: Request bodies above 1 MiB MUST be refused with a typed client error before
  processing; malformed requests MUST get a typed error naming the field, never its value.
- **FR-021**: Log lines MUST contain only metadata: request identifier, endpoint, kinds,
  counts, level, durations and status; never input text, values or maps.
- **FR-022**: The service MUST publish its OpenAPI document in the repository and a check
  MUST fail when the exported document differs from the committed one.
- **FR-023**: Requests MUST be stateless and safe to process concurrently.

### Key Entities

- **Finding**: one piece of personal data: kind, start, end, score (no value).
- **EntityKind**: the closed list of FR-005.
- **SensitivityLevel**: the closed list of FR-006 and its rule.
- **AnalysisResult**: findings, counts per kind, level.
- **AnonymizationResult**: anonymized text, placeholder map, and the analysis of the
  original text.
- **PlaceholderMap**: placeholder → original value and kind; returned, never stored.
- **Corpus case**: a synthetic text with labelled spans and kinds; the corpus header
  declares version and synthetic origin.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: On the corpus, recall and precision are at least 0.95 for each of `DNI`,
  `NIE`, `CIF`, `IBAN`, `NSS`, `PHONE` and `EMAIL`.
- **SC-002**: On the corpus, recall for `PERSON` is at least 0.80; precision and recall
  for `PERSON` and `LOCATION` are reported.
- **SC-003**: 100 % of anonymize → restore round trips over the corpus reproduce the
  original text exactly, and 0 original values of reported findings remain in any
  anonymized text.
- **SC-004**: Analyzing a 2 000-character text takes under 200 ms at the 95th percentile
  on the reference CI runner, after warm-up.
- **SC-005**: 0 occurrences of corpus texts or detected values in the logs captured during
  the full test suite, and 0 files written by the service during it.
- **SC-006**: 100 % of the acceptance scenarios of this spec have a matching automated
  test named after the scenario.

## Assumptions

- The service is reachable only from the gateway on an internal network (Docker Compose
  network locally, a private network in the demo deployment). It has no authentication
  of its own in this feature; exposing it publicly is out of scope and documented as
  unsafe.
- One language setup (Spanish) serves all texts in this feature; an English model may be
  added later if the PII-leak eval shows a need.
- Special categories of data (health conditions, religion, union membership) are not
  detected in this feature; they would need a different technique and are listed as a
  later item, not silently assumed.
- A company tax identifier (CIF) is personal data only for sole traders; it is treated as
  `low` sensitivity.
- The default minimum score (0.5) and the per-kind scores are configuration of the
  service, chosen in the plan and tuned with the corpus.
- The gateway does the restoring (feature 005), including in streams; the service has no
  restore endpoint, so it never receives a map back.
- Thresholds of SC-001 (precision 0.95 alongside recall 0.95) go beyond `CLAUDE.md`
  section 10 (recall only) because check-digit validation makes high precision cheap
  and over-detection has a real cost (everything routed locally); the plan may lower
  precision for `PHONE` if the corpus proves it necessary, with the change recorded.
