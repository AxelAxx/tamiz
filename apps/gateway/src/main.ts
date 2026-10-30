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
import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { serve } from "@hono/node-server";
import { withAudit, withAuditStream } from "./application/audit/with-audit.js";
import { inspectSensitivity } from "./application/use-cases/inspect-sensitivity.js";
import { queryAuditLog } from "./application/use-cases/query-audit-log.js";
import {
  type RouteInferenceDeps,
  routeInference,
} from "./application/use-cases/route-inference.js";
import { simulatePolicy } from "./application/use-cases/simulate-policy.js";
import { streamInference } from "./application/use-cases/stream-inference.js";
import type { ConfigurationError } from "./domain/errors.js";
import type { Milliseconds } from "./domain/model/units.js";
import type { Result } from "./domain/result.js";
import { createAuthenticator } from "./infrastructure/auth/api-keys.js";
import {
  createInMemoryAuditLog,
  type InMemoryAuditLog,
} from "./infrastructure/cache/in-memory-audit-log.js";
import { createInMemoryCircuitState } from "./infrastructure/cache/in-memory-circuit-state.js";
import { createInMemoryDetectionCache } from "./infrastructure/cache/in-memory-detection-cache.js";
import { createRedisCircuitState } from "./infrastructure/cache/redis-circuit-state.js";
import { systemClock } from "./infrastructure/clock/system-clock.js";
import { loadConfig } from "./infrastructure/config/env.js";
import { checkProviderSettings } from "./infrastructure/config/provider-settings.js";
import { createProviderRegistry } from "./infrastructure/llm/provider-registry.js";
import { createLogger } from "./infrastructure/logging/logger.js";
import { createPostgresApiKeyRepository } from "./infrastructure/persistence/api-key-repository.js";
import { createAsyncAuditWriter } from "./infrastructure/persistence/async-writer.js";
import {
  createPostgresAuditReader,
  createPostgresAuditStore,
} from "./infrastructure/persistence/audit-log-repository.js";
import { connectDatabase, runMigrations } from "./infrastructure/persistence/db.js";
import { loadPolicyFile } from "./infrastructure/policy/file-policy-loader.js";
import { createInMemoryPolicyRepository } from "./infrastructure/policy/in-memory-policy-repository.js";
import { loadAnonymizationNotice } from "./infrastructure/privacy/anonymization-notice.js";
import { createHttpPiiDetector } from "./infrastructure/privacy/http-pii-detector.js";
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
const anonymizationNotice = orExit(loadAnonymizationNotice());

const logger = createLogger({ level: config.logLevel });

// Spec 003 FR-029 … FR-031: shared circuit state when REDIS_URL is set (falling back to
// memory while the store is unreachable); in-memory state for a single instance.
const redisState =
  config.redisUrl === undefined
    ? undefined
    : await createRedisCircuitState({ url: config.redisUrl, clock: systemClock, logger });
const circuitState = redisState ?? createInMemoryCircuitState(systemClock);

// Spec 005: every request is inspected by the privacy service before it is routed; results
// are cached in this process by a SHA-256 hash of the messages (positions only).
const events = createLogRoutingEvents(logger);
const inspect = inspectSensitivity({
  detector: createHttpPiiDetector({ baseUrl: config.privacy.url }),
  cache: createInMemoryDetectionCache({
    maxEntries: config.privacy.cacheMaxEntries,
    ttlMs: config.privacy.cacheTtlMs,
    now: () => systemClock.now(),
  }),
  clock: systemClock,
  events,
  hash: (text) => createHash("sha256").update(text).digest("hex"),
  timeoutMs: config.privacy.timeoutMs as Milliseconds,
});

const routing: RouteInferenceDeps = {
  policies: createInMemoryPolicyRepository(policy),
  providers: createProviderRegistry(config.providers),
  clock: systemClock,
  circuitState,
  events,
  random: Math.random,
  inspect,
  anonymizationNotice,
};
// Spec 006: one content-free audit entry per request. The messages are identified by an
// HMAC keyed with TAMIZ_AUDIT_HASH_KEY, or an ephemeral key when it is unset.
const auditHashKey = config.audit.hashKey ?? randomBytes(32).toString("hex");
if (config.audit.hashKey === undefined) {
  logger.warn(
    {},
    "audit hash key is ephemeral: set TAMIZ_AUDIT_HASH_KEY to correlate across restarts",
  );
}
// Spec 006 FR-005: PostgreSQL when DATABASE_URL is set (migrations before listening), else a
// bounded in-memory log. Never log the URL: errors are reported by their code.
const database = config.databaseUrl === undefined ? undefined : connectDatabase(config.databaseUrl);
if (database !== undefined) {
  try {
    await runMigrations(database);
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code;
    process.stderr.write(
      `Database migration failed (${typeof code === "string" ? code : "unknown"})\n`,
    );
    process.exit(1);
  }
}
const auditWriter =
  database === undefined
    ? undefined
    : createAsyncAuditWriter({
        store: createPostgresAuditStore(database.db),
        clock: systemClock,
        events,
        logger,
      });
const auditLog = auditWriter ?? createInMemoryAuditLog(config.audit.memoryEntries);
if (auditWriter === undefined) {
  logger.info({ entries: config.audit.memoryEntries }, "audit log in memory (bounded)");
} else {
  logger.info({}, "audit log in PostgreSQL");
}
const auditDeps = {
  audit: auditLog,
  clock: systemClock,
  policies: routing.policies,
  hash: (messages: ReadonlyArray<unknown>) =>
    createHmac("sha256", auditHashKey).update(JSON.stringify(messages)).digest("hex"),
  newId: randomUUID,
  logger,
};
const route = withAudit(routeInference(routing), auditDeps);
const stream = withAuditStream(streamInference(routing), auditDeps);
const startedAt = systemClock.now();
const app = createApp({
  clock: systemClock,
  version: config.version,
  startedAt,
  logger,
  routeInference: route,
  streamInference: stream,
  simulatePolicy: simulatePolicy(routing),
  queryAuditLog: queryAuditLog(
    database === undefined
      ? (auditLog as InMemoryAuditLog)
      : createPostgresAuditReader(database.db),
  ),
  authenticate: createAuthenticator(
    config.apiKeys,
    database === undefined ? undefined : createPostgresApiKeyRepository(database.db),
  ),
});

const server = serve({ fetch: app.fetch, port: config.port, hostname: config.host }, (info) => {
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

/** Closes the server, flushes the audit writer, closes the connections, then exits. */
function shutdown(): void {
  server.close();
  void (async () => {
    await auditWriter?.close();
    await database?.close();
    await redisState?.close();
  })().finally(() => process.exit(0));
}
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
