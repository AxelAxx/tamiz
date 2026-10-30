/**
 * Composition root: the only module that imports from `infrastructure/` and wires
 * adapters into the application (constitution I, spec FR-015, FR-020; spec 002 FR-020 …
 * FR-022).
 *
 * Boot order: validate the environment → load and validate the policy file → check that
 * every provider the policy uses is configured (each step exits 1 listing every issue,
 * before any port is bound) → policy repository → logger → clock → app → `serve()` →
 * one startup line with address, version and policy.
 */
import { serve } from "@hono/node-server";
import type { ConfigurationError } from "./domain/errors.js";
import type { Result } from "./domain/result.js";
import { systemClock } from "./infrastructure/clock/system-clock.js";
import { loadConfig } from "./infrastructure/config/env.js";
import { checkProviderSettings } from "./infrastructure/config/provider-settings.js";
import { createLogger } from "./infrastructure/logging/logger.js";
import { loadPolicyFile } from "./infrastructure/policy/file-policy-loader.js";
import { createInMemoryPolicyRepository } from "./infrastructure/policy/in-memory-policy-repository.js";
import { createApp } from "./presentation/app.js";

/** Returns the value, or prints one `path: message` line per issue and exits 1. */
function orExit<T>(result: Result<T, ConfigurationError>): T {
  if (result.ok) return result.value;
  process.stderr.write(`${result.error.message}:\n`);
  for (const issue of result.error.issues) {
    process.stderr.write(`  ${issue.path}: ${issue.message}\n`);
  }
  process.exit(1);
}

const config = orExit(loadConfig(process.env));
const policy = orExit(await loadPolicyFile(config.policyFile));
orExit(checkProviderSettings(policy, config));
// Read by the routing use case once `T-002-06` wires the endpoint.
const policyRepository = createInMemoryPolicyRepository(policy);
const activePolicy = await policyRepository.getActive();

const logger = createLogger({ level: config.logLevel });
const startedAt = systemClock.now();
const app = createApp({ clock: systemClock, version: config.version, startedAt, logger });

serve({ fetch: app.fetch, port: config.port, hostname: config.host }, (info) => {
  logger.info(
    {
      host: info.address,
      port: info.port,
      version: config.version,
      nodeEnv: config.nodeEnv,
      policyId: activePolicy.id,
      policyVersion: activePolicy.version,
    },
    "gateway listening",
  );
});
