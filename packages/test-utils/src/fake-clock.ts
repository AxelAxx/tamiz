/**
 * A clock that only moves when the test says so (spec FR-025, research R-09).
 *
 * The gateway declares `ClockPort` as `{ now(): Date; sleep(ms, signal?) }` in
 * `apps/gateway/src/application/ports/clock.port.ts`; this fake satisfies it
 * structurally, so this package never imports from an app (an app is not a dependency
 * of a library). If a second port ever needs sharing, move the port *types* into a
 * `@tamiz/ports` package rather than importing the app here.
 *
 * Spec 003 research R-01: `sleep` registers a sleeper that resolves only when `advance`,
 * `set`, `runAll` or `drive` moves the clock past its due time, so retry waits,
 * cool-downs and timeouts run without real waiting.
 */
export interface FakeClock {
  /** The current instant; a fresh `Date` on every read. */
  now(): Date;
  /** Moves the clock forward (or backward, with a negative value) by `ms` milliseconds. */
  advance(ms: number): void;
  /** Jumps to the given instant. */
  set(date: Date): void;
  /** Resolves after the clock has moved `ms` milliseconds; rejects with the signal's reason on abort. */
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
  /** How many sleepers are waiting. */
  pendingSleeps(): number;
  /** Moves to the latest due time and resolves every pending sleeper. */
  runAll(): void;
  /**
   * Settles `promise` by repeatedly letting pending callbacks run and advancing the clock
   * to the next sleeper's due time. Rejects when the promise is pending and no sleeper
   * is left, because nothing could ever settle it.
   */
  drive<T>(promise: Promise<T>): Promise<T>;
}

interface Sleeper {
  readonly due: number;
  readonly order: number;
  readonly resolve: () => void;
  readonly release: () => void;
}

const DEFAULT_START = "2026-01-01T00:00:00Z";
/** Bounds `drive` so a sleep loop that never ends fails the test instead of hanging it. */
const MAX_DRIVE_STEPS = 10_000;

/** Lets every queued promise callback and timer-0 task run. */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

export function createFakeClock(start: Date = new Date(DEFAULT_START)): FakeClock {
  let currentMs = start.getTime();
  let registered = 0;
  const sleepers: Sleeper[] = [];

  function wake(): void {
    const due = sleepers
      .filter((sleeper) => sleeper.due <= currentMs)
      .sort((a, b) => a.due - b.due || a.order - b.order);
    for (const sleeper of due) {
      sleepers.splice(sleepers.indexOf(sleeper), 1);
      sleeper.release();
      sleeper.resolve();
    }
  }

  const clock: FakeClock = {
    now: () => new Date(currentMs),
    advance: (ms) => {
      currentMs += ms;
      wake();
    },
    set: (date) => {
      currentMs = date.getTime();
      wake();
    },
    sleep: (ms, signal) =>
      new Promise<void>((resolve, reject) => {
        if (signal?.aborted) {
          reject(signal.reason);
          return;
        }
        const onAbort = () => {
          const index = sleepers.indexOf(sleeper);
          if (index !== -1) sleepers.splice(index, 1);
          reject(signal?.reason);
        };
        const sleeper: Sleeper = {
          due: currentMs + ms,
          order: registered++,
          resolve,
          release: () => signal?.removeEventListener("abort", onAbort),
        };
        signal?.addEventListener("abort", onAbort, { once: true });
        sleepers.push(sleeper);
      }),
    pendingSleeps: () => sleepers.length,
    runAll: () => {
      const latest = Math.max(currentMs, ...sleepers.map((sleeper) => sleeper.due));
      clock.set(new Date(latest));
    },
    drive: async (promise) => {
      let settled = false;
      const watched = promise.finally(() => {
        settled = true;
      });
      // Keep an unobserved rejection from being reported before `drive` returns it.
      watched.catch(() => {});
      for (let step = 0; step < MAX_DRIVE_STEPS; step += 1) {
        await flush();
        if (settled) return watched;
        const next = Math.min(...sleepers.map((sleeper) => sleeper.due));
        if (!Number.isFinite(next)) {
          throw new Error("drive: the promise never settles (pending, and no sleeper is waiting)");
        }
        clock.set(new Date(Math.max(currentMs, next)));
      }
      throw new Error(`drive: still pending after ${MAX_DRIVE_STEPS} clock steps`);
    },
  };
  return clock;
}
