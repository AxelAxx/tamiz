#!/usr/bin/env node
/**
 * Composition root of the Tamiz MCP server (spec 009, plan "Project Structure"):
 * configuration → logger → transport. Exits 1 with the reason on stderr when the
 * configuration is invalid; stdout stays reserved for the stdio protocol.
 */
import { serve } from "@hono/node-server";
import { loadConfig } from "./config.js";
import { createGatewayClient } from "./gateway-client.js";
import { createLogger } from "./logger.js";
import { createMcpServer } from "./server.js";
import { selectTools } from "./tools/registry.js";
import { createHttpApp, MCP_PATH } from "./transports/http.js";
import { runStdio } from "./transports/stdio.js";

async function main(): Promise<void> {
  const loaded = loadConfig(process.env, process.argv.slice(2));
  if (!loaded.ok) {
    process.stderr.write(`tamiz-mcp: invalid configuration: ${loaded.error}\n`);
    process.exit(1);
  }
  const config = loaded.value;
  const logger = createLogger({ level: config.logLevel });

  if (config.transport === "stdio") {
    const gateway = createGatewayClient({
      baseUrl: config.gatewayUrl,
      // loadConfig refuses stdio without a key.
      key: config.gatewayKey ?? "",
      timeoutMs: config.timeoutMs,
      fetch,
    });
    const server = createMcpServer({
      tools: selectTools(config.tools),
      context: { gateway, simulateModel: config.simulateModel },
      logger,
    });
    await runStdio(server);
    logger.info(
      { transport: "stdio", tools: config.tools, gateway: config.gatewayUrl },
      "tamiz mcp server started",
    );
    return;
  }

  if (config.gatewayKey !== undefined) {
    logger.warn(
      "TAMIZ_MCP_GATEWAY_KEY is ignored on the http transport: each request brings its own key",
    );
  }
  const app = createHttpApp({
    host: config.http.host,
    ...(config.http.allowedHosts === undefined ? {} : { allowedHosts: config.http.allowedHosts }),
    gatewayUrl: config.gatewayUrl,
    timeoutMs: config.timeoutMs,
    simulateModel: config.simulateModel,
    tools: config.tools,
    logger,
  });
  serve({ fetch: app.fetch, hostname: config.http.host, port: config.http.port }, (info) => {
    logger.info(
      {
        transport: "http",
        url: `http://${config.http.host}:${info.port}${MCP_PATH}`,
        tools: config.tools,
      },
      "tamiz mcp server started",
    );
  });
}

main().catch((error: unknown) => {
  process.stderr.write(`tamiz-mcp: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
