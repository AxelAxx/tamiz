# application

Use cases and the ports they depend on. This layer may import only `application/` and
`domain/` (rule `application-only-domain`): no infrastructure, no presentation, no
workspace package, no I/O library. Everything external (time, providers, persistence,
logging) is declared as a port interface under `ports/` and implemented in
`infrastructure/`; use cases are tested with in-memory fakes (constitution VIII).

Current modules: `ports/clock.port.ts` (`ClockPort`), `ports/logger.port.ts`
(`LoggerPort`), `ports/llm-provider.port.ts` (`LlmProviderPort`, `FINISH_REASONS`),
`ports/policy-repository.port.ts` (`PolicyRepositoryPort`), `provider-registry.ts`
(`ProviderRegistry`, type only) and the use cases `use-cases/classify-task.ts`
(`classifyTask`) and `use-cases/route-inference.ts` (`routeInference`, non-streaming,
`chain[0]` only).
