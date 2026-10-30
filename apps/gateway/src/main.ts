/**
 * Composition root: the only module that imports from `infrastructure/` and wires
 * adapters into the application (constitution I, spec FR-015, FR-020; spec 002 FR-018,
 * FR-020 … FR-022, FR-029).
 *
 * Boot order: validate the environment (including the API key hashes) → load and
 * validate the policy file → check that every provider the policy uses is configured
 * (each step exits 1 listing every issue, before any port is bound) → logger → policy
 * repository, provider registry, circuit state and routing-events sink → `routeInference`
 * → app → `serve()` → one startup line with address, version and policy.
 */
import { serve } from "@hono/node-server";
import { routeInference } from "./application/use-cases/route-inference.js";
import type { ConfigurationError } from "./domain/errors.js";
import type { Result } from "./domain/result.js";
import { verifyApiKey } from "./infrastructure/auth/api-keys.js";
import { createInMemoryCircuitState } from "./infrastructure/cache/in-memory-circuit-state.js";
import { systemClock } from "./infrastructure/clock/system-clock.js";
import { loadConfig } from "./infrastructure/config/env.js";
import { checkProviderSettings } from "./infrastructure/config/provider-settings.js";
import { createProviderRegistry } from "./infrastructure/llm/provider-registry.js";
import { createLogger } from "./infrastructure/logging/logger.js";
import { loadPolicyFile } from "./infrastructure/policy/file-policy-loader.js";
import { createInMemoryPolicyRepository } from "./infrastructure/policy/in-memory-policy-repository.js";
import { createLogRoutingEvents } from "./infrastructure/telemetry/log-routing-events.js";
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

const logger = createLogger({ level: config.logLevel });

const route = routeInference({
  policies: createInMemoryPolicyRepository(policy),
  providers: createProviderRegistry(config.providers),
  clock: systemClock,
  // One instance: in-memory circuit state. T-003-06 selects Redis/Valkey when configured.
  circuitState: createInMemoryCircuitState(systemClock),
  events: createLogRoutingEvents(logger),
  random: Math.random,
});
const startedAt = systemClock.now();
const app = createApp({
  clock: systemClock,
  version: config.version,
  startedAt,
  logger,
  routeInference: route,
  authenticate: (key) => verifyApiKey(key, config.apiKeys),
});

serve({ fetch: app.fetch, port: config.port, hostname: config.host }, (info) => {
  logger.info(
    {
      host: info.address,
      port: info.port,
      version: config.version,
      nodeEnv: config.nodeEnv,
      policyId: policy.id,
      policyVersion: policy.version,
    },
    "gateway listening",
  );
});
