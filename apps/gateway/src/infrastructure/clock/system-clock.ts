import type { ClockPort } from "../../application/ports/clock.port.js";

/** The real wall clock; the only place in the gateway that calls `new Date()` for "now". */
export const systemClock: ClockPort = {
  now: () => new Date(),
  sleep: (ms, signal) =>
    new Promise<void>((resolve, reject) => {
      if (signal?.aborted) {
        reject(signal.reason);
        return;
      }
      const onAbort = () => {
        clearTimeout(timer);
        reject(signal?.reason);
      };
      const timer = setTimeout(() => {
        signal?.removeEventListener("abort", onAbort);
        resolve();
      }, ms);
      signal?.addEventListener("abort", onAbort, { once: true });
    }),
};
