# packages/test-utils

In-memory fakes for every application port (`FakeClock`, `FakeLlmProvider`,
`FakePiiDetector`, `InMemoryAuditLog`, `InMemoryCircuitState`, `InMemoryPolicyRepository`)
and builders for domain objects, so that use cases are tested without network or
database. Shared Vitest configuration lives here as well. Created in task `T-001-06` and
extended as ports appear.
