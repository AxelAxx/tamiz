/**
 * The dashboard's configuration (spec 008 FR-005, data-model §3.3, research R-16).
 *
 * Validated once at start (`instrumentation.ts`): any problem stops the process with one
 * `VARIABLE: message` line per issue. Messages never contain the value, so a malformed
 * secret is never echoed.
 */
import "server-only";
import { z } from "zod";

export const PASSPHRASE_HASH_PATTERN =
  /^scrypt\$[1-9]\d*\$[1-9]\d*\$[1-9]\d*\$[A-Za-z0-9+/]+={0,2}\$[A-Za-z0-9+/]+={0,2}$/;

const httpUrl = (what: string) =>
  z
    .string({ error: "required" })
    .refine((value) => URL.canParse(value), { error: `expected ${what} as an absolute URL` })
    .refine((value) => !URL.canParse(value) || /^https?:$/.test(new URL(value).protocol), {
      error: "expected an http or https URL",
    });

const EnvSchema = z.object({
  TAMIZ_GATEWAY_URL: httpUrl("the gateway address"),
  TAMIZ_DASHBOARD_ADMIN_KEY: z
    .string({ error: "required" })
    .regex(/^\S+$/, { error: "expected a non-empty key without whitespace" }),
  TAMIZ_DASHBOARD_PASSPHRASE_HASH: z.string({ error: "required" }).regex(PASSPHRASE_HASH_PATTERN, {
    error: "expected scrypt$<N>$<r>$<p>$<salt b64>$<hash b64> (pnpm hash-passphrase)",
  }),
  TAMIZ_DASHBOARD_SESSION_SECRET: z
    .string({ error: "required" })
    .refine((value) => Buffer.byteLength(value, "utf8") >= 32, {
      error: "expected at least 32 bytes",
    }),
  TAMIZ_DASHBOARD_PUBLIC_URL: httpUrl("the dashboard's public address"),
  TAMIZ_DASHBOARD_EVALS_DIR: z.string().min(1).default("./data/evals"),
  TAMIZ_DASHBOARD_TRUST_PROXY: z
    .enum(["true", "false"], { error: "expected true or false" })
    .default("false"),
});

export interface DashboardEnv {
  readonly gatewayUrl: string;
  readonly adminKey: string;
  readonly passphraseHash: string;
  readonly sessionSecret: string;
  /** The origin of `TAMIZ_DASHBOARD_PUBLIC_URL`: the only origin allowed to write. */
  readonly publicOrigin: string;
  readonly evalsDir: string;
  readonly trustProxy: boolean;
}

export type EnvResult =
  | { readonly ok: true; readonly value: DashboardEnv }
  | { readonly ok: false; readonly issues: ReadonlyArray<string> };

export function parseEnv(source: Readonly<Record<string, string | undefined>>): EnvResult {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
    };
  }
  const env = parsed.data;
  return {
    ok: true,
    value: {
      gatewayUrl: env.TAMIZ_GATEWAY_URL,
      adminKey: env.TAMIZ_DASHBOARD_ADMIN_KEY,
      passphraseHash: env.TAMIZ_DASHBOARD_PASSPHRASE_HASH,
      sessionSecret: env.TAMIZ_DASHBOARD_SESSION_SECRET,
      publicOrigin: new URL(env.TAMIZ_DASHBOARD_PUBLIC_URL).origin,
      evalsDir: env.TAMIZ_DASHBOARD_EVALS_DIR,
      trustProxy: env.TAMIZ_DASHBOARD_TRUST_PROXY === "true",
    },
  };
}

/** The validated configuration, or the process exits listing every problem. */
export function loadEnvOrExit(source = process.env): DashboardEnv {
  const result = parseEnv(source);
  if (result.ok) return result.value;
  process.stderr.write("Invalid dashboard configuration:\n");
  for (const issue of result.issues) process.stderr.write(`  ${issue}\n`);
  process.exit(1);
}
