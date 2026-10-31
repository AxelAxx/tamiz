import type { McpToolName } from "@tamiz/contracts";
import type { ToolDefinition } from "./definition.js";
import { getProviderHealth } from "./get-provider-health.js";
import { simulateRouting } from "./simulate-routing.js";

/**
 * Every implemented tool, in listing order. `query_audit_log` and `get_cost_report` arrive
 * with `T-009-03`; until then an allowlist that names them selects nothing for them.
 */
export const ALL_TOOLS: readonly ToolDefinition[] = [simulateRouting, getProviderHealth];

/** The tools of the allowlist (spec 009 FR-003); the rest are never registered. */
export function selectTools(allowlist: readonly McpToolName[]): ToolDefinition[] {
  return ALL_TOOLS.filter((tool) => allowlist.includes(tool.name));
}
