# T-004-01 — Spec, plan and tasks for `004-privacy-service`

| Field | Value |
|---|---|
| Task | `T-004-01` (see `docs/tasks/BACKLOG.md`) |
| Feature | `004-privacy-service` |
| Spec | `specs/004-privacy-service/spec.md` |
| Branch / PR | `004-privacy-service` (Spec Kit naming), cut from `main` at 99bd087 / PR opened after this commit |
| Date | 2026-10-30 |
| Session | Claude Code (Claude Opus 5.5), side session |
| Status | done as a draft; `spec.md` is `Draft` until Alex reviews it, then flips to `Approved` in the same PR (as in `T-002-01` and `T-003-01`) |

## What was done

I wrote the Spec Kit set for feature 004, following the 003 format:

- `spec.md`: 6 user stories with 32 Given/When/Then scenarios, FR-001 … FR-023 grouped
  by backlog task, SC-001 … SC-006, edge cases and assumptions.
- `checklists/requirements.md`: all items pass, with notes.
- `plan.md`: technical context, constitution check with no violations, source tree,
  requirement → backlog-task mapping.
- `research.md`: decisions R-01 … R-15.
- `data-model.md`: domain, port, use-case, adapter, API contract, corpus and report
  shapes.
- `contracts/{README,http}.md` plus `analyze.example.json`, `anonymize.example.json`
  and `corpus.example.jsonl`. A script generated the examples: offsets are exact, the
  identifiers pass their checks, and the anonymize example round-trips.
- `quickstart.md`.
- `tasks.md`: 76 tasks in 7 phases, one phase per backlog task `T-004-02` … `T-004-07`
  plus polish, with the scenario → task coverage table.

The backlog gains no row: `T-004-02` … `T-004-07` already cover the work.

## Files touched

- `specs/004-privacy-service/spec.md`, `checklists/requirements.md`: specification and its quality checklist.
- `specs/004-privacy-service/plan.md`, `research.md`, `data-model.md`, `quickstart.md`: design.
- `specs/004-privacy-service/contracts/*`: review projections and examples.
- `specs/004-privacy-service/tasks.md`: 76 tasks.
- `docs/tasks/BACKLOG.md`: `T-004-01` → `done` (draft, pending approval).
- `docs/tasks/done/T-004-01-spec-plan-tasks-004.md`: this record.

## Decisions (flagged for Alex's review)

- **Sensitivity per kind (FR-006):**
  - `critical`: DNI, NIE, NSS, IBAN, card;
  - `high`: person, phone, email;
  - `low`: CIF, location;
  - the level of a text is the highest among its findings at or above `min_score`
    (default 0.5).
- **Thresholds go beyond `CLAUDE.md` §10 (SC-001, SC-002):**
  - precision ≥ 0.95 is required next to recall ≥ 0.95;
  - CIF and email join the gated structured kinds;
  - names are gated at recall ≥ 0.80 here, because the < 2 % name-leak threshold
    belongs to feature 007.
- **Own Spanish recognizers instead of Presidio's `ES_NIF`/`ES_NIE` (R-02).** There is
  one explicit registry: spaCy for names and places, Presidio's email and card
  recognizers, and our six. Check-digit algorithms are pure domain functions (R-13).
  `python-stdnum` serves only as the test oracle.
- **No `presidio-anonymizer` (R-07).** Placeholders come from a pure domain function:
  - one placeholder per distinct value;
  - numbering per kind;
  - no collision with placeholder-like strings already in the text.

  `CLAUDE.md` §4 lists the Anonymizer, so this is the deviation to confirm.
- **No restore endpoint.** The gateway restores (`T-005-04`), so maps never travel back
  to the service.
- **No service authentication.** The service is reachable on the internal network only.
- **One Spanish setup for every text.** Special categories of data (health, religion)
  are out of scope.
- **Python steps go inside the single required `ci` job (R-06)**, including
  `docker build`. The job timeout rises to 25 minutes. Biome ignores
  `services/privacy/**`.
- **Layering is checked by import-linter (R-05).**
- **The model is pinned as a wheel through uv and baked into the image (R-03).**
- **Validation errors are 400 `invalid_request` without the input (R-10)**, replacing
  FastAPI's 422, which echoes the input.
- **Offsets are Python code-point indices.** The gateway converts them to UTF-16 when
  needed (`contracts/http.md`, for `T-005-03`).
- **Backlog nuance.** `T-004-03`'s "phone detected" assertion moves to `T-004-05`
  (T048), where the Spanish phone recognizer lands.

## How it was verified

Documentation only; no code changed.

- I generated the contract examples with a Python script and checked them:
  - the DNI letter of `12345678Z` (mod 23);
  - the NIE `Y1234567X`;
  - mod-97 = 1 and the account control digits `45` of
    `ES91 2100 0418 4502 0005 1332`;
  - restore of the anonymize example equals the original.
- `pnpm lint` stays green: Biome does not check Markdown, and it formats the JSON
  examples.
- Scenario coverage: every one of the 32 scenarios appears in the `tasks.md` table.

## Pending / follow-ups

- Alex's review of `spec.md`; on approval, flip `Status` to `Approved` and merge.
- Not verified: current releases of `presidio-analyzer` (2.2 line) and spaCy /
  `es_core_news_lg` (3.8). `T-004-02` pins them in `uv.lock` (research note).
- No new backlog rows.

## Pitfalls for the next session

- **FastAPI's default 422 body echoes the offending `input`.** Override it (R-10)
  before any test that sends personal data in an invalid request.
- **`python-stdnum` has no Spanish NSS module.** NSS is checked against published
  examples and the mutation property only.
- **Docker is not running on this Windows machine.** The image build is proven in CI
  (R-06).
- **The Spanish model is ~550 MB.** Keep the uv cache keyed on `uv.lock` in CI, or
  every run downloads it.

## Links

- Spec / plan / tasks: `specs/004-privacy-service/`
- ADRs: none added (the decisions above live in `research.md`; promote to an ADR if
  Alex wants the Anonymizer deviation recorded there)
- Related task records: `docs/tasks/done/T-003-01-spec-plan-tasks-003.md`
