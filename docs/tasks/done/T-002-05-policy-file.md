# T-002-05 — Policy schema, file loader and boot validation

| Field | Value |
|---|---|
| Task | `T-002-05` (see `docs/tasks/BACKLOG.md`) |
| Feature | `002-provider-routing` |
| Spec | `specs/002-provider-routing/spec.md` (US2-1 … US2-3, US2-5, US2-6, US3-7 at the schema level; FR-019 … FR-023); `tasks.md` Phase 4 (T036–T048); `research.md` R-02, R-09, R-12; `data-model.md` §2.3, §5 |
| Branch / PR | `T-002-05-policy-file` / PR opened after this commit |
| Date | 2026-10-30 |
| Session | Claude Code (Claude Opus 5.5), side session (Alex away; merge authority delegated for the session) |
| Status | done |

## What was done

`@tamiz/contracts` exports `RoutingPolicySchema` and its parts (strict objects, closed
lists, ranges, `defaultTimeoutMs` defaulting to 30000, no `sensitivity` condition) (FR-019).
The gateway loads the policy file named by `TAMIZ_POLICY_FILE` at boot: read → YAML/JSON
parse → schema → `validatePolicy` (FR-020). Every failure is one `ConfigurationError` that
lists each problem by path, and the loader never throws (US2-1, US2-2, US2-6).
`checkProviderSettings` then requires every provider that a target uses to be configured,
and names the target and the missing variable (FR-021, US2-3). The 001 env schema gains
the policy file and the provider settings, grouped as `config.providers` with the
`ProviderSettings` shape from T-002-04. `main.ts` exits 1 before binding a port on any
of these failures, seeds the production in-memory `PolicyRepositoryPort` (FR-022) and logs
the policy id and version in the startup line (US2-5). `policies/default.yaml` (four
providers, FR-023) and `policies/local-only.yaml` ship with a README.

## Files touched

- `packages/contracts/src/routing-policy.ts`, `src/index.ts`, `README.md`: the schema and its exports (T040).
- `packages/contracts/test/routing-policy.test.ts`: T036.
- `apps/gateway/src/infrastructure/policy/{file-policy-loader,policy-mapper,in-memory-policy-repository}.ts`: T041, T042, T046.
- `apps/gateway/src/infrastructure/config/env.ts`: `TAMIZ_POLICY_FILE`, `OLLAMA_BASE_URL`, `*_API_KEY`, `*_BASE_URL` → `policyFile`, `providers` (T043).
- `apps/gateway/src/infrastructure/config/provider-settings.ts`: `checkProviderSettings` (T044).
- `apps/gateway/src/main.ts`: boot order config → policy → provider check → repository → app (T046).
- `apps/gateway/policies/{default,local-only}.yaml`, `policies/README.md`: T045.
- `apps/gateway/test/policy/**` (invalid corpus of 9 files, `valid-minimal.yaml`, loader and repository tests), `test/config/{provider-settings,env-002}.test.ts`: T037–T039.
- `apps/gateway/test/boot.integration.test.ts`: invalid policy and missing key exit 1. The healthy boot now sets test keys and asserts the policy id and version. A `todo` stays for US5-4 (T047).
- `apps/gateway/test/env.test.ts`: the 001 defaults now include `policyFile` and `providers`.
- `apps/gateway/package.json`, `pnpm-lock.yaml`: `yaml` 2.
- `apps/gateway/README.md`, `src/infrastructure/README.md`: new variables, boot behaviour, modules.
- `specs/002-provider-routing/quickstart.md` §6: expected stderr wording (see Decisions).
- `docs/tasks/BACKLOG.md`: `T-002-05` row set to `done` (that row only).

## Decisions

- **The unknown target id is quoted by the loader, not by the domain.** I first changed
  the domain messages to `unknown target "nope"` (the quickstart's wording). A T-002-02
  test pins that `validatePolicy` never echoes a value, so I reverted that. The loader
  appends `(target "<id>")` to chain-entry issues (`rules.N.route.M`, `default.route.M`),
  reading the id from the operator's own file. The output is
  `rules.0.route.0: expected the id of a declared target (target "nope")`, and
  quickstart §6 now shows that. US2-1 holds: the path names the rule and the location,
  and the message names the id.
- **An empty value counts as unset** for the keys and base URL overrides, so the
  quickstart's `MISTRAL_API_KEY=` means "not configured" rather than "invalid".
  A base URL override without its key is ignored, and the provider stays unconfigured.
- **The provider check emits one issue per target**, at path `targets.N.provider`, so
  each message names its target as US2-3 asks. With the default policy this is one
  issue per provider.
- **`config.providers` reuses `ProviderSettings` from `infrastructure/llm/settings.ts`**,
  so `main.ts` can pass it straight to `createProviderRegistry` in T-002-06. Ollama is
  always configured because `OLLAMA_BASE_URL` has a default.
- **Base URLs must be http(s)** (`z.url({ protocol: /^https?$/ })`).
- **`main.ts` uses top-level `await`** (ESM, NodeNext). One `orExit` helper prints every
  failure the same way.
- **The contract enums are declared without importing the domain** (R-03). Assigning
  the DTO to the domain input in `policy-mapper.ts` makes the compiler reject a contract
  value the domain lacks. The full drift test is T054 (T-002-06).
- **Merging:** Alex delegated merge rights for this session while away. PR #10
  (T-002-04) was merged after its `ci` check passed, and this branch was cut from the
  result, so the `package.json` / lockfile overlap never conflicted.

## How it was verified

```bash
pnpm --filter @tamiz/contracts exec vitest run test/routing-policy.test.ts   # Tests 18 passed
pnpm --filter @tamiz/gateway exec vitest run test/policy test/config test/env.test.ts test/boot.integration.test.ts test/domain
#  Test Files 11 passed   Tests 145 passed | 1 todo
pnpm lint          # Checked 128 files. No fixes applied. (21 infos: useLiteralKeys in tests, conflicts with noPropertyAccessFromIndexSignature)
pnpm typecheck     # Tasks: 5 successful, 5 total
pnpm arch          # ✔ no dependency violations found (51 modules, 121 dependencies cruised)
pnpm test --coverage   # Test Files 39 passed   Tests 426 passed | 1 todo   Type Errors no errors
pnpm build         # Tasks: 3 successful, 3 total
```

Quickstart §6, run by hand from `apps/gateway`:

```text
$ TAMIZ_POLICY_FILE=$TEMP/tamiz-qs/bad.yaml node --import tsx src/main.ts; echo "exit: $?"
Invalid routing policy in C:\Users\almc7\AppData\Local\Temp/tamiz-qs/bad.yaml:
  rules.0.route.0: expected the id of a declared target (target "nope")
exit: 1

$ env -u MISTRAL_API_KEY ANTHROPIC_API_KEY=x-SECRET OPENAI_API_KEY=y-SECRET node --import tsx src/main.ts; echo "exit: $?"
Missing provider settings for the routing policy:
  targets.1.provider: target mistral-small: provider mistral needs MISTRAL_API_KEY
exit: 1
```

## Pending / follow-ups

- `T-002-06`: wire `createProviderRegistry(config.providers)` and `routeInference` with
  this repository. Add `TAMIZ_API_KEYS` and turn the boot `todo` for US5-4 into a test.
  Add the contracts drift test (T054).
- No new backlog rows.

## Pitfalls for the next session

- **Starting the gateway now needs the three provider keys** with the default policy.
  Use `TAMIZ_POLICY_FILE=policies/local-only.yaml` for keyless local runs. The boot test
  strips any `TAMIZ_*` / provider variables a developer exported before spawning.
- **The domain must never echo values in issues** (a T-002-02 test checks it). Enrich
  messages at the edge if a value is needed.
- **Biome's `useLiteralKeys` info conflicts with `noPropertyAccessFromIndexSignature`**:
  keep the bracket access; the infos do not fail `pnpm lint`.
- `policy.example.yaml` in the spec and `policies/default.yaml` must stay identical
  apart from the header comment.

## Links

- Spec / plan / tasks: `specs/002-provider-routing/{spec,plan,tasks,quickstart}.md` (Phase 4, §6), `research.md` R-02, R-03, R-09, R-12, `data-model.md` §2.3, §5
- ADRs: none added
- Related task records: `docs/tasks/done/T-002-04-llm-adapters.md`, `docs/tasks/done/T-002-03-ports-and-use-cases.md`, `docs/tasks/done/T-002-02-domain-routing-model.md`, `docs/tasks/done/T-001-04-gateway-skeleton.md`
