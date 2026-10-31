# T-007-03 — PII leak and detection evals

| Field | Value |
|---|---|
| Task | `T-007-03` (see `docs/tasks/BACKLOG.md`) |
| Feature | `007-evals-gate` |
| Spec | `specs/007-evals-gate/spec.md` (FR-006 … FR-009; US2-1 … US2-5, US3-1 … US3-3; SC-001, SC-002); `tasks.md` Phase 2 (T012–T019); `research.md` R-04, R-05 |
| Branch / PR | `T-007-03-leak-detection-evals` / PR opened after this commit |
| Date | 2026-10-31 |
| Session | Claude Code (Claude Opus 5.5), side session (merge authority delegated by Alex) |
| Status | done |

## What was done

The privacy promise is now measured end to end, against the real services.

**Generator.** `src/synthetic/` holds three pieces:
- a seeded PRNG (mulberry32);
- Spanish identifiers with valid control characters: DNI/NIE letter, CIF control, IBAN
  mod 97, NSS mod 97, Luhn;
- invented people and places.

The values use harder formats: lower-case letters, `12.345.678-Z`, spaced and compact
IBANs, `0034` and dotted phones, `+rrhh` and upper-case emails, cards with spaces or
dashes. `generate:datasets` writes both files; `--check` (also run inside `pnpm test`)
fails when a committed file differs.

**Datasets:**
- `pii-leak-es.v1.jsonl`: 160 request-shaped cases (summarize, extract, chat, translate,
  classify, code; single and multi-message; health, legal, fintech, HR) with 380 annotated
  values. Per kind: PERSON 100, DNI 40, IBAN 40, EMAIL 40, LOCATION 40, NSS 30, PHONE 30,
  CREDIT_CARD 20, NIE 20, CIF 20.
- `pii-detection-es.v1.jsonl`: 160 sentences (20 look-alike negatives) with 271 annotated
  spans.

**Leak eval.** Each case goes through `POST /v1/simulate`.
- **What is checked.** The messages a provider would receive: `providerMessages` when the
  request is anonymized, the original messages otherwise.
- **When a value leaks.** It appears verbatim (NFC) in any of them, and the chain has any
  non-local target.
- **What the observation keeps.** One boolean per value, so text never leaves the
  observation.
- **Detector failure.** It makes the run an error (`privacy detector_failed`), never a
  pass.

**Detection eval.** Each sentence goes through the privacy service's `POST /analyze` with
the same defaults as the gateway. Precision, recall and support are computed per kind.

## Results (real run, 2026-10-31)

The run used the real privacy service (`uv run python -m privacy.main`) and the real
gateway (`default.yaml`, simulation only). `pnpm evals` → exit 0 in 2.9 s:

| Eval | Result | Gate |
|---|---|---|
| leak: DNI, NIE, NSS, IBAN, card | 0 % each | = 0 % ✓ |
| leak: EMAIL, PHONE | 0 % | < 2 % ✓ |
| leak: PERSON | 1.00 % (1 of 100) | < 2 % ✓ |
| leak: CIF / LOCATION (reported) | 50 % / 25 % | none; the default policy allows `low` data to leave |
| detection: recall, all structured kinds | 100 % | ≥ 95 % ✓ |
| detection: recall PERSON | 89.09 % (49 of 55) | ≥ 80 % ✓ |
| detection: precision | 100 % everywhere except LOCATION 73.6 % | reported |
| routing (still) | 100 % | ≥ 95 % ✓ |

The reports contain no dataset value (checked by a grep of the JSON and Markdown).

## Files touched

- `packages/evals/src/synthetic/{random,identifiers,names,generate}.ts`, `src/generate-datasets.ts` (new); `package.json` (`generate:datasets`).
- `packages/evals/src/clients/privacy.ts`, `src/evals/{leak,detection}.ts` (new); `src/cli.ts` (registry).
- `packages/evals/datasets/pii-leak-es.v1.jsonl`, `pii-detection-es.v1.jsonl` (new, generated).
- Tests:
  - `packages/evals/test/synthetic.test.ts`;
  - `packages/evals/test/scorers.test.ts`;
  - `runner.test.ts`, scoped to routing where it fakes only the gateway.
- `packages/evals/README.md`; `specs/007-evals-gate/spec.md` (US3-1 matching rule), `tasks.md` (T012–T019 ticked); `docs/tasks/BACKLOG.md`.

## Decisions

- **Detection matching follows the privacy service's own rule.** Structured kinds need
  exact offsets; names and places need overlapping spans. The approved spec said "kind and
  offsets match"; US3-1 now states the rule explicitly. This is the spec 004 R-14 rule,
  because NER boundaries legitimately differ.
- **The leak search covers every message sent, not only the annotated one.** The
  anonymization notice shifts message indexes. Searching every message is stricter than
  the spec's "in the message where it is annotated".
- **The generator lives in `src/` and builds to `dist/`**, rather than in a `scripts/`
  folder run with `tsx`. The package then needs no new dev dependency, and its test runs
  the same code.
- **The test that names are disjoint from the development corpus found 13 overlaps.** It
  caught Itziar, Araceli, Echeverría, Villanueva, Teruel and others in the first lists.
  They were replaced with names checked against the corpus file, so the held-out claim
  is enforced, not assumed.

## How it was verified

```bash
pnpm lint        # clean (pre-existing warning and infos only)
pnpm typecheck   # 0 errors
pnpm arch        # ✔ no dependency violations found (124 modules, 437 dependencies cruised)
pnpm test        # Test Files 97 passed (97); Tests 982 passed | 27 skipped (1009)
pnpm build       # pass
```

The evals package has 52 tests, plus the real run above.

## Pending / follow-ups

- No new backlog rows.
- **The missed names are all three-part or compound names** ("… de la Fuente
  Etxeberria"): spaCy is the limit there. This is the known statistical limitation, and
  the README limitations section (`T-DOC-01`) should say it. The leak rate stays under
  the bar because most such requests also carry another detected value, which triggers
  anonymization.

## Pitfalls for the next session

- **Never edit the generated datasets by hand.** Change `generate.ts` and regenerate;
  `pnpm test` fails otherwise.
- **The runner tests fake only the gateway.** Tests that check exact simulate call counts
  must use `--only routing`, now that the leak eval also runs against the gateway.
- **Kill local service children after a run on Windows** (see the `T-007-02` record). This
  time the gateway ran on port 3100 to avoid any leftover on 3000.

## Links

- Spec / plan / tasks: `specs/007-evals-gate/`
- ADRs: none added
- Related task records: `docs/tasks/done/T-007-02-eval-runner.md`, `docs/tasks/done/T-004-07-corpus-and-metrics.md`
