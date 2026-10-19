# application

Use cases and the ports they depend on. This layer may import only `application/` and
`domain/` (rule `application-only-domain`): no infrastructure, no presentation, no
workspace package, no I/O library. Everything external (time, providers, persistence,
logging) is declared as a port interface under `ports/` and implemented in
`infrastructure/`; use cases are tested with in-memory fakes (constitution VIII).

Current modules: `ports/clock.port.ts` (`ClockPort`) and `ports/logger.port.ts`
(`LoggerPort`). Feature 002 adds `ports/llm-provider.port.ts`,
`ports/policy-repository.port.ts` and `use-cases/{classify-task,route-inference}.ts`.
