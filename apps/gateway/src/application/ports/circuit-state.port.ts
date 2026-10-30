/**
 * Where circuit breaker state is kept (spec 003 FR-006, FR-010, FR-029, research R-04,
 * data-model section 3.1).
 *
 * The breaker's logic lives in the domain and in `resilience/circuit-breaker.ts`; this
 * port only stores, with the atomic operations a store shared between gateway instances
 * needs (Redis `INCR`, `SET … PX`, `SET … NX PX`). Adapters: in memory
 * (`infrastructure/cache/in-memory-circuit-state.ts`) and Redis/Valkey (`T-003-06`).
 */
import type { CircuitSnapshot } from "../../domain/model/circuit.js";
import type { Milliseconds, TargetId } from "../../domain/model/units.js";

export interface CircuitStatePort {
  snapshot(targetId: TargetId): Promise<CircuitSnapshot>;
  /** Increments and returns the consecutive counted failures. */
  recordFailure(targetId: TargetId): Promise<number>;
  /** Resets the count, the open time, the pending trial and the trial lease. */
  recordSuccess(targetId: TargetId): Promise<void>;
  /** Opens for `cooldownMs` from now, marks a trial pending, resets the count and the lease. */
  open(targetId: TargetId, cooldownMs: Milliseconds): Promise<void>;
  /** Grants the single half-open trial; `false` while another trial's lease is held. */
  tryAcquireTrial(targetId: TargetId, leaseMs: Milliseconds): Promise<boolean>;
}
