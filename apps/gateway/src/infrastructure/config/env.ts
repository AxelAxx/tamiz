/**
 * Environment configuration (spec FR-015, research R-11, data-model section 7; spec 002
 * research R-12 and data-model section 5 add the policy file and the provider settings).
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
import type { KeyedProviderSettings, ProviderSettings } from "../llm/settings.js";

export const LOG_LEVELS = ["fatal", "error", "warn", "info", "debug", "trace"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export const NODE_ENVS = ["development", "test", "production"] as const;
export type NodeEnv = (typeof NODE_ENVS)[number];

export const DEFAULT_POLICY_FILE = "policies/default.yaml";
export const DEFAULT_OLLAMA_BASE_URL = "http://localhost:11434/v1";

const HttpUrlSchema = z.url({ protocol: /^https?$/ });

/** An empty value counts as unset, so `MISTRAL_API_KEY=` leaves Mistral unconfigured. */
function optionalSetting<T extends z.ZodType>(schema: T) {
  return z.preprocess((value) => (value === "" ? undefined : value), schema.optional());
}

export const EnvSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  HOST: z.string().min(1).default("0.0.0.0"),
  LOG_LEVEL: z.enum(LOG_LEVELS).default("info"),
  NODE_ENV: z.enum(NODE_ENVS).default("development"),
  APP_VERSION: z.string().min(1).optional(),
  TAMIZ_POLICY_FILE: z.string().min(1).default(DEFAULT_POLICY_FILE),
  OLLAMA_BASE_URL: HttpUrlSchema.default(DEFAULT_OLLAMA_BASE_URL),
  MISTRAL_API_KEY: optionalSetting(z.string()),
  MISTRAL_BASE_URL: optionalSetting(HttpUrlSchema),
  ANTHROPIC_API_KEY: optionalSetting(z.string()),
  ANTHROPIC_BASE_URL: optionalSetting(HttpUrlSchema),
  OPENAI_API_KEY: optionalSetting(z.string()),
  OPENAI_BASE_URL: optionalSetting(HttpUrlSchema),
});

type EnvKey = keyof z.infer<typeof EnvSchema>;

/** What each variable must look like; shown instead of the offending value. */
const EXPECTED_FORMAT: Readonly<Record<EnvKey, string>> = {
  PORT: "an integer between 1 and 65535",
  HOST: "a non-empty host name or IP address",
  LOG_LEVEL: `one of ${LOG_LEVELS.join(", ")}`,
  NODE_ENV: `one of ${NODE_ENVS.join(", ")}`,
  APP_VERSION: "a non-empty version string",
  TAMIZ_POLICY_FILE: "a non-empty path to the routing policy file",
  OLLAMA_BASE_URL: "an http(s) URL",
  MISTRAL_API_KEY: "a Mistral API key",
  MISTRAL_BASE_URL: "an http(s) URL",
  ANTHROPIC_API_KEY: "an Anthropic API key",
  ANTHROPIC_BASE_URL: "an http(s) URL",
  OPENAI_API_KEY: "an OpenAI API key",
  OPENAI_BASE_URL: "an http(s) URL",
};

export interface GatewayConfig {
  readonly port: number;
  readonly host: string;
  readonly logLevel: LogLevel;
  readonly nodeEnv: NodeEnv;
  readonly version: string;
  /** Path of the routing policy file, absolute or relative to the working directory. */
  readonly policyFile: string;
  /** Ollama always has a base URL; a keyed provider is present only with its API key. */
  readonly providers: ProviderSettings;
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

/** A keyed provider's settings, or `undefined` without a key (a lone base URL is ignored). */
function keyed(
  apiKey: string | undefined,
  baseUrl: string | undefined,
): KeyedProviderSettings | undefined {
  if (apiKey === undefined) return undefined;
  return { apiKey, ...(baseUrl !== undefined && { baseUrl }) };
}

/** Validates `env` and returns a frozen config, or a configuration error naming each invalid variable. */
export function loadConfig(env: Environment): Result<GatewayConfig, ConfigurationError> {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    return err(
      configurationError("Invalid environment configuration", parsed.error.issues.map(toIssue)),
    );
  }
  const values = parsed.data;
  const mistral = keyed(values.MISTRAL_API_KEY, values.MISTRAL_BASE_URL);
  const anthropic = keyed(values.ANTHROPIC_API_KEY, values.ANTHROPIC_BASE_URL);
  const openai = keyed(values.OPENAI_API_KEY, values.OPENAI_BASE_URL);
  return ok(
    Object.freeze({
      port: values.PORT,
      host: values.HOST,
      logLevel: values.LOG_LEVEL,
      nodeEnv: values.NODE_ENV,
      version: values.APP_VERSION ?? PACKAGE_VERSION,
      policyFile: values.TAMIZ_POLICY_FILE,
      providers: {
        ollama: { baseUrl: values.OLLAMA_BASE_URL },
        ...(mistral !== undefined && { mistral }),
        ...(anthropic !== undefined && { anthropic }),
        ...(openai !== undefined && { openai }),
      },
    }),
  );
}
