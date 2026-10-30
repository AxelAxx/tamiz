# policies

Routing policy files the gateway loads at boot (spec 002 FR-019 … FR-023). The shape is
`RoutingPolicySchema` in `@tamiz/contracts`; the gateway also checks the cross-field rules
(unique ids, chains that name declared targets, no repeats, rule id `default` reserved)
and that every provider a target uses is configured. Any problem stops boot with exit
code 1 and one `path: message` line per issue. `TAMIZ_POLICY_FILE` picks the file
(default `policies/default.yaml`, relative to the working directory); YAML and JSON both
load.

- `default.yaml` — one target on each of the four providers, rules by requested model,
  task type and cost, and an EU-first default chain. `pinned-local` only allows `local`
  processing and `long-documents-eu` only `eu` and `local`. Needs `MISTRAL_API_KEY`,
  `ANTHROPIC_API_KEY` and `OPENAI_API_KEY`.
- `local-only.yaml` — a single Ollama target; nothing leaves the machine.

Since feature 003 (`specs/003-resilience`), two optional additions:

- `residency: [...]` on a rule or on `default` lists where its requests' data may be
  processed (`local`, `eu`, `us`, `global`). No list allows every residency. A chain
  that lists a target outside its own list stops boot; at run time a fallback never
  reaches such a target, and the request is blocked with `451` instead of degrading.
- `resilience:` sets the request deadline (default 60 000 ms), the attempts per target
  (2), the backoff (250 ms base, 2 000 ms cap, full jitter) and the circuit breaker
  (opens after 5 consecutive counted failures, 30 000 ms cool-down). Every field is
  optional; the defaults are filled at load.
