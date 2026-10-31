import { Writable } from "node:stream";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { MCP_TOOL_NAMES, type McpToolName } from "@tamiz/contracts";
import { createGatewayClient } from "../../src/gateway-client.js";
import { createLogger, type Logger } from "../../src/logger.js";
import { createMcpServer } from "../../src/server.js";
import { selectTools } from "../../src/tools/registry.js";
import { ADMIN_KEY, createFakeGateway, type FakeGateway } from "./fake-gateway.js";

/**
 * An in-process MCP session (research R-12): the server from `createMcpServer`, a `Client`
 * over `InMemoryTransport.createLinkedPair()` (both halves from the client package), and the
 * gateway client pointed at a fake gateway. Logs are captured as JSON lines.
 */

export const GATEWAY_URL = "http://gateway.test";
export const SIMULATE_MODEL = "auto";

export interface LogCapture {
  logger: Logger;
  lines: string[];
}

export function captureLogs(): LogCapture {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, done) {
      lines.push(...chunk.toString("utf8").split("\n").filter(Boolean));
      done();
    },
  });
  return { logger: createLogger({ level: "debug", destination: stream }), lines };
}

export interface Session {
  client: Client;
  fake: FakeGateway;
  logs: string[];
  close(): Promise<void>;
}

export interface ConnectOptions {
  tools?: readonly McpToolName[];
  key?: string;
  fake?: FakeGateway;
  /** Replaces the fake's `fetch` (for example one that rejects). */
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export async function connect(options: ConnectOptions = {}): Promise<Session> {
  const fake = options.fake ?? createFakeGateway();
  const { logger, lines } = captureLogs();
  const gateway = createGatewayClient({
    baseUrl: GATEWAY_URL,
    key: options.key ?? ADMIN_KEY,
    timeoutMs: options.timeoutMs ?? 2_000,
    fetch: options.fetch ?? fake.fetch,
  });
  const server = createMcpServer({
    tools: selectTools(options.tools ?? MCP_TOOL_NAMES),
    context: { gateway, simulateModel: SIMULATE_MODEL },
    logger,
  });
  const [clientEnd, serverEnd] = InMemoryTransport.createLinkedPair();
  await server.connect(serverEnd);
  const client = new Client({ name: "tamiz-test", version: "0.0.0" });
  await client.connect(clientEnd);
  return {
    client,
    fake,
    logs: lines,
    async close() {
      await client.close();
      await server.close();
    },
  };
}

/** The first text content of a tool result, parsed as JSON. */
export function textJson(result: { content?: unknown }): unknown {
  const content = result.content as { type: string; text?: string }[] | undefined;
  const text = content?.find((part) => part.type === "text")?.text;
  if (text === undefined) throw new Error("the result has no text content");
  return JSON.parse(text);
}
