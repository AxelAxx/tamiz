# infrastructure

Adapters that implement the ports of `application/` with real technology: configuration
from the environment, the pino logger, the system clock, and later the LLM providers,
the privacy service client, persistence, cache and telemetry. This layer may import
`infrastructure/`, `application/`, `domain/`, workspace packages, npm and Node core, but
never `presentation/` or `main.ts` (rule `infrastructure-no-presentation`). Only
`main.ts` may import from here (rule `only-main-imports-infrastructure`), so adapters
reach the rest of the gateway through injection, not through imports.

Current modules: `config/env.ts` (`EnvSchema`, `loadConfig`, `GatewayConfig`),
`logging/logger.ts` (`createLogger` with redaction) and `clock/system-clock.ts`.
