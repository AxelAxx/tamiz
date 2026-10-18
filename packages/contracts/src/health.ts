/**
 * Health endpoint contract (spec FR-009, data-model section 4).
 *
 * The skeleton always answers `status: "ok"` without `checks`; later features add the
 * per-dependency checks (database, cache, privacy service). A `degraded` status must say
 * what is degraded, so `checks` is required and non-empty in that case.
 */
import { z } from "zod";
import { MillisecondsSchema } from "./branded.js";

export const HealthCheckSchema = z.strictObject({
  name: z.string().min(1),
  status: z.enum(["ok", "degraded", "down"]),
  detail: z.string().optional(),
});

export const HealthResponseSchema = z
  .strictObject({
    status: z.enum(["ok", "degraded"]),
    /** Semver or `git describe` output; never empty. */
    version: z.string().min(1),
    uptimeMs: MillisecondsSchema,
    checks: z.array(HealthCheckSchema).min(1).optional(),
  })
  .superRefine((health, ctx) => {
    if (health.status === "degraded" && health.checks === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["checks"],
        message: 'checks is required when status is "degraded"',
      });
    }
  });

export type HealthCheck = z.infer<typeof HealthCheckSchema>;
export type HealthResponse = z.infer<typeof HealthResponseSchema>;
