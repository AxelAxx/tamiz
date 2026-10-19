/**
 * Environment configuration (spec FR-015, research R-11, data-model section 7).
 *
 * Values are read once at boot through {@link loadConfig}; the resulting object is frozen
 * and injected. Nothing else reads `process.env`. An invalid environment yields a
 * `ConfigurationError` listing each offending variable with the expected format and never
 * the value, so secrets cannot leak through the boot message.
 */
import { readFileSync } from "node:fs";
import { z } from "zod";
import {
  type ConfigurationError,
  configurationError,
  type ErrorIssue,
} from "../../domain/errors.js";
import { err, ok, type Result } from "../../domain/result.js";

export const LOG_LEVELS = ["fatal", "error", "warn", "info", "debug", "trace"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export const NODE_ENVS = ["development", "test", "production"] as const;
export type NodeEnv = (typeof NODE_ENVS)[number];

export const EnvSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  HOST: z.string().min(1).default("0.0.0.0"),
  LOG_LEVEL: z.enum(LOG_LEVELS).default("info"),
  NODE_ENV: z.enum(NODE_ENVS).default("development"),
  APP_VERSION: z.string().min(1).optional(),
});

type EnvKey = keyof z.infer<typeof EnvSchema>;

/** What each variable must look like; shown instead of the offending value. */
const EXPECTED_FORMAT: Readonly<Record<EnvKey, string>> = {
  PORT: "an integer between 1 and 65535",
  HOST: "a non-empty host name or IP address",
  LOG_LEVEL: `one of ${LOG_LEVELS.join(", ")}`,
  NODE_ENV: `one of ${NODE_ENVS.join(", ")}`,
  APP_VERSION: "a non-empty version string",
};

export interface GatewayConfig {
  readonly port: number;
  readonly host: string;
  readonly logLevel: LogLevel;
  readonly nodeEnv: NodeEnv;
  readonly version: string;
}

export type Environment = Readonly<Record<string, string | undefined>>;

const PackageManifestSchema = z.object({ version: z.string().min(1) });

/** Version of this package, the default for `GatewayConfig.version` (`APP_VERSION` overrides). */
export const PACKAGE_VERSION: string = PackageManifestSchema.parse(
  JSON.parse(readFileSync(new URL("../../../package.json", import.meta.url), "utf8")),
).version;

function isEnvKey(key: string): key is EnvKey {
  return Object.hasOwn(EXPECTED_FORMAT, key);
}

function toIssue(issue: z.core.$ZodIssue): ErrorIssue {
  const path = issue.path.map(String).join(".");
  const message = isEnvKey(path) ? `expected ${EXPECTED_FORMAT[path]}` : issue.message;
  return { path, message };
}

/** Validates `env` and returns a frozen config, or a configuration error naming each invalid variable. */
export function loadConfig(env: Environment): Result<GatewayConfig, ConfigurationError> {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    return err(
      configurationError("Invalid environment configuration", parsed.error.issues.map(toIssue)),
    );
  }
  const { PORT, HOST, LOG_LEVEL, NODE_ENV, APP_VERSION } = parsed.data;
  return ok(
    Object.freeze({
      port: PORT,
      host: HOST,
      logLevel: LOG_LEVEL,
      nodeEnv: NODE_ENV,
      version: APP_VERSION ?? PACKAGE_VERSION,
    }),
  );
}
