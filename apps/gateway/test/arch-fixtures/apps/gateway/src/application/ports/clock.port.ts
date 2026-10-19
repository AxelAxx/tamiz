// Fixture stub: a compliant application port (imports domain only).
import type { Ok } from "../../domain/result.js";

export interface ClockPort {
  now(): Ok<Date>;
}
