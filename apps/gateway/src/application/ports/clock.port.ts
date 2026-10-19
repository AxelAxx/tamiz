/**
 * How time enters the application (constitution VIII, research R-09).
 *
 * The system adapter lives in `infrastructure/clock/system-clock.ts`; tests use a fake
 * clock that only moves when told to (`@tamiz/test-utils`, `T-001-06`), which satisfies
 * this shape structurally.
 */
export interface ClockPort {
  now(): Date;
}
