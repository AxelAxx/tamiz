# Specification Quality Checklist: Privacy Service

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-10-30
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs) — see note 1
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders — see note 2
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain — see note 3
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Success criteria are technology-agnostic (no implementation details) — see note 4
- [x] All acceptance scenarios are defined
- [x] Edge cases are identified
- [x] Scope is clearly bounded
- [x] Dependencies and assumptions identified

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria
- [x] User scenarios cover primary flows
- [x] Feature meets measurable outcomes defined in Success Criteria
- [x] No implementation details leak into specification — see note 1

## Notes

1. As in features 002 and 003, libraries, file locations and code shapes are left to
   `plan.md` (Presidio, spaCy, FastAPI and uv appear only there). The spec names: the two
   endpoint paths and the `<KIND_n>` placeholder shape, because the backlog rows
   `T-004-03` and `T-004-06` and feature 005 depend on them; the closed lists of kinds and
   levels, because they are the contract with the gateway (`T-005-02`); OpenAPI once
   (story 6), because constitution II fixes it as the contract format between the Python
   service and the gateway; and the check-digit algorithms by name (mod 23, mod 97),
   because they *are* the requirement.
2. Stakeholders are the maintainer, portfolio reviewers and future Claude Code sessions;
   the stories are written for the gateway (as a client), a clinic operator, a
   maintainer and an operator deploying the service.
3. No clarification was needed. Every open point had a default from `CLAUDE.md`
   (sections 2, 5, 10), the constitution (II, IV, V) or the backlog rows. The choices
   made are listed under Assumptions for Alex to confirm or overturn in review, in
   particular:
   - the sensitivity mapping per kind (critical: DNI, NIE, NSS, IBAN, card; high: person,
     phone, email; low: CIF, location);
   - precision ≥ 0.95 added next to the backlog's recall ≥ 0.95, and CIF and email added
     to the structured kinds under threshold; names gated at recall ≥ 0.80 here (the
     < 2 % name-leak threshold belongs to feature 007);
   - no restore endpoint (the gateway restores, so maps never come back to the service);
   - no authentication between gateway and service (internal network only);
   - one Spanish language setup for every text; special categories of data out of scope.
4. Success criteria are counts and ratios over the corpus and the test suite, plus one
   latency bound measured in CI after warm-up (the 002/003 convention); they name no
   tool.
5. Items marked incomplete require spec updates before `/speckit-clarify` or `/speckit-plan`.
