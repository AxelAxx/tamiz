import { GetProviderHealthInputSchema, ProvidersReportSchema } from "@tamiz/contracts";
import { defineTool } from "./definition.js";

/** `get_provider_health` → `GET /v1/admin/providers` (spec 009 FR-009, contracts/tools.md). */
export const getProviderHealth = defineTool({
  name: "get_provider_health",
  title: "Provider health",
  description:
    "Circuit breaker state of every configured target, plus requests, error rate and " +
    "p50/p95 latency over the last `windowMinutes` (default 15).",
  inputSchema: GetProviderHealthInputSchema,
  outputSchema: ProvidersReportSchema,
  gatewayCall: { method: "GET", path: "/v1/admin/providers" },
  run: (input, { gateway }) => gateway.providers({ windowMinutes: input.windowMinutes }),
});
