import { type McpToolErrorCode, McpToolErrorSchema } from "@tamiz/contracts";
import { afterEach, describe, expect, it } from "vitest";
import {
  ADMIN_KEY,
  CLIENT_KEY,
  createFakeGateway,
  type ScriptedFailure,
} from "./support/fake-gateway.js";
import { PROVIDERS } from "./support/fixtures.js";
import { type ConnectOptions, connect, type Session, textJson } from "./support/mcp-harness.js";
import { expectNoKey } from "./support/no-key.js";

// Spec 009 US1-6, US2-6, US2-7; one case per row of the error table in contracts/tools.md
// (tasks.md T004).

const WRONG_KEY = "tamiz_test_wrong_9a8b7c6d";

let session: Session | undefined;

afterEach(async () => {
  await session?.close();
  session = undefined;
});

interface Case {
  scenario: string;
  code: McpToolErrorCode;
  options?: ConnectOptions;
  failure?: ScriptedFailure;
  message?: RegExp;
}

const { generatedAt: _dropped, ...withoutGeneratedAt } = PROVIDERS;

const CASES: Case[] = [
  {
    scenario: "US1-6 a refused connection",
    code: "gateway_unreachable",
    options: { fetch: () => Promise.reject(new TypeError("fetch failed")) },
  },
  {
    scenario: "US1-6 no answer within the timeout",
    code: "gateway_timeout",
    options: { timeoutMs: 100 },
    failure: { kind: "delay", ms: 400 },
  },
  {
    scenario: "US1-6 a body outside the contract",
    code: "gateway_contract",
    failure: { kind: "body", body: withoutGeneratedAt },
    message: /generatedAt/,
  },
  {
    scenario: "US2-6 401 for an invalid key",
    code: "gateway_unauthorized",
    options: { key: WRONG_KEY },
    message: /missing or invalid/,
  },
  {
    scenario: "US2-6 403 for a client key on an admin tool",
    code: "gateway_forbidden",
    options: { key: CLIENT_KEY },
    message: /admin role/,
  },
  {
    scenario: "US2-7 400 with the gateway's message",
    code: "gateway_rejected",
    failure: { kind: "status", status: 400, message: "windowMinutes is not allowed here" },
    message: /^windowMinutes is not allowed here$/,
  },
  {
    scenario: "a 5xx answer",
    code: "gateway_error",
    failure: { kind: "status", status: 500 },
    message: /500/,
  },
];

describe("gateway failures become coded tool errors", () => {
  it.each(CASES)("$scenario → $code", async ({ code, options, failure, message }) => {
    const fake = createFakeGateway();
    fake.fail(failure);
    session = await connect({ fake, ...options });

    const result = await session.client.callTool({
      name: "get_provider_health",
      arguments: {},
    });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
    const toolError = McpToolErrorSchema.parse(textJson(result));
    expect(toolError.error.code).toBe(code);
    if (message !== undefined) expect(toolError.error.message).toMatch(message);
    expectNoKey(ADMIN_KEY, result, session.logs);
    expectNoKey(CLIENT_KEY, result, session.logs);
    expectNoKey(WRONG_KEY, result, session.logs);
  });

  it("a failed call does not poison the next one", async () => {
    const fake = createFakeGateway();
    fake.fail({ kind: "status", status: 503 });
    session = await connect({ fake });
    const failed = await session.client.callTool({ name: "get_provider_health", arguments: {} });
    fake.fail(undefined);
    const recovered = await session.client.callTool({
      name: "get_provider_health",
      arguments: {},
    });

    expect(failed.isError).toBe(true);
    expect(recovered.isError).not.toBe(true);
  });
});
