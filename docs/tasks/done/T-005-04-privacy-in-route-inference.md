# T-005-04 — Inspection, privacy actions and anonymization in the request path

| Field | Value |
|---|---|
| Task | `T-005-04` (see `docs/tasks/BACKLOG.md`) |
| Feature | `005-privacy-aware-routing` |
| Spec | `specs/005-privacy-aware-routing/spec.md` (FR-011 … FR-015; US1-1 … US1-6, US2-1 … US2-6, US3-1, US3-4; SC-002, SC-006); `tasks.md` Phase 3 (T025–T037); `research.md` R-01, R-05, R-06, R-10 |
| Branch / PR | `T-005-04-privacy-in-route-inference` / PR opened after this commit |
| Date | 2026-10-30 |
| Session | Claude Code (Claude Opus 5.5), side session (merge authority delegated by Alex) |
| Status | done |

## What was done

Every request is now inspected by the privacy service before it is routed, and the
policy's privacy action is applied (`decideWithPrivacy`).

**Inspection and decision.** The use cases run, in order:
1. inspection, in parallel with loading the active policy;
2. classification with the inspection;
3. the decision;
4. a `privacy.action` event.

**What happens per action:**
- **block**, or detection failed with `onDetectorError: block`: no provider is called;
  the answer is `451 policy_blocked` or `503 privacy_unavailable`.
- **restrict_to_local**: the request goes to the local route only.
- **anonymize** (`protectMessages`):
  - every detected value in every message (system, user, assistant) becomes its
    `<KIND_n>` placeholder;
  - the versioned notice `prompts/anonymization-notice.v1.md` is prepended as a system
    message;
  - the provider's answer is restored in one pass over the mapping.

  The mapping lives only in the `restore` closure. Usage and cost are the anonymized
  exchange's (US2-6).

**Placeholder rule.** The rule is ported to TypeScript (`domain/model/placeholders.ts`).
It reproduces all 8 shared vectors and spec 004's example. Python runs the same vectors
(`test_shared_vectors.py`).

**Headers.** Responses, errors included, carry `x-tamiz-sensitivity` and
`x-tamiz-privacy` (`allow`, `anonymize;notice=v1`, `restrict_to_local`, `block`).

**Streaming.** Streams get the same inspection and actions before the first token, and
each delta is restored. Placeholders split across chunks are `T-005-05`'s buffer; until
then one reaches the client as placeholder text, never as a leaked value.

## Files touched

- `apps/gateway/src/domain/model/placeholders.ts` (new): `anonymizeMessages`, `restore`, `PLACEHOLDER_PATTERN` (T030).
- `apps/gateway/src/domain/model/sensitivity.ts`: `NOT_INSPECTED` → `CLEAN_INSPECTION`. It is no longer used by production code, and `classifyTask` now requires the inspection (T036).
- `apps/gateway/src/application/use-cases/protect-messages.ts` (new): anonymize, notice, restore closure.
- `apps/gateway/src/application/use-cases/route-inference.ts`:
  - deps `inspect` and `anonymizationNotice`;
  - `decideWithPrivacy`, `protectForProvider`;
  - restored completion, `noticeVersion`
  - (T033).
- `apps/gateway/src/application/use-cases/stream-inference.ts`: the same before the stream; restored deltas.
- `apps/gateway/src/application/ports/routing-events.port.ts`, `infrastructure/telemetry/log-routing-events.ts`: `privacy.action`, `privacy.anonymized` (T035).
- `apps/gateway/src/presentation/routes/chat-completions.ts`: the privacy headers on success and failure, and the OpenAPI headers (T034).
- `apps/gateway/src/infrastructure/privacy/anonymization-notice.ts` (new), `apps/gateway/prompts/anonymization-notice.v1.md` (new, English + Spanish) (T032).
- `apps/gateway/src/main.ts`:
  - the HTTP detector and the detection cache;
  - SHA-256 via `node:crypto`;
  - `inspectSensitivity`;
  - the notice loaded at boot, where a missing file stops the process
  - (T036).
- Tests:
  - `test/domain/placeholders.test.ts` (T025);
  - `services/privacy/tests/unit/test_shared_vectors.py` (T026);
  - `test/chat-completions-privacy.test.ts`: 13 HTTP scenarios, covering US1, US2, US3 and streams (T027, T028);
  - `test/privacy/no-leak.test.ts`: real pino logger, log sink, headers, 4 scenarios (T029);
  - `test/helpers/privacy.ts` (`inspectAs`, `cleanPrivacyDeps`);
  - existing setups gain clean privacy deps.
- `apps/gateway/README.md`, `specs/005-privacy-aware-routing/tasks.md` (T025–T037 ticked), `docs/tasks/BACKLOG.md`.

## Decisions

- **The application tests for this task are HTTP scenarios** (`app.request()` through
  `createTestApp`), not a separate use-case file. They exercise the same code plus the
  headers and the error mapping, in one place (T027 and T028 merged).
- **Streams already apply privacy in this task.** Leaving streams on the 003 path until
  `T-005-05` would have sent unanonymized text to providers for `stream: true`. Deltas
  are restored one by one now; the split-placeholder buffer is `T-005-05`.
- **Inspection and policy loading run in parallel.** Classification is synchronous, so
  "concurrently with classification" (FR-008) reduces to this today.
- **The notice is a file read at boot** (`loadAnonymizationNotice`), versioned by name,
  and reported in `x-tamiz-privacy: anonymize;notice=v1`. It is written in English and
  Spanish, because the target users write in Spanish.
- **`CLEAN_INSPECTION` replaces `NOT_INSPECTED`**, as the name of the "nothing found"
  inspection used by tests. `classifyTask(request, inspection)` no longer has a default,
  so production cannot skip inspection by accident.

## How it was verified

```bash
pnpm lint        # clean
pnpm typecheck   # 0 errors
pnpm arch        # ✔ no dependency violations found (85 modules, 284 dependencies cruised)
pnpm test        # Test Files 75 passed (75); Tests 812 passed | 12 skipped (824)
pnpm build       # pass
cd services/privacy && uv run pytest tests/unit/test_shared_vectors.py   # 8 passed
```

Manual end-to-end check:
- **Setup:** the real privacy service (`uv run python -m privacy.main`, port 8021) and
  the gateway (`tsx src/main.ts`, `local-only.yaml`, Ollama unreachable on purpose).
- **"Mi DNI es 12345678Z" →** `x-tamiz-sensitivity: critical`,
  `x-tamiz-privacy: restrict_to_local`, `x-tamiz-route: ollama-llama`, and 502 (no
  Ollama).
- **"Que tiempo hace hoy?" →** `none` / `allow`.
- **Logs:** `privacy.inspected` with `counts: {DNI: 1}` and `privacy.action` events.
  `grep -c 12345678Z` over both services' logs returned **0**.

Not verified: a real model answer through anonymization, because no provider is
reachable from this machine. Restoration is covered by the scripted-provider tests.

## Pending / follow-ups

- `T-005-05`: placeholder-safe streaming buffer.
- `T-005-06`: `POST /v1/simulate`. It can reuse `decideWithPrivacy` and
  `protectMessages`, without the provider call.
- No new backlog rows.

## Pitfalls for the next session

- **Long inline Bash heredocs with quotes still fail to parse here.** Write the Python
  edit script to the scratchpad and run it with a path argument.
- **Any test that builds `RouteInferenceDeps` needs `...cleanPrivacyDeps()`.** Use
  `inspect: inspectAs(...)` to script what the privacy service reports.
- **`provider.calls` in `createTestApp` records what providers received.** It is the
  place to assert that no value left the gateway.

## Links

- Spec / plan / tasks: `specs/005-privacy-aware-routing/`
- ADRs: none added
- Related task records: `docs/tasks/done/T-005-03-pii-detector-port.md`, `docs/tasks/done/T-004-06-reversible-anonymization.md`
