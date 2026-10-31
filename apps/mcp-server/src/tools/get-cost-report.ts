import { CostReportSchema, GetCostReportInputSchema } from "@tamiz/contracts";
import { defineTool } from "./definition.js";

/** `get_cost_report` → `GET /v1/admin/cost` (spec 009 FR-011, contracts/tools.md). */
export const getCostReport = defineTool({
  name: "get_cost_report",
  title: "Cost report",
  description:
    "Spend of served requests in [from, to), grouped by UTC day, route or model, with the " +
    "'everything to the most expensive target' baseline, blocked and failed counts, and totals.",
  inputSchema: GetCostReportInputSchema,
  outputSchema: CostReportSchema,
  gatewayCall: { method: "GET", path: "/v1/admin/cost" },
  run: (input, { gateway }) => gateway.cost(input),
});
