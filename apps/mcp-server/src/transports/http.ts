/**
 * Stateless streamable HTTP on Hono (spec 009 FR-004 … FR-006, research R-04, R-05).
 *
 * `createMcpHonoApp` validates `Host` and `Origin` (local names by default, the configured
 * hosts otherwise). A bearer middleware answers `401` before any tool runs. Then each
 * request gets its own server, with a gateway client bound to that request's key, and its
 * own transport: no key outlives its request, and no session is kept.
 */
import { createMcpHonoApp } from "@modelcontextprotocol/hono";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/server";
import type { McpToolName } from "@tamiz/contracts";
import type { Hono } from "hono";
import { createGatewayClient } from "../gateway-client.js";
import type { Logger } from "../logger.js";
import { createMcpServer } from "../server.js";
import { selectTools } from "../tools/registry.js";

export const MCP_PATH = "/mcp";

export interface HttpAppOptions {
  host: string;
  allowedHosts?: readonly string[];
  gatewayUrl: string;
  timeoutMs: number;
  simulateModel: string;
  tools: readonly McpToolName[];
  logger: Logger;
  fetch?: typeof fetch;
}

const BEARER = /^Bearer ([^\s]+)$/;

export type McpHttpApp = Hono<{ Variables: { parsedBody?: unknown } }>;

export function createHttpApp(options: HttpAppOptions): McpHttpApp {
  // The helper's JSON middleware sets `parsedBody`; its return type does not declare it.
  const app = (options.allowedHosts === undefined
    ? createMcpHonoApp({ host: options.host })
    : createMcpHonoApp({
        host: options.host,
        allowedHosts: [...options.allowedHosts],
        allowedOrigins: [...options.allowedHosts],
      })) as unknown as McpHttpApp;
  const tools = selectTools(options.tools);

  app.use(MCP_PATH, async (c, next) => {
    if (BEARER.test(c.req.header("authorization") ?? "")) return next();
    c.header("WWW-Authenticate", "Bearer");
    return c.json(
      {
        jsonrpc: "2.0",
        error: { code: -32001, message: "a Tamiz API key is required as a bearer token" },
        id: null,
      },
      401,
    );
  });

  app.post(MCP_PATH, async (c) => {
    const key = BEARER.exec(c.req.header("authorization") ?? "")?.[1] ?? "";
    const gateway = createGatewayClient({
      baseUrl: options.gatewayUrl,
      key,
      timeoutMs: options.timeoutMs,
      fetch: options.fetch ?? fetch,
    });
    const server = createMcpServer({
      tools,
      context: { gateway, simulateModel: options.simulateModel },
      logger: options.logger,
    });
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    await server.connect(transport);
    return transport.handleRequest(c.req.raw, { parsedBody: c.get("parsedBody") });
  });

  app.on(["GET", "DELETE"], MCP_PATH, (c) =>
    c.json(
      {
        jsonrpc: "2.0",
        error: { code: -32000, message: "Method not allowed: this server is stateless" },
        id: null,
      },
      405,
    ),
  );

  return app;
}
