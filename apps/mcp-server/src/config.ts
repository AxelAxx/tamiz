/**
 * Configuration from the environment and the command line, validated once at start
 * (spec 009 FR-003, FR-005, FR-006, data-model section 3, contracts/configuration.md).
 *
 * A failure names the variable, and `main.ts` exits 1 with it on stderr. The agent's
 * variables are read by the agent's demo, not here.
 */
import { MCP_TOOL_NAMES, type McpToolName, McpToolNameSchema } from "@tamiz/contracts";
import { z } from "zod";
import { err, ok, type Result } from "./result.js";

export type Transport = "stdio" | "http";

export interface HttpConfig {
  host: string;
  port: number;
  /** Required when `host` is not a local name (DNS rebinding protection). */
  allowedHosts?: string[];
}

export interface Config {
  gatewayUrl: string;
  /** Only on stdio; on HTTP every request brings its own key. */
  gatewayKey?: string;
  tools: McpToolName[];
  timeoutMs: number;
  simulateModel: string;
  transport: Transport;
  http: HttpConfig;
  logLevel: string;
}

const LOCAL_HOSTS = ["127.0.0.1", "localhost", "::1"];

const list = z.string().transform((value) =>
  value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item !== ""),
);

const EnvSchema = z.object({
  TAMIZ_MCP_GATEWAY_URL: z.url({ protocol: /^https?$/ }).default("http://localhost:3000"),
  TAMIZ_MCP_GATEWAY_KEY: z.string().min(1).optional(),
  TAMIZ_MCP_TOOLS: list.pipe(z.array(z.string()).min(1, "name at least one tool")).optional(),
  TAMIZ_MCP_TIMEOUT_MS: z.coerce.number().int().min(100).max(120_000).default(10_000),
  TAMIZ_MCP_SIMULATE_MODEL: z.string().min(1).max(200).default("auto"),
  TAMIZ_MCP_TRANSPORT: z.enum(["stdio", "http"]).default("stdio"),
  TAMIZ_MCP_HTTP_HOST: z.string().min(1).default("127.0.0.1"),
  TAMIZ_MCP_HTTP_PORT: z.coerce.number().int().min(1).max(65_535).default(3100),
  TAMIZ_MCP_ALLOWED_HOSTS: list.pipe(z.array(z.string()).min(1)).optional(),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
});

export function loadConfig(
  env: Readonly<Record<string, string | undefined>>,
  argv: readonly string[],
): Result<Config, string> {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return err(`${String(issue?.path[0] ?? "environment")}: ${issue?.message ?? "invalid"}`);
  }
  const vars = parsed.data;

  const flag = transportFlag(argv);
  if (!flag.ok) return flag;
  const transport = flag.value ?? vars.TAMIZ_MCP_TRANSPORT;

  const tools = parseTools(vars.TAMIZ_MCP_TOOLS);
  if (!tools.ok) return tools;

  if (transport === "stdio" && vars.TAMIZ_MCP_GATEWAY_KEY === undefined) {
    return err("TAMIZ_MCP_GATEWAY_KEY is required for the stdio transport");
  }
  const host = vars.TAMIZ_MCP_HTTP_HOST;
  if (!LOCAL_HOSTS.includes(host) && vars.TAMIZ_MCP_ALLOWED_HOSTS === undefined) {
    return err(`TAMIZ_MCP_ALLOWED_HOSTS is required when TAMIZ_MCP_HTTP_HOST is ${host}`);
  }

  const http: HttpConfig = { host, port: vars.TAMIZ_MCP_HTTP_PORT };
  if (vars.TAMIZ_MCP_ALLOWED_HOSTS !== undefined) http.allowedHosts = vars.TAMIZ_MCP_ALLOWED_HOSTS;
  const config: Config = {
    gatewayUrl: vars.TAMIZ_MCP_GATEWAY_URL.replace(/\/+$/, ""),
    tools: tools.value,
    timeoutMs: vars.TAMIZ_MCP_TIMEOUT_MS,
    simulateModel: vars.TAMIZ_MCP_SIMULATE_MODEL,
    transport,
    http,
    logLevel: vars.LOG_LEVEL,
  };
  if (vars.TAMIZ_MCP_GATEWAY_KEY !== undefined) config.gatewayKey = vars.TAMIZ_MCP_GATEWAY_KEY;
  return ok(config);
}

function transportFlag(argv: readonly string[]): Result<Transport | undefined, string> {
  const index = argv.indexOf("--transport");
  if (index === -1) return ok(undefined);
  const value = argv[index + 1];
  if (value !== "stdio" && value !== "http") {
    return err(`--transport: expected stdio or http, got ${JSON.stringify(value ?? "")}`);
  }
  return ok(value);
}

function parseTools(names: string[] | undefined): Result<McpToolName[], string> {
  if (names === undefined) return ok([...MCP_TOOL_NAMES]);
  const tools: McpToolName[] = [];
  for (const name of names) {
    const parsed = McpToolNameSchema.safeParse(name);
    if (!parsed.success) {
      return err(
        `TAMIZ_MCP_TOOLS: unknown tool ${JSON.stringify(name)} (known: ${MCP_TOOL_NAMES.join(", ")})`,
      );
    }
    if (!tools.includes(parsed.data)) tools.push(parsed.data);
  }
  return ok(tools);
}
