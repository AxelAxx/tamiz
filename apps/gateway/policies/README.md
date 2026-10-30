# policies

Routing policy files the gateway loads at boot (spec 002 FR-019 … FR-023). The shape is
`RoutingPolicySchema` in `@tamiz/contracts`; the gateway also checks the cross-field rules
(unique ids, chains that name declared targets, no repeats, rule id `default` reserved)
and that every provider a target uses is configured. Any problem stops boot with exit
code 1 and one `path: message` line per issue. `TAMIZ_POLICY_FILE` picks the file
(default `policies/default.yaml`, relative to the working directory); YAML and JSON both
load.

- `default.yaml` — one target on each of the four providers, rules by requested model,
  task type and cost, and an EU-first default chain. Needs `MISTRAL_API_KEY`,
  `ANTHROPIC_API_KEY` and `OPENAI_API_KEY`.
- `local-only.yaml` — a single Ollama target; nothing leaves the machine.
