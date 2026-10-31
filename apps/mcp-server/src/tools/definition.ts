/**
 * A tool is a record: name, schemas, the one gateway call it makes, and a `run` function
 * (spec 009 FR-001, FR-002, data-model section 2). `server.ts` registers a list of them.
 */
import type { CallToolResult } from "@modelcontextprotocol/server";
import type { McpToolError, McpToolName } from "@tamiz/contracts";
import type { z } from "zod";
import type { GatewayClient, GatewayResult, ToolError } from "../gateway-client.js";

/** The one gateway call a tool makes: only simulation or admin reads (US2-3). */
export interface GatewayCall {
  method: "GET" | "POST";
  path: "/v1/simulate" | `/v1/admin/${string}`;
}

export interface ToolContext {
  gateway: GatewayClient;
  /** The model `simulate_routing` sends when the caller gives none. */
  simulateModel: string;
}

export interface ToolDefinition {
  name: McpToolName;
  title: string;
  /** Shown to hosts and models; states the rules a JSON Schema cannot (text XOR messages). */
  description: string;
  inputSchema: z.ZodType;
  outputSchema: z.ZodType;
  gatewayCall: GatewayCall;
  run(input: unknown, context: ToolContext): GatewayResult<unknown>;
}

/** Types `run` against the schemas, then erases them so tools fit one list. */
export function defineTool<I extends z.ZodType, O extends z.ZodType>(definition: {
  name: McpToolName;
  title: string;
  description: string;
  inputSchema: I;
  outputSchema: O;
  gatewayCall: GatewayCall;
  run(input: z.output<I>, context: ToolContext): GatewayResult<z.output<O>>;
}): ToolDefinition {
  return {
    ...definition,
    // The SDK has parsed the arguments with `inputSchema` before it calls the tool.
    run: (input, context) => definition.run(input as z.output<I>, context),
  };
}

/** A success: the contract value as structured content, and the same value as compact JSON. */
export function toToolResult(value: unknown): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(value) }],
    structuredContent: value as Record<string, unknown>,
  };
}

/** A failure the model can read: `McpToolErrorSchema` as text, no structured content. */
export function toToolError(error: ToolError): CallToolResult {
  const body: McpToolError = { error: { code: error.code, message: error.message } };
  return { content: [{ type: "text", text: JSON.stringify(body) }], isError: true };
}
