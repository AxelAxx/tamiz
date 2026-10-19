import type { ClockPort } from "../../application/ports/clock.port.js";

/** The real wall clock; the only place in the gateway that calls `new Date()` for "now". */
export const systemClock: ClockPort = {
  now: () => new Date(),
};
