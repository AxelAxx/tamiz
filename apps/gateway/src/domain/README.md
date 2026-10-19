# domain

The innermost layer: value types, pure functions and the typed error model of the gateway.
Nothing here may import anything outside `domain/`: no other layer, no workspace package,
no npm dependency, no Node core module (constitution I, rule `domain-imports-nothing`).
Time, randomness and I/O enter through ports in `application/` and never here.

Current modules: `result.ts` (`Result<T, E>` and its helpers), `errors.ts` (the
`DomainError` union) and, since feature 002, `model/`: `units.ts` (the domain's own
branded units and ids), `inference-request.ts`, `model-target.ts`, `sensitivity.ts`,
`task-classifier.ts` (rule-based `classify`, the bilingual cue table `CUES`),
`routing-policy.ts` (`validatePolicy`, `targetById`) and `routing-decision.ts` (the pure,
total `decide`).
