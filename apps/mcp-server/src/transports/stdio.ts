/**
 * The local-process transport (spec 009 FR-004, research R-05): MCP messages on standard
 * input and output, nothing else on standard output. Logs go to stderr (`logger.ts`).
 */
import type { McpServer } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";

export async function runStdio(server: McpServer): Promise<void> {
  await server.connect(new StdioServerTransport());
}
