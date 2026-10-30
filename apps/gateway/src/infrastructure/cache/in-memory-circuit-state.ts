/**
 * `CircuitStatePort` in process memory (spec 003 FR-010): correct for a single gateway
 * instance and used by tests. Times come from the clock port, so the fake clock drives
 * cool-downs and trial leases.
 */
import type { CircuitStatePort } from "../../application/ports/circuit-state.port.js";
import type { ClockPort } from "../../application/ports/clock.port.js";
import { type CircuitSnapshot, CLOSED_CIRCUIT } from "../../domain/model/circuit.js";

interface Entry {
  snapshot: CircuitSnapshot;
  /** Epoch milliseconds until which the current trial holds the lease. */
  trialLeaseUntil?: number;
}

export function createInMemoryCircuitState(clock: ClockPort): CircuitStatePort {
  const entries = new Map<string, Entry>();

  const entry = (targetId: string): Entry => {
    let found = entries.get(targetId);
    if (found === undefined) {
      found = { snapshot: CLOSED_CIRCUIT };
      entries.set(targetId, found);
    }
    return found;
  };

  return {
    snapshot: async (targetId) => entry(targetId).snapshot,
    recordFailure: async (targetId) => {
      const current = entry(targetId);
      current.snapshot = { ...current.snapshot, failures: current.snapshot.failures + 1 };
      return current.snapshot.failures;
    },
    recordSuccess: async (targetId) => {
      entries.set(targetId, { snapshot: CLOSED_CIRCUIT });
    },
    open: async (targetId, cooldownMs) => {
      entries.set(targetId, {
        snapshot: {
          failures: 0,
          openUntil: clock.now().getTime() + cooldownMs,
          trialPending: true,
        },
      });
    },
    tryAcquireTrial: async (targetId, leaseMs) => {
      const current = entry(targetId);
      const now = clock.now().getTime();
      if (current.trialLeaseUntil !== undefined && current.trialLeaseUntil > now) return false;
      current.trialLeaseUntil = now + leaseMs;
      return true;
    },
  };
}
