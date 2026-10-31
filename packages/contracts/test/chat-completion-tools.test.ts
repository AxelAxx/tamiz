/**
 * Tool calling in the chat completion contract (009 tool-calling addendum, FR-001 …
 * FR-005, US1-4, US6-4, contracts/chat-completion-tools.md).
 */
import { describe, expect, it } from "vitest";
import {
  ChatCompletionChunkSchema,
  ChatCompletionRequestSchema,
  ChatCompletionResponseSchema,
} from "../src/index.js";
import { minimalRequest, validRequest, validResponse } from "./fixtures/chat-completion.js";

const tool = (name: string) => ({
  type: "function" as const,
  function: {
    name,
    description: "Look up a patient by id",
    parameters: { type: "object", properties: { patientId: { type: "string" } } },
  },
});

const call = (id: string, args = '{"patientId":"4411"}') => ({
  id,
  type: "function" as const,
  function: { name: "get_patient", arguments: args },
});

export const toolRequest = {
  model: "tamiz-auto",
  messages: [
    { role: "user", content: "¿Cuándo es la próxima cita del paciente 4411?" },
    { role: "assistant", content: null, tool_calls: [call("call_a1")] },
    { role: "tool", tool_call_id: "call_a1", content: '{"next":"2026-11-04"}' },
  ],
  tools: [tool("get_patient")],
  tool_choice: "auto",
};

function issuesOf(payload: unknown) {
  const result = ChatCompletionRequestSchema.safeParse(payload);
  return result.success ? [] : result.error.issues;
}

describe("ChatCompletionRequestSchema with tools (FR-001 … FR-003)", () => {
  it("accepts the contract example", () => {
    const result = ChatCompletionRequestSchema.safeParse(toolRequest);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(toolRequest);
  });

  it.each(["none", "auto", "required", { type: "function", function: { name: "get_patient" } }])(
    "accepts tool_choice %j",
    (tool_choice) => {
      expect(issuesOf({ ...toolRequest, tool_choice })).toEqual([]);
    },
  );

  it("accepts an assistant message with text and tool calls, and strict on a tool", () => {
    const strictTool = {
      ...tool("get_patient"),
      function: { ...tool("x").function, strict: true },
    };
    expect(
      issuesOf({
        ...minimalRequest,
        tools: [strictTool],
        messages: [
          { role: "user", content: "hi" },
          { role: "assistant", content: "Let me check.", tool_calls: [call("c1")] },
        ],
      }),
    ).toEqual([]);
  });

  it("US1-4: every pre-existing request still validates unchanged", () => {
    expect(ChatCompletionRequestSchema.parse(validRequest)).toEqual(validRequest);
    expect(ChatCompletionRequestSchema.parse(minimalRequest)).toEqual(minimalRequest);
  });

  it("rejects duplicate tool names at the second one", () => {
    const issues = issuesOf({ ...toolRequest, tools: [tool("get_patient"), tool("get_patient")] });
    expect(issues.map((i) => i.path)).toEqual([["tools", 1, "function", "name"]]);
  });

  it.each(["get patient", "", "x".repeat(65), "réserver"])(
    "US6-4: rejects the tool name %j",
    (name) => {
      const issues = issuesOf({ ...minimalRequest, tools: [tool(name)] });
      expect(issues[0]?.path).toEqual(["tools", 0, "function", "name"]);
    },
  );

  it("rejects more than 128 tools", () => {
    const tools = Array.from({ length: 129 }, (_, i) => tool(`t${i}`));
    expect(issuesOf({ ...minimalRequest, tools })[0]?.path).toEqual(["tools"]);
  });

  it("rejects tool_choice without tools", () => {
    const issues = issuesOf({ ...minimalRequest, tool_choice: "auto" });
    expect(issues.map((i) => i.path)).toEqual([["tool_choice"]]);
  });

  it("rejects tool_choice naming an undeclared function", () => {
    const issues = issuesOf({
      ...toolRequest,
      tool_choice: { type: "function", function: { name: "delete_patient" } },
    });
    expect(issues.map((i) => i.path)).toEqual([["tool_choice", "function", "name"]]);
  });

  it("rejects a tool message that answers no earlier call, without echoing the id", () => {
    const messages = [
      { role: "user", content: "hi" },
      { role: "tool", tool_call_id: "call_secret_value", content: "x" },
    ];
    const issues = issuesOf({ ...minimalRequest, messages });
    expect(issues.map((i) => i.path)).toEqual([["messages", 1, "tool_call_id"]]);
    expect(JSON.stringify(issues)).not.toContain("call_secret_value");
  });

  it("rejects a tool message that comes before its call", () => {
    const messages = [
      { role: "tool", tool_call_id: "c1", content: "x" },
      { role: "assistant", content: null, tool_calls: [call("c1")] },
    ];
    expect(issuesOf({ ...minimalRequest, messages })[0]?.path).toEqual([
      "messages",
      0,
      "tool_call_id",
    ]);
  });

  it("rejects an assistant message with neither content nor tool calls", () => {
    const messages = [{ role: "assistant", content: null }];
    expect(issuesOf({ ...minimalRequest, messages })[0]?.path).toEqual(["messages", 0, "content"]);
  });

  it.each(['"a string"', "[1,2]", "null", "{not json", "42"])(
    "rejects arguments %j that are not a JSON object, without echoing them",
    (args) => {
      const messages = [{ role: "assistant", content: null, tool_calls: [call("c1", args)] }];
      const issues = issuesOf({ ...minimalRequest, messages });
      expect(issues.map((i) => i.path)).toEqual([
        ["messages", 0, "tool_calls", 0, "function", "arguments"],
      ]);
      expect(issues[0]?.message).not.toContain(args);
    },
  );

  it.each([
    ["parallel_tool_calls", { parallel_tool_calls: true }],
    ["response_format", { response_format: { type: "json_object" } }],
    ["functions", { functions: [] }],
  ])("still rejects %s", (_name, extra) => {
    expect(issuesOf({ ...toolRequest, ...extra })[0]?.code).toBe("unrecognized_keys");
  });

  it("rejects a non-function tool type", () => {
    const issues = issuesOf({ ...minimalRequest, tools: [{ type: "web_search" }] });
    expect(issues[0]?.path.slice(0, 2)).toEqual(["tools", 0]);
  });
});

describe("ChatCompletionResponseSchema with tool calls (FR-004)", () => {
  it("accepts content null with tool calls and finish_reason tool_calls", () => {
    const response = {
      ...validResponse,
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: null, tool_calls: [call("call_b7")] },
          finish_reason: "tool_calls",
        },
      ],
    };
    expect(ChatCompletionResponseSchema.safeParse(response).success).toBe(true);
  });

  it("accepts arguments the model wrote as invalid JSON (the client validates)", () => {
    const response = {
      ...validResponse,
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: null, tool_calls: [call("c", "{oops")] },
          finish_reason: "tool_calls",
        },
      ],
    };
    expect(ChatCompletionResponseSchema.safeParse(response).success).toBe(true);
  });
});

describe("ChatCompletionChunkSchema with tool-call pieces (FR-004)", () => {
  const chunk = (delta: unknown, finish_reason: string | null = null) => ({
    id: "chatcmpl-1",
    object: "chat.completion.chunk",
    created: 1,
    model: "m",
    choices: [{ index: 0, delta, finish_reason }],
  });

  it("accepts a call's first piece, a later piece and the tool_calls finish", () => {
    const first = {
      role: "assistant",
      tool_calls: [
        {
          index: 0,
          id: "call_b7",
          type: "function",
          function: { name: "send_reminder", arguments: "" },
        },
      ],
    };
    const later = { tool_calls: [{ index: 0, function: { arguments: '{"name":' } }] };
    for (const delta of [first, later]) {
      expect(ChatCompletionChunkSchema.safeParse(chunk(delta)).success).toBe(true);
    }
    expect(ChatCompletionChunkSchema.safeParse(chunk({}, "tool_calls")).success).toBe(true);
  });

  it("rejects a piece without its index", () => {
    const delta = { tool_calls: [{ function: { arguments: "x" } }] };
    expect(ChatCompletionChunkSchema.safeParse(chunk(delta)).success).toBe(false);
  });
});
