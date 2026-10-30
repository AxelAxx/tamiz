# T-005-03 — PII detector port, HTTP adapter, contract mirror, detection cache

| Field | Value |
|---|---|
| Task | `T-005-03` (see `docs/tasks/BACKLOG.md`) |
| Feature | `005-privacy-aware-routing` |
| Spec | `specs/005-privacy-aware-routing/spec.md` (FR-006 … FR-010, FR-015; US3-1 … US3-3, US3-5, US7-1 … US7-4); `tasks.md` Phase 2 (T012–T024); `research.md` R-02, R-03, R-08, R-09 |
| Branch / PR | `T-005-03-pii-detector-port` / PR opened after this commit |
| Date | 2026-10-30 |
| Session | Claude Code (Claude Opus 5.5), side session (merge authority delegated by Alex) |
| Status | done |

## What was done

The gateway can now ask the privacy service where a request's personal data is, safely
and cheaply.

- **`PiiDetectorPort`** (`inspect(messages, signal) → Inspection`) never rejects:
  failures are values (`unavailable`, `timeout`, `contract`).
- **The HTTP adapter** makes one `POST /analyze` over the message contents joined by a
  blank line.
  - The answer is validated against the new Zod mirror of the service's contract.
  - Code-point offsets are converted to UTF-16 and mapped back to each message.
  - A finding outside one message, an unknown kind, a bad body or a 4xx is a `contract`
    failure; a 5xx or a network error is `unavailable` (US3-3).
- **The `inspectSensitivity` use case** runs the detector under a clock-port timeout
  (default 2 s, US3-2), behind an LRU + TTL cache keyed by SHA-256 of the messages.
  - The cache holds positions only (US7-1 … US7-4), and failures are never cached.
  - It emits `privacy.inspected` / `privacy.detector_failed` routing events with
    levels, kinds and counts only (FR-015).
- **A drift test** keeps the Zod mirror equal to `services/privacy/openapi.json` (FR-010).
- **`TAMIZ_PRIVACY_URL` is required** (US3-5), plus timeout and cache settings.

## Files touched

- `packages/contracts/src/privacy-service.ts` (new), `index.ts`: the mirror (T017).
- `apps/gateway/src/application/ports/{pii-detector,detection-cache}.port.ts` (new) (T019).
- `apps/gateway/src/infrastructure/privacy/http-pii-detector.ts` (new) (T020).
- `apps/gateway/src/infrastructure/cache/in-memory-detection-cache.ts` (new) (T021).
- `apps/gateway/src/application/use-cases/inspect-sensitivity.ts` (new) (T022).
- `apps/gateway/src/application/ports/routing-events.port.ts`: `PrivacyEvent`. Target events are now named `TargetEvent`, and `RoutingEvent = PrivacyEvent | TargetEvent`. `infrastructure/telemetry/log-routing-events.ts`: new fields; `privacy.detector_failed` is `warn`.
- `apps/gateway/src/infrastructure/config/env.ts`: `TAMIZ_PRIVACY_URL` (required), `_TIMEOUT_MS`, `_CACHE_MAX_ENTRIES`, `_CACHE_TTL_MS` → `GatewayConfig.privacy` (T023).
- `.env.example`, `apps/gateway/README.md`: the new variables.
- Tests:
  - `test/contracts/privacy-service-drift.test.ts` (T012);
  - `test/privacy/http-pii-detector.test.ts` (T013, MSW);
  - `test/cache/in-memory-detection-cache.test.ts` (T014);
  - `test/application/inspect-sensitivity.test.ts` (T015);
  - `test/config/env-005.test.ts` (T016);
  - env and boot tests updated with `TAMIZ_PRIVACY_URL`;
  - `test/resilience/helpers.ts`: `recordingEvents` now has `all` plus `events` (target events only).
- `specs/005-privacy-aware-routing/tasks.md` (T012–T024 ticked), `docs/tasks/BACKLOG.md`.

## Decisions

- **No `FakePiiDetector` in `@tamiz/test-utils`.** The generic `createScriptedPort`
  already does it (scripted answers and a call log). A new fake would duplicate it
  (constitution X).
- **The adapter resolves `fetch` per call.** It used to capture `globalThis.fetch` at
  construction, which sat before MSW's interceptor and silently bypassed it in tests.
  Production behaviour is the same.
- **The cache key is `sha256("analyze-v1\0" + JSON.stringify(messages))`.** JSON keeps
  `["a","b"]` and `["a\n\nb"]` apart, which the joined text would not. The version prefix
  invalidates entries when the detection options change. The hash function is injected
  (`main.ts` will pass Node's SHA-256), so `application` imports no `crypto`.
- **There is no retry of the detector (R-09).** A failed inspection goes straight to the
  policy's `onDetectorError`.
- **Privacy events have no target fields.** The port's union was split (`TargetEvent`
  for the 003 events). The log sink copies only the declared fields, so counts and
  levels are logged and content is not.
- **The detector is not wired into `main.ts` yet** (T023 said "build, not used"). Wiring
  it is `T-005-04`'s first step; constructing it unused would only add dead code.
  `TAMIZ_PRIVACY_URL` is already required, so deployments learn about the variable now.

## How it was verified

```bash
pnpm lint        # clean
pnpm typecheck   # 0 errors
pnpm arch        # ✔ no dependency violations found (82 modules, 265 dependencies cruised)
pnpm test        # Test Files 72 passed (72); Tests 780 passed | 12 skipped (792)
pnpm build       # pass
```

- The adapter suite covers:
  - joined messages and per-message offsets;
  - an emoji before an email (UTF-16 conversion);
  - 5xx, `not_ready` and network errors → `unavailable`;
  - a non-JSON body, a missing field, an unknown kind, an offset past the end, a 4xx and
    a boundary crossing → `contract`;
  - an aborted call → `timeout`.
- The inspection suite runs on the fake clock: the timeout fires at exactly 2 000 ms, and
  no sleeper is left after an answer.

## Pending / follow-ups

- `T-005-04` wires everything:
  - `main.ts` builds the detector, cache and SHA-256 hash;
  - the use cases call `inspectSensitivity` instead of `NOT_INSPECTED`;
  - anonymization, headers and errors.
- No new backlog rows.

## Pitfalls for the next session

- **In tests, `recordingEvents().events` holds only target events.** Use `.all` to see
  the privacy events.
- **Every gateway environment now needs `TAMIZ_PRIVACY_URL`.** That includes test envs,
  boot tests and local `.env`. The boot test's value is a dummy host, which is never
  called while requests are uninspected; it will be in `T-005-04`, so the boot test
  will need a stub or a policy whose `onDetectorError` result is tolerable.
- **Zod 4 `z.record(enum, …)` requires every key.** Use `z.partialRecord` for `counts`.

## Links

- Spec / plan / tasks: `specs/005-privacy-aware-routing/`
- ADRs: none added
- Related task records: `docs/tasks/done/T-005-02-domain-privacy-policy.md`, `docs/tasks/done/T-004-03-analyzer-analyze-endpoint.md`
