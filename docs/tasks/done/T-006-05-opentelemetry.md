# T-006-05 — OpenTelemetry with the GenAI conventions, routing events as span events, Jaeger

| Field | Value |
|---|---|
| Task | `T-006-05` (see `docs/tasks/BACKLOG.md`) |
| Feature | `006-audit-and-telemetry` |
| Spec | `specs/006-audit-and-telemetry/spec.md` (FR-009 … FR-011, FR-015; US5-1 … US5-5; SC-002); `tasks.md` Phase 4 (T024–T028); `research.md` R-09 … R-11 |
| Branch / PR | `T-006-05-opentelemetry` / PR opened after this commit |
| Date | 2026-10-30 |
| Session | Claude Code (Claude Opus 5.5), side session (merge authority delegated by Alex) |
| Status | done |

## What was done

Every request is now a trace.

**Spans.**
- `tamiz.request` (kind SERVER), one per request. It carries the decision as `tamiz.*`
  attributes:
  - request id, policy, rule, task type, sensitivity, privacy action;
  - `tamiz.entities.<KIND>` counts;
  - route, fallback count and targets;
  - tokens, cost;
  - `tamiz.streamed`, `tamiz.cancelled`.

  A failure sets `error.type` (the audit's error type) and an error status.
- `chat {model}` (kind CLIENT), one per provider attempt, child of the request span.
  - GenAI attributes: `gen_ai.operation.name`, `gen_ai.provider.name` (plus
    `gen_ai.system` while backends migrate), `gen_ai.request.model`,
    `gen_ai.response.model`, `gen_ai.response.finish_reasons`, `gen_ai.usage.input_tokens`
    and `gen_ai.usage.output_tokens`.
  - A failed attempt gets `error.type` set to the provider error cause.

**Events.**
- `routing.decision`, with the rule, action, sensitivity and the chain's target ids (or the
  block reason).
- From the routing-events port, through a new OTel sink:
  - `routing.fallback`, `routing.retry`, `routing.target_skipped`,
    `routing.residency_blocked`;
  - `circuit.changed`, `stream.failed`;
  - `privacy.inspected`, `privacy.detector_failed`, `privacy.action`,
    `privacy.anonymized`.

  Each lands on the active span.
- `fanOut` sends events to both the log sink and the OTel sink; a throwing sink is
  isolated.

**Export.** The standard variables decide:
- `OTEL_EXPORTER_OTLP_ENDPOINT` (or `…_TRACES_ENDPOINT`) registers a Node tracer
  provider with an OTLP/HTTP exporter behind a batch processor;
- `OTEL_SERVICE_NAME` defaults to `tamiz-gateway`;
- the SDK honours `OTEL_TRACES_SAMPLER` and `OTEL_SDK_DISABLED`;
- without an endpoint nothing is registered (a no-op).

Shutdown flushes pending spans. `docker-compose.yml` gains `jaeger`
(`jaegertracing/jaeger:2.22.0`, UI 16686, OTLP/HTTP 4318).

## Files touched

- `apps/gateway/src/application/ports/tracer.port.ts` (new: `TracerPort`, `RequestSpan`, `SpanHandle`, `NOOP_TRACER`); `application/tracing/with-tracing.ts` (new: `withTracing`, `withTracingStream`).
- `apps/gateway/src/application/resilience/execute-chain.ts` (optional `tracer`, attempt spans, `describe`); `use-cases/route-inference.ts`, `stream-inference.ts` (pass the tracer and the GenAI attributes).
- `apps/gateway/src/infrastructure/telemetry/{otel-tracer,otel-routing-events,fan-out,otel-setup}.ts` (new); `main.ts`.
- `apps/gateway/package.json`:
  - dependencies `@opentelemetry/api` 1.9.1, `sdk-trace-node`, `sdk-trace-base` and `resources` 2.12.0, `exporter-trace-otlp-http` 0.223.0;
  - dev dependency `@opentelemetry/context-async-hooks` 2.12.0.
- Tests:
  - `test/telemetry/spans.test.ts` (T024);
  - `test/privacy/no-leak.test.ts`, extended to spans (T025);
  - `test/telemetry/otel-setup.test.ts` (T026);
  - `test/helpers/tracing.ts`, test app `tracer` option.
- `docker-compose.yml`, `.env.example`, `apps/gateway/README.md`, `CLAUDE.md` §12, `specs/006-audit-and-telemetry/tasks.md` (T024–T028), `docs/tasks/BACKLOG.md`.

## Decisions

- **The OTel 2.x line, not 3.0.**
  - `@opentelemetry/resources` and `context-async-hooks` 3.0.0 came out on 2026-10-20,
    ten days before this task, and the stable `sdk-trace-node` 2.12.0 still depends on
    the 2.x packages.
  - `@opentelemetry/api` is pinned to 1.9.1, because `sdk-trace-node` 2.12 declares
    `api <1.10.0`.
  - Moving to 3.x is a Renovate update, done once the ecosystem settles.
- **The GenAI names were checked with Context7** against the semantic conventions:
  - the GenAI attributes moved to a dedicated repository;
  - the names used here are current;
  - content attributes (`gen_ai.input.messages`, `gen_ai.output.messages`,
    `gen_ai.system_instructions`) are opt-in, and Tamiz never sets them.
- **The request span is started and ended explicitly** (`startRequest`, `run`, `end`),
  not as a callback. A stream outlives the use case, so its span ends with the last part.
  Each `next()` of the stream runs with the span active, so mid-stream events attach to
  it.
- **A stream attempt span ends at the first token.** Its usage is on the request span.
- **No auto-instrumentation** (R-09): HTTP and `fetch` instrumentation could record URLs
  and bodies. Request spans are therefore roots.
- **Attempt start, success and failure are not repeated as events**: the attempt spans
  are those facts. `audit.dropped` belongs to no request and is not mapped either.

## How it was verified

```bash
pnpm lint        # clean (pre-existing warning and infos only)
pnpm typecheck   # 0 errors
pnpm arch        # ✔ no dependency violations found (124 modules, 437 dependencies cruised)
pnpm test        # Test Files 92 passed (92); Tests 930 passed | 27 skipped (957)
pnpm build       # pass
```

- **Real export.** `otel-setup.test.ts` registers the real provider and exporter against
  a local HTTP collector. It checks that a span reaches `/v1/traces` with the service
  name.
- **No Jaeger UI check.** Docker is not running on this machine, so the manual check in
  the Jaeger UI was not possible. The export path to an OTLP/HTTP endpoint is exercised
  by the collector test above, and the Jaeger check is left to `T-OPS-01`, whose
  acceptance already includes "visible in … Jaeger".

## Pending / follow-ups

- 006 polish (T034–T036): README status, `docs/architecture.md`, quickstart run.
- The OpenTelemetry 3.x upgrade comes through Renovate; no backlog row.

## Pitfalls for the next session

- **Context propagation needs a global context manager.**
  - `NodeTracerProvider.register()` installs one in production.
  - Tests install `AsyncLocalStorageContextManager` in `test/helpers/tracing.ts` and use a
    non-global provider per capture.
  - Without a context manager, attempt spans become roots and the events sink finds no
    active span.
- **`inspectAs` in tests skips `inspectSensitivity`**, so `privacy.inspected` does not
  appear there. The real use case emits it.
- **Any new span attribute must stay an id, enum, count or duration.** The no-leak test
  greps the spans for the test values.

## Links

- Spec / plan / tasks: `specs/006-audit-and-telemetry/`
- ADRs: none added
- Related task records: `docs/tasks/done/T-006-02-audit-entry.md`, `docs/tasks/done/T-003-04-fallback-chain.md`
