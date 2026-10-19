# domain

The innermost layer: value types, pure functions and the typed error model of the gateway.
Nothing here may import anything outside `domain/`: no other layer, no workspace package,
no npm dependency, no Node core module (constitution I, rule `domain-imports-nothing`).
Time, randomness and I/O enter through ports in `application/` and never here.

Current modules: `result.ts` (`Result<T, E>` and its helpers) and `errors.ts` (the
`DomainError` union). Feature 002 adds `model/` (inference request, model target, routing
policy and decision).
