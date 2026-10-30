/**
 * How time enters the application (constitution VIII, research R-09).
 *
 * The system adapter lives in `infrastructure/clock/system-clock.ts`; tests use a fake
 * clock that only moves when told to (`@tamiz/test-utils`, `T-001-06`), which satisfies
 * this shape structurally.
 *
 * Spec 003 research R-01: waiting also goes through this port, so retry waits, circuit
 * cool-downs and timeouts are driven by the fake clock in tests.
 */
import type { Milliseconds } from "../../domain/model/units.js";

export interface ClockPort {
  now(): Date;
  /** Resolves after `ms`; rejects with the signal's reason when it aborts first. */
  sleep(ms: Milliseconds, signal?: AbortSignal): Promise<void>;
}
