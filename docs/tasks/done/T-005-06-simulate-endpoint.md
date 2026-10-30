# T-005-06 — `SimulatePolicy` and `POST /v1/simulate`

| Field | Value |
|---|---|
| Task | `T-005-06` (see `docs/tasks/BACKLOG.md`) |
| Feature | `005-privacy-aware-routing` |
| Spec | `specs/005-privacy-aware-routing/spec.md` (FR-018, FR-019; US5-1 … US5-4); `tasks.md` Phase 5 (T044–T050) and the feature polish (T051–T054) |
| Branch / PR | `T-005-06-simulate-endpoint` / PR opened after this commit |
| Date | 2026-10-30 |
| Session | Claude Code (Claude Opus 5.5), side session (merge authority delegated by Alex) |
| Status | done; feature 005 complete |

## What was done

`POST /v1/simulate` takes the chat completion body, uses the same API key and calls no
provider. It runs inspection, classification and the decision, and answers:
- the sensitivity and the detector status;
- the entities (message index, kind, UTF-16 offsets, score; never values);
- the matched rule, the decision (`route` / `block`), the privacy action, the chain and
  the allowed residencies;
- for a block, `blockReason`;
- for `anonymize`, the exact `providerMessages` (notice + placeholders) and the notice
  version.

`SimulatePolicy` reuses `decideWithPrivacy` and `protectMessages`. Its dependencies
exclude the provider registry, so a simulation cannot call a model. The contract
`SimulateResponseSchema` lives in `@tamiz/contracts`, is a named component in
`/openapi.json`, and parses the spec's `contracts/simulate.example.json`.

The feature polish is in this PR:
- README status (005 done);
- `docs/architecture.md` (request flow with inspection, block, anonymize and restore);
- the gateway README (the simulator row);
- `CLAUDE.md` section 12 (`docker compose up privacy`).

## Files touched

- `packages/contracts/src/simulate.ts` (new), `index.ts` (T047).
- `apps/gateway/src/application/use-cases/simulate-policy.ts` (new) (T048). `route-inference.ts`: `decideWithPrivacy` takes only the deps it needs.
- `apps/gateway/src/presentation/routes/simulate.ts` (new), `presentation/openapi-schemas.ts` (`SimulateResponse` component), `presentation/app.ts` (`simulatePolicy` dep) (T049).
- `apps/gateway/src/main.ts`: `simulatePolicy(routing)`.
- Tests:
  - `packages/contracts/test/simulate.test.ts` (T044);
  - `apps/gateway/test/simulate.test.ts`: 8 HTTP scenarios (T045, T046);
  - test app helpers gain `simulatePolicy`.
- Polish (T051–T053): `README.md`, `docs/architecture.md`, `apps/gateway/README.md`, `CLAUDE.md`.
- `specs/005-privacy-aware-routing/tasks.md`: T044–T054 ticked; all 54 are done. `docs/tasks/BACKLOG.md`.

## Decisions

- **The use case is tested through HTTP**, as in `T-005-04` and `T-005-05`. Every
  scenario scripts the providers to throw, so a provider call fails the test (US5-1).
- **Simulations emit the privacy events.** They come from `inspectSensitivity` and
  `privacy.action`. They emit no attempt, fallback or circuit events, because nothing is
  executed (US5-3, asserted). Feature 006 decides whether simulations get their own
  audit entries.
- **A detector failure is part of the answer** (`detector`, `sensitivity: unknown`), not
  an HTTP error. An operator simulating while the service is down sees what the gateway
  would do: fail closed.
- **The blocked response has `allowedResidencies: []`**, since no target is allowed. The
  contract's refinement enforces `blockReason` ⇔ `decision: block`.

## How it was verified

```bash
pnpm lint        # clean
pnpm typecheck   # 0 errors
pnpm arch        # ✔ no dependency violations found
pnpm test        # Test Files 79 passed (79); Tests 842 passed | 12 skipped (854)
pnpm build       # pass
```

Quickstart run (T054). These are real services on this machine: the privacy service
(`uv run python -m privacy.main`) and the gateway (`tsx src/main.ts`, `default.yaml`).

- §3 simulate, the summary with a name and an email →
  - `high`, `anonymize`, chain `[ollama-llama, mistral-small]`;
  - `providerMessages` = the notice, plus "Resume el informe de <PERSON_1> (<EMAIL_1>)
    para el comité."
  - This matches `contracts/simulate.example.json`.
- §3 simulate, a DNI → `critical`, `restrict_to_local`, `[ollama-llama]`, the entity
  `DNI` at 10–19.
- §4 and §5: verified in `T-005-04` with the real privacy service (`critical` →
  `restrict_to_local`).
  - Not verified: the answer from a real local model; Ollama is not installed here.
  - Not verified: fail-closed with the real service stopped. It is covered by
    `chat-completions-privacy.test.ts` (US3-1, US3-4).
- §6 boot checks: covered by `env-005.test.ts` and the policy loader fixtures.
- §7 OpenAPI: `/v1/simulate` and `SimulateResponse` (test).
- `grep` for the test values over the gateway log: 0.

## Pending / follow-ups

Feature 005 is complete: PRs #28 … #33.

- **Feature 006** (`T-006-01`): audit entries with the level, the entity kinds and
  counts, and the action; simulations audited or not.
- **Feature 007**: the PII-leak eval runs through `/v1/simulate` with the leak metric of
  research R-12. The < 2 % name threshold is the open risk (PERSON recall 0.917 on corpus
  v1).
- **`T-OPS-01`**: compose with the gateway's `TAMIZ_PRIVACY_URL=http://privacy:8001`.
- No new backlog rows.

## Pitfalls for the next session

- **`createApp` now requires `simulatePolicy`.** Test apps get it from `NO_CHAT` or
  `createTestApp`.
- **`/v1/simulate` is under the `/v1/*` API-key middleware.** It needs `Authorization`
  like any other gateway call.

## Links

- Spec / plan / tasks: `specs/005-privacy-aware-routing/`
- ADRs: none added
- Related task records: `docs/tasks/done/T-005-0{1..5}-*.md`
