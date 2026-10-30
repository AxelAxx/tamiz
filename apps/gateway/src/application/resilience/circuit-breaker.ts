/**
 * Per-target circuit breaker over the circuit-state port (spec 003 FR-006 … FR-009, US4,
 * research R-04, R-05).
 *
 * `admit` decides before a call: closed → call; open → skip with the remaining
 * cool-down; half-open → the single trial if its lease can be taken, skip otherwise.
 * `onResult` updates the state after the call:
 * - a success closes the circuit;
 * - a counted failure (retryable: rate limited, 5xx, timeout, network) increments the
 *   count and opens the circuit at the threshold;
 * - a failed trial reopens it at once, and an `aborted` trial counts as failed (spec
 *   edge case);
 * - other failures (credential or request rejected, malformed body) say nothing about
 *   the provider's health and change nothing.
 * Every transition is a `circuit.changed` event.
 */
import type { ProviderError } from "../../domain/errors.js";
import { type CircuitState, remainingCooldownMs, stateAt } from "../../domain/model/circuit.js";
import type { ModelTarget } from "../../domain/model/model-target.js";
import type { Milliseconds, RequestId } from "../../domain/model/units.js";
import type { Result } from "../../domain/result.js";
import type { CircuitStatePort } from "../ports/circuit-state.port.js";
import type { ClockPort } from "../ports/clock.port.js";
import type { RoutingEventsPort } from "../ports/routing-events.port.js";

export interface BreakerSettings {
  /** Consecutive counted failures that open a closed circuit. */
  readonly failureThreshold: number;
  readonly cooldownMs: Milliseconds;
}

export interface BreakerDeps {
  readonly state: CircuitStatePort;
  readonly clock: ClockPort;
  readonly events: RoutingEventsPort;
  readonly settings: BreakerSettings;
}

export interface BreakerContext {
  readonly requestId: RequestId;
}

export type Admission =
  | { readonly kind: "call" }
  | { readonly kind: "trial" }
  /** `remainingMs` is 0 when a trial is in flight and the cool-down is over. */
  | { readonly kind: "skip"; readonly remainingMs: number };

export interface CircuitBreaker {
  /** `leaseMs` bounds how long a trial may hold the half-open slot (the attempt timeout). */
  admit(target: ModelTarget, context: BreakerContext, leaseMs: Milliseconds): Promise<Admission>;
  onResult(
    target: ModelTarget,
    context: BreakerContext,
    result: Result<unknown, ProviderError>,
    admission: Admission,
  ): Promise<void>;
}

function counts(error: ProviderError, admission: Admission): boolean {
  return error.retryable || (admission.kind === "trial" && error.cause === "aborted");
}

export function createCircuitBreaker(deps: BreakerDeps): CircuitBreaker {
  const { state, clock, events, settings } = deps;

  function changed(
    target: ModelTarget,
    context: BreakerContext,
    from: CircuitState,
    to: CircuitState,
  ): void {
    events.emit({
      type: "circuit.changed",
      requestId: context.requestId,
      targetId: target.id,
      provider: target.provider,
      residency: target.residency,
      at: clock.now().toISOString(),
      from,
      to,
    });
  }

  return {
    async admit(target, _context, leaseMs) {
      const snapshot = await state.snapshot(target.id);
      const now = clock.now().getTime();
      switch (stateAt(snapshot, now, settings.cooldownMs)) {
        case "closed":
          return { kind: "call" };
        case "open":
          return {
            kind: "skip",
            remainingMs: remainingCooldownMs(snapshot, now, settings.cooldownMs),
          };
        case "half_open":
          return (await state.tryAcquireTrial(target.id, leaseMs))
            ? { kind: "trial" }
            : { kind: "skip", remainingMs: 0 };
      }
    },

    async onResult(target, context, result, admission) {
      if (admission.kind === "skip") return;
      if (result.ok) {
        await state.recordSuccess(target.id);
        if (admission.kind === "trial") changed(target, context, "half_open", "closed");
        return;
      }
      if (!counts(result.error, admission)) return;
      if (admission.kind === "trial") {
        await state.open(target.id, settings.cooldownMs);
        changed(target, context, "half_open", "open");
        return;
      }
      const failures = await state.recordFailure(target.id);
      if (failures >= settings.failureThreshold) {
        await state.open(target.id, settings.cooldownMs);
        changed(target, context, "closed", "open");
      }
    },
  };
}
