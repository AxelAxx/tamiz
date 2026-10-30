/**
 * Where the services under evaluation are (spec 007 contracts/cli.md, research R-01).
 *
 * Validated at start; an invalid value is a setup error (exit 2). Absent variables only
 * skip the evals that need them.
 */
import { z } from "zod";

const Url = z.url({ protocol: /^https?$/ });

export const ConfigSchema = z.object({
  TAMIZ_EVAL_GATEWAY_URL: Url.optional(),
  TAMIZ_EVAL_API_KEY: z.string().min(1).optional(),
  TAMIZ_EVAL_PRIVACY_URL: Url.optional(),
  TAMIZ_EVAL_QUALITY_GATEWAY_URL: Url.optional(),
  TAMIZ_EVAL_JUDGE_URL: Url.optional(),
  TAMIZ_EVAL_JUDGE_MODEL: z.string().min(1).optional(),
  TAMIZ_EVAL_FRONTIER: z.enum(["on", "off"]).default("off"),
  TAMIZ_EVAL_CONCURRENCY: z.coerce.number().int().min(1).max(32).default(4),
  GITHUB_SHA: z.string().min(1).optional(),
});

export type EvalConfig = z.infer<typeof ConfigSchema>;

export function loadConfig(
  env: Readonly<Record<string, string | undefined>>,
): { ok: true; config: EvalConfig } | { ok: false; problems: ReadonlyArray<string> } {
  // Empty strings count as unset, as in `.env` files.
  const present = Object.fromEntries(Object.entries(env).filter(([, v]) => v !== ""));
  const parsed = ConfigSchema.safeParse(present);
  if (parsed.success) return { ok: true, config: parsed.data };
  return {
    ok: false,
    problems: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
  };
}
