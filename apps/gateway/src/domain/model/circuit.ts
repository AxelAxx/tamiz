/**
 * A target's circuit breaker state (spec 003 FR-006 … FR-008, research R-04,
 * data-model section 2.4).
 *
 * Storage keeps a snapshot (`CircuitStatePort`); the state is a pure function of that
 * snapshot, the time and the cool-down:
 * - **open** while the cool-down runs (`now < openUntil`);
 * - **half_open** once it has elapsed and the trial is still pending;
 * - **closed** otherwise.
 * If `openUntil` is further away than one cool-down, the clock moved backwards; the
 * circuit is then treated as half-open so that it is never stuck open (spec edge case).
 */
export const CIRCUIT_STATES = ["closed", "open", "half_open"] as const;
export type CircuitState = (typeof CIRCUIT_STATES)[number];

export interface CircuitSnapshot {
  /** Consecutive counted failures since the last success or opening. */
  readonly failures: number;
  /** Epoch milliseconds until which the circuit is open; absent when it was never opened. */
  readonly openUntil?: number;
  /** Set when the circuit opens; cleared by a success. */
  readonly trialPending: boolean;
}

export const CLOSED_CIRCUIT: CircuitSnapshot = { failures: 0, trialPending: false };

/** Milliseconds left of the cool-down, in `[0, cooldownMs]`; 0 unless open. */
export function remainingCooldownMs(
  snapshot: CircuitSnapshot,
  nowMs: number,
  cooldownMs: number,
): number {
  if (snapshot.openUntil === undefined) return 0;
  const remaining = snapshot.openUntil - nowMs;
  return remaining > 0 && remaining <= cooldownMs ? remaining : 0;
}

export function stateAt(
  snapshot: CircuitSnapshot,
  nowMs: number,
  cooldownMs: number,
): CircuitState {
  if (remainingCooldownMs(snapshot, nowMs, cooldownMs) > 0) return "open";
  return snapshot.trialPending ? "half_open" : "closed";
}
