/**
 * The MCP server: registers the selected tools with fixed read-only annotations
 * (spec 009 FR-001 … FR-003, research R-06, R-07, R-08).
 *
 * Unknown or disabled tools and input that fails a tool's schema never reach `run`: the SDK
 * answers them. A gateway failure is a tool result with `isError: true`, which the SDK does
 * not validate against the output schema; a success carries the parsed contract value.
 */
import { McpServer, type ToolAnnotations } from "@modelcontextprotocol/server";
import type { Logger } from "./logger.js";
import {
  type ToolContext,
  type ToolDefinition,
  toToolError,
  toToolResult,
} from "./tools/definition.js";

export const SERVER_NAME = "tamiz";
export const SERVER_VERSION = "0.1.0";

const READ_ONLY: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

export interface CreateMcpServerOptions {
  tools: readonly ToolDefinition[];
  context: ToolContext;
  logger: Logger;
}

export function createMcpServer(options: CreateMcpServerOptions): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });
  for (const tool of options.tools) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        outputSchema: tool.outputSchema,
        annotations: { title: tool.title, ...READ_ONLY },
      },
      async (input: unknown) => {
        const started = performance.now();
        const result = await tool.run(input, options.context);
        const durationMs = Math.round(performance.now() - started);
        if (result.ok) {
          options.logger.info({ tool: tool.name, ok: true, durationMs }, "tool call");
          return toToolResult(result.value);
        }
        options.logger.warn(
          { tool: tool.name, ok: false, code: result.error.code, durationMs },
          "tool call failed",
        );
        return toToolError(result.error);
      },
    );
  }
  return server;
}
