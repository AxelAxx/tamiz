# packages/test-utils

In-memory fakes for every application port (`FakeClock`, `FakeLlmProvider`,
`FakePiiDetector`, `InMemoryAuditLog`, `InMemoryCircuitState`, `InMemoryPolicyRepository`)
and builders for domain objects, so that use cases are tested without network or
database. Package scaffold created in `T-001-02`; `FakeClock` and the builders arrive in
`T-001-06`, the other fakes as their ports appear. The shared Vitest configuration is the
root `vitest.config.ts` (`test.projects`), added in `T-001-06`.

Scripts: `pnpm --filter @tamiz/test-utils typecheck | test | build`.
