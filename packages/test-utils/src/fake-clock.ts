/**
 * A clock that only moves when the test says so (spec FR-025, research R-09).
 *
 * The gateway declares `ClockPort` as `{ now(): Date }` in
 * `apps/gateway/src/application/ports/clock.port.ts`; this fake satisfies it
 * structurally, so this package never imports from an app (an app is not a dependency
 * of a library). If a second port ever needs sharing, move the port *types* into a
 * `@tamiz/ports` package rather than importing the app here.
 */
export interface FakeClock {
  /** The current instant; a fresh `Date` on every read. */
  now(): Date;
  /** Moves the clock forward (or backward, with a negative value) by `ms` milliseconds. */
  advance(ms: number): void;
  /** Jumps to the given instant. */
  set(date: Date): void;
}

const DEFAULT_START = "2026-01-01T00:00:00Z";

export function createFakeClock(start: Date = new Date(DEFAULT_START)): FakeClock {
  let currentMs = start.getTime();

  return {
    now: () => new Date(currentMs),
    advance: (ms) => {
      currentMs += ms;
    },
    set: (date) => {
      currentMs = date.getTime();
    },
  };
}
