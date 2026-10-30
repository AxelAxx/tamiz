/**
 * Where spans go (spec 006 FR-009, FR-010, research R-09, R-10, data-model section 3).
 *
 * The application opens one request span per request and one attempt span per provider
 * call; the adapter maps them to OpenTelemetry. Attribute values are scalars or string
 * lists, so a whole message cannot be passed by accident, and the callers only ever set
 * ids, enums, counts and durations. The default is `NOOP_TRACER`: tracing off costs
 * nothing but a function call.
 */
import type { ModelTarget } from "../../domain/model/model-target.js";

export type SpanValue = string | number | boolean | ReadonlyArray<string>;
export type SpanAttributes = Readonly<Record<string, SpanValue>>;

export interface SpanHandle {
  set(attributes: SpanAttributes): void;
  event(name: string, attributes?: SpanAttributes): void;
  /** Marks the span as failed with `error.type` (an enum value, never a message). */
  fail(errorType: string): void;
}

export interface RequestSpan extends SpanHandle {
  /** Runs `fn` with this span active, so attempt spans and events attach to it. */
  run<T>(fn: () => Promise<T>): Promise<T>;
  /** Ends the span; later calls do nothing. */
  end(): void;
}

export interface TracerPort {
  /** Starts a `tamiz.request` span; the caller ends it (streams outlive the use case). */
  startRequest(): RequestSpan;
  /** Runs one provider attempt in a `chat {model}` span, child of the active request span. */
  attempt<T>(target: ModelTarget, fn: (span: SpanHandle) => Promise<T>): Promise<T>;
}

const NOOP_SPAN: RequestSpan = {
  set: () => {},
  event: () => {},
  fail: () => {},
  run: (fn) => fn(),
  end: () => {},
};

export const NOOP_TRACER: TracerPort = {
  startRequest: () => NOOP_SPAN,
  attempt: (_target, fn) => fn(NOOP_SPAN),
};
