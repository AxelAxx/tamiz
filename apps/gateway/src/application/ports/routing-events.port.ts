/**
 * Where the observable steps of a request's execution go (spec 003 FR-017, FR-018,
 * research R-12, data-model section 3.1).
 *
 * One event per attempt, retry wait, fallback, skipped target, residency block, circuit
 * change and failed stream. The shape has no field for message content, generated text,
 * credentials or upstream bodies, so none can be emitted. `emit` is fire-and-forget: a
 * sink must never throw into the request. Feature 003 logs the events; feature 006 adds
 * trace, metric and audit sinks behind the same port.
 *
 * Feature 005 adds the privacy events (spec 005 FR-015). They carry levels, kinds and
 * counts, never content, and have no target: they happen before one is chosen.
 */
import type { ProviderErrorCause } from "../../domain/errors.js";
import type { CircuitState } from "../../domain/model/circuit.js";
import type { FallbackReason } from "../../domain/model/fallback.js";
import type { ProviderName, Residency } from "../../domain/model/model-target.js";
import type { PrivacyAction } from "../../domain/model/privacy-policy.js";
import type {
  DetectorFailure,
  EntityKind,
  Sensitivity,
  SensitivityLevel,
} from "../../domain/model/sensitivity.js";
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
  "privacy.inspected",
  "privacy.detector_failed",
  "privacy.action",
  "privacy.anonymized",
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

/** Steps of the privacy inspection (spec 005 FR-015): no target is involved yet. */
export type PrivacyEvent = { readonly requestId: RequestId; readonly at: string } & (
  | {
      readonly type: "privacy.inspected";
      readonly level: SensitivityLevel;
      readonly counts: Readonly<Partial<Record<EntityKind, number>>>;
      readonly cached: boolean;
    }
  | { readonly type: "privacy.detector_failed"; readonly reason: DetectorFailure }
  | {
      readonly type: "privacy.action";
      readonly sensitivity: Sensitivity;
      readonly action: PrivacyAction;
      readonly ruleId: string;
    }
  | { readonly type: "privacy.anonymized"; readonly placeholders: number }
);

export type RoutingEvent = PrivacyEvent | TargetEvent;

export type TargetEvent = RoutingEventBase &
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
