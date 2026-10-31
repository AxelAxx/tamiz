# T-009-03 — Tools `query_audit_log` and `get_cost_report`

| Field | Value |
|---|---|
| Task | `T-009-03` (see `docs/tasks/BACKLOG.md`) |
| Feature | `009-mcp-agent` |
| Spec | `specs/009-mcp-agent/spec.md` |
| Branch / PR | `T-009-03-audit-cost-tools`, cut on top of `T-009-02-mcp-server`, rebased onto `main` at b4a628a (#49) / PR opened after this commit |
| Date | 2026-10-31 |
| Session | Claude Code (Claude Opus 5.5), side session |
| Status | done; quickstart §6 in a real host (Claude Desktop or Claude Code) was not run, see Pending |

## What was done

The two tools behind the demo question are implemented, completing the server's four tools
(`tasks.md` T017–T021):

- `query_audit_log` → `GET /v1/admin/audit`, with the seven admin filters, a cursor and a
  page size of 1 … 50, default 20 (FR-010);
- `get_cost_report` → `GET /v1/admin/cost`, grouped by `day`, `route` or `model`,
  default `day` (FR-011).

Their input schemas already shipped in `T-009-02`, so there is no contract change. The
README now has the host configuration (FR-012, US4-6):

- purpose, the tools table and the environment table;
- the Claude Desktop JSON and the Claude Code stdio and HTTP commands, between
  `<!-- mcp-config:start -->` and `<!-- mcp-config:end -->`;
- a Windows path note;
- how to choose the tools for a client key;
- the caveat about simulation text in a cloud-hosted assistant.

## Files touched

- `apps/mcp-server/src/tools/query-audit-log.ts`, `get-cost-report.ts`: the two tools,
  with descriptions verbatim from `contracts/tools.md`.
- `apps/mcp-server/src/tools/registry.ts`: all four tools, in `MCP_TOOL_NAMES` order.
- `apps/mcp-server/test/tools-audit-cost.test.ts`: US3-1 … US3-5, plus US2-7 on a real
  `from ≥ to` answer (T017).
- `apps/mcp-server/test/readme.test.ts`: US4-6 (T018).
- `apps/mcp-server/test/{tools-simulate-health,permissions,transport-http}.test.ts`:
  - US1-1 now lists four tools;
  - US2-1 uses the spec's allowlist (`simulate_routing,get_provider_health`, then calls
    `query_audit_log`);
  - US2-3 and US2-4 call all four tools;
  - a registry test checks that `ALL_TOOLS` matches `MCP_TOOL_NAMES`.
- `apps/mcp-server/README.md`: the full server documentation (T020).
- `CLAUDE.md` §12: `start:http` and the inspector command (T021).

## Decisions

- **The validated input is the query.** `query_audit_log` passes its parsed input straight
  to the gateway client. The client drops `undefined` fields and stringifies the rest, so
  the gateway receives exactly the given filters plus `limit` (US3-1 checks the recorded
  query, including the absence of fields that were left out).
- **The README test checks the snippets against the code, not only their shape.**
  - The Claude Desktop `env` block must load with `loadConfig`, as a configuration the
    server accepts.
  - Every variable in the snippets must be in the README's environment table.
  - Every key value (`TAMIZ_MCP_GATEWAY_KEY=…`, `Bearer …`) must be the placeholder
    `tamiz_admin_key_here`.
- **The `gateway_contract` message carries no value (US3-5).** The fixture's extra
  `prompt` field contains "hola", and the test asserts that the message does not, so the
  message names only the failing path.

## How it was verified

```bash
pnpm lint        # exit 0
pnpm typecheck   # 7 packages green
pnpm arch        # ✔ no dependency violations found (141 modules, 484 dependencies cruised)
pnpm test        # Test Files 108 passed; Tests 1090 passed | 27 skipped (Testcontainers suites)
```

`@tamiz/mcp-server` now has 53 tests in 7 files.

By hand, against a real gateway (`tsx src/main.ts`, `policies/local-only.yaml`, no
Postgres, so the audit and cost stores are the in-memory ones). An SDK client spawned
`dist/main.js` over stdio with an admin key:

- the tool list showed all four tools, read-only;
- `query_audit_log {entity: "DNI"}` returned `{"entries":[],"nextCursor":null}`;
- `get_cost_report` grouped by `route` returned a contract-valid empty report (`baseline:
  null`, totals 0);
- `get_cost_report` with `from` after `to` returned `gateway_rejected` with the gateway's
  message, `"from: must be before to"`;
- `query_audit_log {limit: 51}` returned
  `Input validation error: … limit: Too big: expected number to be <=50`.

## Pending / follow-ups

- **Quickstart §6 (SC-001) has not been run in a real host.** Registering the server in
  Claude Desktop or Claude Code changes the maintainer's own host configuration, so this
  session left that step to Alex. The step is:
  1. paste the README snippet;
  2. ask "is any Tamiz provider failing?".

  The stdio path a host uses (the built binary, spawned with the environment and listing
  and calling tools) is covered by `transport-stdio.test.ts` and the manual check above.
- `T-009-04`: the agent.

## Pitfalls for the next session

- **The gateway serves admin reads without Postgres, from in-memory stores.** Empty answers
  from a fresh gateway are expected, not a bug. The demo needs the Postgres seed of
  `T-009-04`.
- **An orphaned `tsx` process can keep the port.** Stopping a backgrounded `tsx` wrapper
  can leave its `node … tsx … src/main.ts` child listening. A later gateway start then
  fails with `EADDRINUSE` while the old one keeps answering. Check the port with
  `netstat -ano` and stop the right PID.
- **`README.md` is under test.** Changing the snippet format, the environment table
  (`| \`VAR\` |` rows) or the placeholder breaks `readme.test.ts` on purpose.

## Links

- Spec / plan / tasks: `specs/009-mcp-agent/`
- ADRs: none added
- Related task records: `docs/tasks/done/T-009-02-mcp-server.md`, `docs/tasks/done/T-006-04-audit-query-api.md`, `docs/tasks/done/T-006-06-cost-and-providers.md`
