import { existsSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { resolve } from "node:path";
import type { Readable } from "node:stream";
import { serve } from "@hono/node-server";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { ProvidersReportSchema } from "@tamiz/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ADMIN_KEY, createFakeGateway } from "./support/fake-gateway.js";
import { expectNoKey } from "./support/no-key.js";

// Spec 009 US4-1 (tasks.md T007): the built binary over a real stdio pipe, against the fake
// gateway on a real port. The root `pnpm test` builds first; a bare package run may not.

const MAIN = resolve(import.meta.dirname, "../dist/main.js");
const built = existsSync(MAIN);

if (!built) {
  console.warn(`transport-stdio.test.ts skipped: ${MAIN} is missing (run pnpm build first)`);
}

describe.skipIf(!built)("US4 stdio transport", () => {
  const fake = createFakeGateway();
  let server: ReturnType<typeof serve>;
  let gatewayUrl: string;

  beforeAll(async () => {
    await new Promise<void>((ready) => {
      server = serve({ fetch: fake.app.fetch, port: 0, hostname: "127.0.0.1" }, () => ready());
    });
    gatewayUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise((closed) => server.close(closed));
  });

  it("US4-1 serves tools over stdio with protocol-only stdout and JSON logs on stderr", async () => {
    const { PATH = "", SYSTEMROOT = "" } = process.env;
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [MAIN],
      env: {
        PATH,
        SYSTEMROOT,
        TAMIZ_MCP_GATEWAY_URL: gatewayUrl,
        TAMIZ_MCP_GATEWAY_KEY: ADMIN_KEY,
        LOG_LEVEL: "debug",
      },
      stderr: "pipe",
    });
    const stderr: string[] = [];
    (transport.stderr as Readable | null)?.on("data", (chunk: Buffer) => {
      stderr.push(...chunk.toString("utf8").split(/\r?\n/).filter(Boolean));
    });
    const client = new Client({ name: "tamiz-stdio-test", version: "0.0.0" });
    // A stdout line that is not a JSON-RPC message surfaces here as a parse error.
    const protocolErrors: Error[] = [];
    client.onerror = (error) => protocolErrors.push(error);

    await client.connect(transport);
    try {
      const { tools } = await client.listTools();
      expect(tools.map((tool) => tool.name)).toContain("get_provider_health");
      const result = await client.callTool({ name: "get_provider_health", arguments: {} });
      expect(ProvidersReportSchema.parse(result.structuredContent).windowMinutes).toBe(15);
      expect(fake.requests.at(-1)?.authorization).toBe(`Bearer ${ADMIN_KEY}`);
    } finally {
      await client.close();
    }

    expect(protocolErrors).toEqual([]);
    expect(stderr.length).toBeGreaterThan(0);
    for (const line of stderr) {
      expect(() => JSON.parse(line), `stderr line is not JSON: ${line}`).not.toThrow();
    }
    expectNoKey(ADMIN_KEY, ...stderr);
  });
});
