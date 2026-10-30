/**
 * Where the observable steps of a request's execution go (spec 003 FR-017, FR-018,
 * research R-12, data-model section 3.1).
 *
 * One event per attempt, retry wait, fallback, skipped target, residency block, circuit
 * change and failed stream. The shape has no field for message content, generated text,
 * credentials or upstream bodies, so none can be emitted. `emit` is fire-and-forget: a
 * sink must never throw into the request. Feature 003 logs the events; feature 006 adds
 * trace, metric and audit sinks behind the same port.
 */
import type { ProviderErrorCause } from "../../domain/errors.js";
import type { CircuitState } from "../../domain/model/circuit.js";
import type { FallbackReason } from "../../domain/model/fallback.js";
import type { ProviderName, Residency } from "../../domain/model/model-target.js";
import type { RequestId, TargetId } from "../../domain/model/units.js";

export const ROUTING_EVENT_TYPES = [
  "attempt.started",
  "attempt.succeeded",
  "attempt.failed",
  "retry.scheduled",
  "fallback",
  "target.skipped",
  "residency.blocked",
  "circuit.changed",
  "stream.failed",
] as const;
export type RoutingEventType = (typeof ROUTING_EVENT_TYPES)[number];

interface RoutingEventBase {
  readonly requestId: RequestId;
  readonly targetId: TargetId;
  readonly provider: ProviderName;
  readonly residency: Residency;
  /** ISO timestamp from the clock port. */
  readonly at: string;
}

export type RoutingEvent = RoutingEventBase &
  (
    | { readonly type: "attempt.started"; readonly attempt: number }
    | { readonly type: "attempt.succeeded"; readonly attempt: number; readonly durationMs: number }
    | {
        readonly type: "attempt.failed";
        readonly attempt: number;
        readonly durationMs: number;
        readonly reason: ProviderErrorCause;
      }
    | {
        readonly type: "retry.scheduled";
        readonly attempt: number;
        readonly waitMs: number;
        readonly reason: ProviderErrorCause;
      }
    | { readonly type: "fallback"; readonly reason: FallbackReason }
    | { readonly type: "target.skipped"; readonly reason: "circuit_open" }
    | { readonly type: "residency.blocked"; readonly allowed: ReadonlyArray<Residency> }
    | {
        readonly type: "circuit.changed";
        readonly from: CircuitState;
        readonly to: CircuitState;
      }
    | { readonly type: "stream.failed"; readonly reason: ProviderErrorCause }
  );

export interface RoutingEventsPort {
  emit(event: RoutingEvent): void;
}
