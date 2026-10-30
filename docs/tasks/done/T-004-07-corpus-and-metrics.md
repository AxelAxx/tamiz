# T-004-07 — Synthetic Spanish PII corpus and detection metrics

| Field | Value |
|---|---|
| Task | `T-004-07` (see `docs/tasks/BACKLOG.md`) |
| Feature | `004-privacy-service` |
| Spec | `specs/004-privacy-service/spec.md` (FR-017 … FR-019; US4-1 … US4-4, US5-1; SC-001 … SC-003, SC-005); `tasks.md` Phase 6 (T064–T072) and the feature polish (T073–T076); `research.md` R-14 |
| Branch / PR | `T-004-07-corpus-and-metrics` / PR opened after this commit |
| Date | 2026-10-30 |
| Session | Claude Code (Claude Opus 5.5), side session (merge authority delegated by Alex) |
| Status | done; feature 004 complete |

## What was done

**The corpus.** `scripts/generate_corpus.py` writes `tests/corpus/pii-es.v1.jsonl`
(seed 20261030):
- a meta line (version 1, `synthetic: true`), then 324 labelled cases;
- 264 positives from 12 templates across clinic, HR, legal, fintech and generic
  domains;
- 60 hard negatives: identifiers with a wrong control character, order numbers,
  postcodes, non-phone numbers, amounts, and texts without personal data.

How the data is made:
- names come from Faker `es_ES` lists;
- identifiers are computed by the generator;
- emails use the reserved `example.com/org/net` domains;
- cities come from a fixed list.

`--check` regenerates the corpus and compares it with the committed file, and a test does
the same (US4-3).

**The metrics.** `pytest -m metrics` runs the real engine over every case and writes
`reports/detection-metrics.json` (data-model §6), which CI uploads as an artifact. It
fails below the SC-001/SC-002 thresholds, naming the kind, metric and value (US4-1,
US4-2, US4-4). It also anonymizes every case and restores it exactly, with no reported
value left behind (SC-003).

Metrics on corpus v1, local run (min score 0.5):

| Kind | Support | Precision | Recall |
|---|---|---|---|
| DNI, NIE, CIF, IBAN, NSS, PHONE, EMAIL | 66 each | 1.000 | 1.000 |
| CREDIT_CARD | 22 | 1.000 | 1.000 |
| PERSON | 132 | 0.871 | 0.917 |
| LOCATION | 66 | 0.805 | 0.939 |

The round trip was exact on 324 of 324 cases, with 0 values left.

**Session-wide log check.** An autouse fixture captures everything logged during the
whole test session, with the root logger at DEBUG and the production handler. It fails
if any corpus text, or any labelled value of 5 or more characters, appears (US5-1,
SC-005).

## Files touched

- `services/privacy/scripts/generate_corpus.py`, `tests/corpus/pii-es.v1.jsonl` (T068, T069).
- Tests:
  - `tests/metrics/{__init__,scoring,test_detection_metrics,test_corpus_format}.py`;
  - `tests/unit/test_metrics_scoring.py`;
  - `tests/support/corpus.py`
  - (T064–T066, T070).
- `services/privacy/tests/conftest.py`: session-wide log check, fixtures on the production handler (T067).
- `services/privacy/src/privacy/api/logging.py`: `ThirdPartyFilter`, `service_handler` (see Decisions).
- `tests/api/test_logging.py`: test for the third-party filter.
- `services/privacy/pyproject.toml`, `uv.lock`: dev dependency Faker; Ruff `S311` ignored for the generator only.
- `.github/workflows/ci.yml`: uploads `services/privacy/reports/detection-metrics.json` (T071).
- Polish (T073–T075):
  - `README.md`: status with the metrics table;
  - `docs/architecture.md`: privacy service layers and flow;
  - `CLAUDE.md` section 12;
  - `docker-compose.yml`: the `privacy` service, internal network only;
  - `services/privacy/README.md`.
- `specs/004-privacy-service/tasks.md`: T064–T076 ticked; all 76 are done.
- `docs/tasks/BACKLOG.md`: `T-004-07` → `done`.

## Decisions

- **The structured kinds score a perfect 1.000, which says more about the corpus than
  about the field.** The generator produces the formats the recognizers were designed
  for, and the hard negatives are those the patterns were designed to reject. So v1 is a
  regression gate, not an accuracy estimate. README and this record say so. Formats
  outside the spec are not in v1: IBANs with letters later in the BBAN, `(+34)` with
  brackets, identifiers split across lines. Feature 007's PII-leak eval
  (`pii-leak-es.v1.jsonl`) should include adversarial formats written independently of
  the recognizers.
- **The real finding of this task: Presidio logs the words around each match at DEBUG**
  ("Context list is: …", including emails and phone words). Production was already safe,
  because `configure_logging` pins the Presidio logger to WARNING. The session-wide check
  showed that this rested on a single line.
  - A `ThirdPartyFilter` on the service handler now lets records below WARNING through
    only from `privacy.*` and `uvicorn.*`.
  - Tests use the same `service_handler`.
  - A test proves that Presidio DEBUG/INFO lines never reach the output.
- **NER spans are matched leniently (overlap); structured kinds are matched exactly.**
  This follows R-14: spaCy legitimately varies on titles and particles.
- **Labelled values shorter than 5 characters are not searched in logs.** Short first
  names ("Ana") would collide with ordinary log text. Full case texts are always
  searched.
- **`PERSON` precision (0.871) and `LOCATION` precision (0.805) are reported, not
  gated,** as the spec says. The false positives are mostly capitalised words in
  templates, such as "Factura" and "Nómina".
- **The corpus file is the single copy** (FR-019). Feature 007 reads it in place.
- **Faker version and output.** Upgrading Faker can change the generated names, and
  `--check` / `test_us4_3_the_generator_reproduces_the_committed_file` would then fail.
  After such an upgrade, regenerate the corpus and record the new metrics in that PR.
- **The compose `privacy` service is not published to the host.** It has no auth (spec
  assumption); for local debugging, use `uv run python -m privacy.main`.

## How it was verified

```bash
cd services/privacy
uv run ruff check . && uv run ruff format --check .   # All checks passed
uv run mypy                                           # Success: no issues found in 68 source files
uv run lint-imports                                   # Contracts: 2 kept, 0 broken.
uv run pytest                                         # 254 passed (session log check included)
uv run pytest -m metrics -s                           # table above; report written
uv run python scripts/generate_corpus.py --check      # pii-es.v1.jsonl is reproducible
uv run python scripts/export_openapi.py --check       # up to date
```

Quickstart run (T076):
- §1–§5 were run across `T-004-02` … `T-004-07`, with the commands and outputs in each
  record.
- §6 (Docker) is verified by the CI `docker build` step; the Docker engine is not running
  on this machine.
- §7 passes (`export_openapi.py --check`).

## Pending / follow-ups

- Feature 004 is complete; all 76 tasks are done.
- Next: `T-005-01` (spec for privacy-aware routing).
  - `T-005-03` mirrors `services/privacy/openapi.json` in Zod.
  - `T-005-04` reimplements `tests/support/restore.py` in the gateway.
- `T-007-03` builds the leak and detection evals on this corpus. It should also add
  independently written adversarial cases (see Decisions).
- `T-OPS-01` wires the compose `privacy` service into the full stack.
- No new backlog rows.

## Pitfalls for the next session

- **Never trust a library's logger level for privacy; filter at the handler.** Presidio
  logs request context at DEBUG.
- **A perfect score on a self-generated corpus is not evidence of field accuracy.** Keep
  the claim scoped in anything published (README, LinkedIn post, case study).
- **`tests/metrics` needs the real model** (it is marked `metrics`). The default
  `uv run pytest` runs it (about 3 s after the model is loaded). To skip it, use
  `-m "not nlp and not metrics"`.

## Links

- Spec / plan / tasks: `specs/004-privacy-service/`
- ADRs: none added
- Related task records: `docs/tasks/done/T-004-0{1..6}-*.md`
