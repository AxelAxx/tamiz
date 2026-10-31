/**
 * Shapes of the dashboard's own endpoints (spec 008 data-model §1.3). Not shared
 * contracts: the gateway's shapes live in `@tamiz/contracts`.
 */
import { ErrorEnvelopeSchema, EvalReportSchema } from "@tamiz/contracts";
import { z } from "zod";

export const BFF_ERROR_TYPES = [
  "unauthenticated", // no or expired session (401)
  "forbidden_origin", // cross-origin write (403)
  "invalid_request", // the request fails its contract, refused before the gateway (400)
  "rate_limited", // too many failed sign-ins (429, Retry-After)
  "gateway_credentials", // the gateway answered 401/403 to the dashboard (502)
  "gateway_unreachable", // network error or timeout (504)
  "contract", // the gateway answer failed its schema (502)
  "gateway", // a gateway error envelope, passed through with its status
] as const;

export const BffErrorSchema = z.strictObject({
  error: z.strictObject({
    type: z.enum(BFF_ERROR_TYPES),
    message: z.string(),
    gatewayError: ErrorEnvelopeSchema.shape.error.optional(),
    endpoint: z.string().optional(),
    issues: z.array(z.string()).optional(), // issue paths only, never values
  }),
});
export type BffError = z.infer<typeof BffErrorSchema>;
export type BffErrorType = (typeof BFF_ERROR_TYPES)[number];

export const SignInRequestSchema = z.strictObject({ passphrase: z.string().min(1).max(1024) });

export const OkSchema = z.strictObject({ ok: z.literal(true) });

export const DashboardHealthSchema = z.strictObject({ status: z.literal("ok") });

export const EvalsListSchema = z.strictObject({
  reports: z.array(z.strictObject({ file: z.string(), report: EvalReportSchema })),
  unreadable: z.array(z.strictObject({ file: z.string(), issue: z.string() })),
});
export type EvalsList = z.infer<typeof EvalsListSchema>;
