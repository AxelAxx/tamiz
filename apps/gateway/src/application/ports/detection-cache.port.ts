/**
 * Recent successful inspections, by a hash of what was inspected (spec 005 FR-009,
 * research R-08, data-model section 3.1).
 *
 * The value holds kinds, offsets, scores and the level only: never text or values. Only
 * successful inspections are cached; a failure must be retried on the next request.
 */
import type { Inspection } from "../../domain/model/sensitivity.js";

export type SuccessfulInspection = Extract<Inspection, { status: "ok" }>;

export interface DetectionCachePort {
  get(key: string): SuccessfulInspection | undefined;
  set(key: string, inspection: SuccessfulInspection): void;
}
