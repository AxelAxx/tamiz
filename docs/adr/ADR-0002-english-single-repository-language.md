# ADR-0002 — English as the single repository language

| Field | Value |
|---|---|
| Status | accepted |
| Date | 2026-10-18 |
| Deciders | Alex |
| Related | constitution "Repository Rules"; task `T-000-01` |

## Context

The maintainer works and chats in Spanish, and the foundational document
(`docs/tamiz-project.md`) is written in Spanish. The product targets European teams and
is a public portfolio project aimed at an international audience of reviewers, hiring
managers and potential contributors. The tooling (Spec Kit templates, Biome, commitlint,
Conventional Commits) assumes English. Mixing languages inside a repository makes
identifiers inconsistent, searches unreliable and reviews harder.

At the same time, the core of the product is the detection of **Spanish** personal
identifiers (DNI, NIE, CIF, IBAN, phone numbers, social security numbers) in Spanish
text, so Spanish text must exist in the repository as data.

## Decision

We will write everything in the repository in English: source code, identifiers,
comments, docstrings, specs, plans, tasks, ADRs, documentation, READMEs, commit messages,
pull request titles and descriptions, `CLAUDE.md` and the constitution.

The only Spanish allowed is **content**, not documentation:

- synthetic eval datasets under `packages/evals/datasets/`;
- test corpora for the Spanish PII recognizers in `services/privacy/tests/`;
- fixtures that reproduce Spanish user input;
- the foundational document `docs/tamiz-project.md`, kept verbatim as the historical
  source, and marketing copy explicitly intended for a Spanish-speaking audience under
  `docs/marketing/`.

Conversations between the maintainer and AI assistants may be in Spanish; their output
into the repository is in English.

## Consequences

- Reviewers and tools see one language; identifiers, logs and error codes are
  consistent and greppable.
- AI sessions must translate the maintainer's Spanish instructions into English
  artifacts; `CLAUDE.md` states this explicitly so no session has to guess.
- Spanish-language test data is labelled as such in its folder README so nobody
  "fixes" it.
- Enforcement: review checklist; a lightweight lint (regex for common Spanish stop words
  in comments and docs) may be added later if drift appears, tracked as a backlog item if
  needed.

## Alternatives considered

- **Spanish for docs, English for code** — closer to the maintainer's habit, but splits
  the audience and makes specs unusable by non-Spanish reviewers; rejected.
- **Bilingual docs** — doubles the maintenance cost of a two-week project; rejected.
