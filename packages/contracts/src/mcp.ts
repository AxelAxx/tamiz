/**
 * MCP tool contracts (spec 009 FR-001, FR-007 … FR-011, data-model sections 1.1, 1.2, 1.4).
 *
 * The inputs of the four read-only tools of `apps/mcp-server` and the shape of a tool error.
 * Their outputs are the existing simulate and admin schemas, unchanged. The admin query
 * schemas coerce strings because they parse query strings; MCP inputs are JSON, so numeric
 * fields are declared as plain integers here and hosts see a clean JSON Schema.
 */
import { z } from "zod";
import { AuditQuerySchema, CostQuerySchema } from "./admin.js";
import { ChatMessageSchema } from "./chat-completion.js";

export const MCP_TOOL_NAMES = [
  "simulate_routing",
  "query_audit_log",
  "get_cost_report",
  "get_provider_health",
] as const;

export const McpToolNameSchema = z.enum(MCP_TOOL_NAMES);

/** The page size of `query_audit_log`, smaller than the admin API's so a page fits a context. */
export const MCP_AUDIT_PAGE_DEFAULT = 20;
export const MCP_AUDIT_PAGE_MAX = 50;

export const SimulateRoutingInputSchema = z
  .strictObject({
    text: z.string().min(1).max(32_000).optional(),
    messages: z.array(ChatMessageSchema).min(1).optional(),
    model: z.string().min(1).max(200).optional(),
  })
  .refine((input) => (input.text === undefined) !== (input.messages === undefined), {
    message: "give exactly one of text or messages",
  });

export const QueryAuditLogInputSchema = z.strictObject({
  ...AuditQuerySchema.shape,
  limit: z.int().min(1).max(MCP_AUDIT_PAGE_MAX).default(MCP_AUDIT_PAGE_DEFAULT),
});

export const GetCostReportInputSchema = CostQuerySchema;

export const GetProviderHealthInputSchema = z.strictObject({
  windowMinutes: z.int().min(1).max(1_440).default(15),
});

export const McpToolErrorCodeSchema = z.enum([
  "gateway_unreachable",
  "gateway_timeout",
  "gateway_unauthorized",
  "gateway_forbidden",
  "gateway_rejected",
  "gateway_error",
  "gateway_contract",
]);

/** A tool error result's text. The message never holds the key or request headers. */
export const McpToolErrorSchema = z.strictObject({
  error: z.strictObject({ code: McpToolErrorCodeSchema, message: z.string().max(500) }),
});

export type McpToolName = z.infer<typeof McpToolNameSchema>;
export type SimulateRoutingInput = z.infer<typeof SimulateRoutingInputSchema>;
export type QueryAuditLogInput = z.infer<typeof QueryAuditLogInputSchema>;
export type GetCostReportInput = z.infer<typeof GetCostReportInputSchema>;
export type GetProviderHealthInput = z.infer<typeof GetProviderHealthInputSchema>;
export type McpToolErrorCode = z.infer<typeof McpToolErrorCodeSchema>;
export type McpToolError = z.infer<typeof McpToolErrorSchema>;
