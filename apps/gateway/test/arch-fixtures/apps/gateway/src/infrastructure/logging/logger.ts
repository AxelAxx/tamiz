// Fixture stub: a compliant infrastructure module (imports application only).
import type { ClockPort } from "../../application/ports/clock.port.js";

export const describeClock = (clock: ClockPort): string => typeof clock.now;
