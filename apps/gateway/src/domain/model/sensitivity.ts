/**
 * Sensitivity of a request's content (spec 002 FR-002, US3-7). Feature 002 reserves the
 * slot with the single value `unknown`; feature 005 (`T-005-02`) adds `none`, `low`,
 * `high` and `critical` here. Mirrored as `z.enum` in `@tamiz/contracts` (research R-03).
 */
export const SENSITIVITIES = ["unknown"] as const;
export type Sensitivity = (typeof SENSITIVITIES)[number];
