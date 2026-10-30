/**
 * `CostReport` (spec 006 US3-1 … US3-3, FR-012, research R-08).
 *
 * Served requests in `[from, to)` grouped by UTC day, route or model, each row with its
 * real cost and the cost it would have had on the baseline target (stored per entry, so a
 * price change never rewrites history). Blocked and failed requests are counted apart.
 */
import { baselineTarget } from "../../domain/model/baseline.js";
import { type CostAggregate, type CostGroup, money } from "../audit/aggregates.js";
import type { AuditReaderPort } from "../ports/audit-reader.port.js";
import type { PolicyRepositoryPort } from "../ports/policy-repository.port.js";

export interface CostQuery {
  readonly from: string;
  readonly to: string;
  readonly groupBy: CostGroup;
}

export interface CostReport extends CostQuery {
  readonly baseline: {
    readonly targetId: string;
    readonly inputUsdPerMillion: number;
    readonly outputUsdPerMillion: number;
  } | null;
  readonly rows: ReadonlyArray<CostAggregate>;
  readonly notServed: {
    readonly requests: number;
    readonly blocked: number;
    readonly failed: number;
  };
  readonly totals: CostAggregate;
}

export type CostReportUseCase = (query: CostQuery) => Promise<CostReport>;

export function costReport(deps: {
  readonly reader: AuditReaderPort;
  readonly policies: PolicyRepositoryPort;
}): CostReportUseCase {
  return async (query) => {
    const [aggregates, policy] = await Promise.all([
      deps.reader.cost({ from: query.from, to: query.to }, query.groupBy),
      deps.policies.getActive(),
    ]);
    const baseline = baselineTarget(policy.targets);
    const totals = aggregates.rows.reduce<CostAggregate>(
      (sum, row) => ({
        key: "total",
        requests: sum.requests + row.requests,
        inputTokens: sum.inputTokens + row.inputTokens,
        outputTokens: sum.outputTokens + row.outputTokens,
        costUsd: money(sum.costUsd + row.costUsd),
        baselineCostUsd: money(sum.baselineCostUsd + row.baselineCostUsd),
      }),
      {
        key: "total",
        requests: 0,
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
        baselineCostUsd: 0,
      },
    );
    return {
      ...query,
      baseline:
        baseline === undefined
          ? null
          : {
              targetId: baseline.id,
              inputUsdPerMillion: baseline.pricing.inputUsdPerMillion,
              outputUsdPerMillion: baseline.pricing.outputUsdPerMillion,
            },
      rows: aggregates.rows,
      notServed: {
        requests: aggregates.blocked + aggregates.failed,
        blocked: aggregates.blocked,
        failed: aggregates.failed,
      },
      totals,
    };
  };
}
