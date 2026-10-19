/**
 * Composition root: the only module that imports from `infrastructure/` and wires
 * adapters into the application (constitution I, spec FR-015, FR-020).
 *
 * Boot order: validate the environment (exit 1 with every offending variable on
 * failure, before any port is bound) → logger → clock → app → `serve()` → one startup
 * line with address and version.
 */
import { serve } from "@hono/node-server";
import { systemClock } from "./infrastructure/clock/system-clock.js";
import { loadConfig } from "./infrastructure/config/env.js";
import { createLogger } from "./infrastructure/logging/logger.js";
import { createApp } from "./presentation/app.js";

const configResult = loadConfig(process.env);

if (!configResult.ok) {
  process.stderr.write(`${configResult.error.message}:\n`);
  for (const issue of configResult.error.issues) {
    process.stderr.write(`  ${issue.path}: ${issue.message}\n`);
  }
  process.exit(1);
}

const config = configResult.value;
const logger = createLogger({ level: config.logLevel });
const startedAt = systemClock.now();
const app = createApp({ clock: systemClock, version: config.version, startedAt, logger });

serve({ fetch: app.fetch, port: config.port, hostname: config.host }, (info) => {
  logger.info(
    { host: info.address, port: info.port, version: config.version, nodeEnv: config.nodeEnv },
    "gateway listening",
  );
});
