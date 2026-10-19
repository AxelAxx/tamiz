// Fixture stub: a compliant presentation module (imports application only).
import type { ClockPort } from "../application/ports/clock.port.js";

export const createApp = (clock: ClockPort): ClockPort => clock;
