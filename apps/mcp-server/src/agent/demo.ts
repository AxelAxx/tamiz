#!/usr/bin/env node
/**
 * The agent demo (spec 009 FR-018, data-model section 3, quickstart §7):
 *
 *   pnpm --filter @tamiz/mcp-server agent:demo -- "why did spend rise yesterday?"
 *
 * It connects to the MCP server's HTTP transport with an admin key, runs the agent once on
 * the question, its model calls going to the gateway with a client key, and prints the
 * answer and the run record (JSON) on stdout. Exit 0 when answered, 1 otherwise.
 */
import { createMCPClient } from "@ai-sdk/mcp";
import { z } from "zod";
import { createGatewayModel, DEFAULT_AGENT_MODEL } from "./gateway-model.js";
import { runAgent } from "./run-agent.js";

const EnvSchema = z.object({
  TAMIZ_AGENT_GATEWAY_URL: z.url().default("http://localhost:3000"),
  TAMIZ_AGENT_API_KEY: z.string().min(1, "a client key for the model calls is required"),
  TAMIZ_AGENT_MODEL: z.string().min(1).default(DEFAULT_AGENT_MODEL),
  TAMIZ_AGENT_MCP_URL: z.url().default("http://127.0.0.1:3100/mcp"),
  TAMIZ_AGENT_MCP_KEY: z.string().min(1, "an admin key for the MCP server is required"),
});

async function main(): Promise<number> {
  const env = EnvSchema.safeParse(process.env);
  if (!env.success) {
    const issue = env.error.issues[0];
    process.stderr.write(`agent:demo: ${String(issue?.path[0])}: ${issue?.message}\n`);
    return 1;
  }
  // `pnpm agent:demo -- "<question>"` passes the `--` through.
  const args = process.argv.slice(2);
  const question = (args[0] === "--" ? args.slice(1) : args).join(" ").trim();
  if (question === "") {
    process.stderr.write('usage: agent:demo -- "<question>"\n');
    return 1;
  }

  const mcp = await createMCPClient({
    transport: {
      type: "http",
      url: env.data.TAMIZ_AGENT_MCP_URL,
      headers: { Authorization: `Bearer ${env.data.TAMIZ_AGENT_MCP_KEY}` },
    },
  });
  try {
    const run = await runAgent({
      question,
      model: createGatewayModel({
        gatewayUrl: env.data.TAMIZ_AGENT_GATEWAY_URL,
        apiKey: env.data.TAMIZ_AGENT_API_KEY,
        model: env.data.TAMIZ_AGENT_MODEL,
      }),
      mcp,
      now: () => new Date(),
    });
    process.stdout.write(`${run.answer ?? `(no answer: ${run.stopReason})`}\n\n`);
    process.stdout.write(`${JSON.stringify(run, null, 2)}\n`);
    return run.stopReason === "answered" ? 0 : 1;
  } finally {
    await mcp.close();
  }
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    process.stderr.write(`agent:demo: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  },
);
