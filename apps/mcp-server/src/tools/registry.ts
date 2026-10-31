import type { McpToolName } from "@tamiz/contracts";
import type { ToolDefinition } from "./definition.js";
import { getCostReport } from "./get-cost-report.js";
import { getProviderHealth } from "./get-provider-health.js";
import { queryAuditLog } from "./query-audit-log.js";
import { simulateRouting } from "./simulate-routing.js";

/** Every tool, in the order of `MCP_TOOL_NAMES` (a test keeps the two in step). */
export const ALL_TOOLS: readonly ToolDefinition[] = [
  simulateRouting,
  queryAuditLog,
  getCostReport,
  getProviderHealth,
];

/** The tools of the allowlist (spec 009 FR-003); the rest are never registered. */
export function selectTools(allowlist: readonly McpToolName[]): ToolDefinition[] {
  return ALL_TOOLS.filter((tool) => allowlist.includes(tool.name));
}
