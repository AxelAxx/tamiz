# ADR-0003 — Apache-2.0 licence

| Field | Value |
|---|---|
| Status | accepted |
| Date | 2026-10-18 |
| Deciders | Alex |
| Related | task `T-000-01` (follow-up), `T-001-02` (root `package.json` licence field), `T-OPS-00` |

## Context

Tamiz is a public portfolio project whose goal is to be adopted and read by companies,
in particular small European teams in regulated sectors. The licence must make adoption
easy, keep the author's attribution visible, say something explicit about patents, and
protect the project name from being reused by redistributors as if it were theirs.

## Decision

We will license the repository under the **Apache License, Version 2.0**, copyright
holder "Alex Martinez", year 2026. The full official text is committed verbatim as
`LICENSE` at the repository root (fetched from
`https://www.apache.org/licenses/LICENSE-2.0.txt`, not retyped), together with a `NOTICE`
file that redistributors must preserve. The root `package.json` carries
`"license": "Apache-2.0"` (task `T-001-02`) and the README states the licence.

Reasons:

- **Permissive**: companies can adopt, modify and embed Tamiz without copyleft
  obligations, which serves the portfolio goal.
- **Mandatory attribution and NOTICE preservation**: section 4 keeps the author
  visible in every redistribution.
- **Explicit patent grant**: section 3 gives users a patent licence and terminates it
  for anyone who litigates.
- **Name protection**: section 6 withholds any trademark licence, so redistributors
  cannot present their forks as "Tamiz".

## Consequences

- Contributors must keep the `LICENSE` and `NOTICE` files and licence headers where
  present; CI may later check the `package.json` licence field.
- Third-party code included in the repository must be Apache-2.0 compatible and listed
  in `NOTICE` when its licence requires attribution.
- The licence is stated in the README and in the root `package.json`.

## Alternatives considered

- **MIT** — simpler, but silent on patents and offers no protection for the project
  name; rejected as weaker on both points.
- **AGPL-3.0** — strong copyleft would deter the very companies the project wants to
  reach; rejected as adoption-hostile.
