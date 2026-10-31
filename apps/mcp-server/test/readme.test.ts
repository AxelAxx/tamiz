import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

// Spec 009 US4-6, FR-012 (tasks.md T018): the host configuration snippets of the README.

const README = readFileSync(resolve(import.meta.dirname, "../README.md"), "utf8");
const PLACEHOLDER = "tamiz_admin_key_here";
const ENTRY = "apps/mcp-server/dist/main.js";

function snippets(): { lang: string; code: string }[] {
  const start = README.indexOf("<!-- mcp-config:start -->");
  const end = README.indexOf("<!-- mcp-config:end -->");
  expect(start, "README has the mcp-config markers").toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  const section = README.slice(start, end);
  return [...section.matchAll(/```(\w+)\n([\s\S]*?)```/g)].map((match) => ({
    lang: match[1] ?? "",
    code: match[2] ?? "",
  }));
}

/** The variables of the README's environment table (first column, in backticks). */
function documentedVariables(): string[] {
  return [...README.matchAll(/^\| `([A-Z_]+)` \|/gm)].map((match) => match[1] ?? "");
}

describe("US4-6 README configuration snippets", () => {
  it("has a Claude Desktop JSON that starts the built server with documented variables", () => {
    const json = snippets().filter((snippet) => snippet.lang === "json");
    expect(json).toHaveLength(1);
    const config = JSON.parse(json[0]?.code ?? "") as {
      mcpServers: {
        tamiz?: {
          command: string;
          args: string[];
          env: Record<string, string> & { TAMIZ_MCP_GATEWAY_KEY?: string };
        };
      };
    };
    const server = config.mcpServers.tamiz;
    expect(server?.command).toBe("node");
    expect(server?.args).toHaveLength(1);
    expect(server?.args[0]?.endsWith(ENTRY)).toBe(true);

    const env = server?.env ?? {};
    const documented = documentedVariables();
    expect(documented.length).toBeGreaterThan(5);
    for (const name of Object.keys(env)) expect(documented).toContain(name);
    expect(env.TAMIZ_MCP_GATEWAY_KEY).toBe(PLACEHOLDER);
    // The snippet is a configuration the server accepts as it is.
    expect(loadConfig(env, []).ok).toBe(true);
  });

  it("has Claude Code commands for the same entry over stdio and for the HTTP URL", () => {
    const commands = snippets()
      .filter((snippet) => snippet.lang === "bash")
      .flatMap((snippet) => snippet.code.split("\n"))
      .filter((line) => line.startsWith("claude mcp add"));

    const stdio = commands.find((line) => line.includes("-- node "));
    expect(stdio).toBeDefined();
    expect(stdio).toMatch(/^claude mcp add tamiz /);
    expect(stdio?.trim().endsWith(ENTRY)).toBe(true);
    for (const [, name] of stdio?.matchAll(/-e ([A-Z_]+)=/g) ?? []) {
      expect(documentedVariables()).toContain(name);
    }

    const http = commands.find((line) => line.includes("--transport http"));
    expect(http).toContain("http://127.0.0.1:3100/mcp");
    expect(http).toContain(`Authorization: Bearer ${PLACEHOLDER}`);
  });

  it("uses only the placeholder as a key value", () => {
    const code = snippets()
      .map((snippet) => snippet.code)
      .join("\n");
    const keys = [
      ...code.matchAll(/TAMIZ_MCP_GATEWAY_KEY"?[=:]\s*"?([^"\s,]+)/g),
      ...code.matchAll(/Bearer ([^"\s]+)/g),
    ].map((match) => match[1]);
    expect(keys.length).toBeGreaterThanOrEqual(3);
    for (const key of keys) expect(key).toBe(PLACEHOLDER);
  });
});
