/**
 * Streamed tool calls (009 tool-calling US4, US6-2, US6-3, tasks.md T017, T018, T021,
 * T023): OpenAI-shaped tool-call chunks, placeholder-safe restoration per call, the
 * first-token rule for a stream that starts with a call, span attributes, and no tool
 * content in logs, events, spans or audit entries.
 */
import { ChatCompletionChunkSchema } from "@tamiz/contracts";
import { describe, expect, it } from "vitest";
import type { StreamPart } from "../src/application/ports/llm-provider.port.js";
import type { Inspection } from "../src/domain/model/sensitivity.js";
import { err, ok } from "../src/domain/result.js";
import { createLogger } from "../src/infrastructure/logging/logger.js";
import { fanOut } from "../src/infrastructure/telemetry/fan-out.js";
import { createLogRoutingEvents } from "../src/infrastructure/telemetry/log-routing-events.js";
import { AUTH, createTestApp } from "./helpers/app.js";
import { inspectAs } from "./helpers/privacy.js";
import { captureSpans } from "./helpers/tracing.js";
import { failure, target } from "./resilience/helpers.js";

const NAME = "Ana Ruiz Gil";

async function* parts(...items: StreamPart[]): AsyncGenerator<StreamPart> {
  for (const item of items) yield item;
}

const TOOLS = [
  {
    type: "function",
    function: {
      name: "send_reminder",
      description: "Send a reminder",
      parameters: { type: "object", properties: { name: { type: "string" } } },
    },
  },
];

function request(content: string, extra: Record<string, unknown> = {}) {
  return {
    method: "POST",
    headers: { ...AUTH, "content-type": "application/json" },
    body: JSON.stringify({
      model: "tamiz-auto",
      stream: true,
      messages: [{ role: "user", content }],
      tools: TOOLS,
      ...extra,
    }),
  };
}

function events(raw: string): Array<Record<string, unknown>> {
  return raw
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).trim())
    .filter((data) => data !== "[DONE]")
    .map((data) => JSON.parse(data) as Record<string, unknown>);
}

interface ToolCallPiece {
  index: number;
  id?: string;
  type?: string;
  function?: { name?: string; arguments?: string };
}

function toolPieces(chunks: ReadonlyArray<Record<string, unknown>>): ToolCallPiece[] {
  return chunks.flatMap((chunk) => {
    const choices = (chunk["choices"] ?? []) as Array<{ delta?: { tool_calls?: ToolCallPiece[] } }>;
    return choices[0]?.delta?.tool_calls ?? [];
  });
}

const argumentsOf = (pieces: ReadonlyArray<ToolCallPiece>, index: number) =>
  pieces
    .filter((piece) => piece.index === index)
    .map((piece) => piece.function?.arguments ?? "")
    .join("");

const NAME_INSPECTION: Inspection = {
  status: "ok",
  level: "high",
  entities: [{ textIndex: 0, kind: "PERSON", start: 9, end: 9 + NAME.length, score: 0.9 }],
};

describe("streamed tool calls (US4)", () => {
  it("US4-1: OpenAI-shaped pieces: id, type and name first, then arguments; tool_calls finish", async () => {
    const { send } = await createTestApp({
      streamScript: async (input) =>
        ok({
          first: "",
          modelName: input.target.model,
          rest: parts(
            { type: "tool-call-start", index: 0, id: "call_b7", name: "send_reminder" },
            { type: "tool-call-delta", index: 0, arguments: '{"name":' },
            { type: "tool-call-delta", index: 0, arguments: '"x"}' },
            {
              type: "finish",
              finishReason: "tool_calls",
              usage: { promptTokens: 20, completionTokens: 9 },
            },
          ),
        }),
    });

    const response = await send("/v1/chat/completions", request("Recuérdaselo."));
    const raw = await response.text();
    const chunks = events(raw);

    for (const chunk of chunks)
      expect(ChatCompletionChunkSchema.safeParse(chunk).success).toBe(true);
    const pieces = toolPieces(chunks);
    expect(pieces[0]).toEqual({
      index: 0,
      id: "call_b7",
      type: "function",
      function: { name: "send_reminder", arguments: "" },
    });
    expect(pieces.slice(1)).toEqual([
      { index: 0, function: { arguments: '{"name":' } },
      { index: 0, function: { arguments: '"x"}' } },
    ]);
    const finish = chunks.find(
      (chunk) =>
        (chunk["choices"] as Array<{ finish_reason: string | null }>)[0]?.finish_reason !== null &&
        (chunk["choices"] as unknown[]).length > 0,
    );
    expect(finish?.["choices"]).toEqual([{ index: 0, delta: {}, finish_reason: "tool_calls" }]);
    expect(raw.trim().endsWith("data: [DONE]")).toBe(true);
  });

  it("US4-2: a placeholder split across argument pieces reaches the client restored, once", async () => {
    const { send } = await createTestApp({
      inspect: inspectAs(NAME_INSPECTION),
      streamScript: async (input) =>
        ok({
          first: "",
          modelName: input.target.model,
          rest: parts(
            { type: "tool-call-start", index: 0, id: "call_b7", name: "send_reminder" },
            { type: "tool-call-delta", index: 0, arguments: '{"name":"<PER' },
            { type: "tool-call-delta", index: 0, arguments: "SON" },
            { type: "tool-call-delta", index: 0, arguments: '_1>"}' },
            { type: "finish", finishReason: "tool_calls" },
          ),
        }),
    });

    const response = await send("/v1/chat/completions", request(`Recuerda ${NAME} su cita.`));
    const pieces = toolPieces(events(await response.text()));

    for (const piece of pieces) expect(piece.function?.arguments ?? "").not.toMatch(/<|PERSON/);
    expect(JSON.parse(argumentsOf(pieces, 0))).toEqual({ name: NAME });
  });

  it("US4-3: two calls keep their own index and their own restoration state", async () => {
    const { send } = await createTestApp({
      inspect: inspectAs(NAME_INSPECTION),
      streamScript: async (input) =>
        ok({
          first: "Voy.",
          modelName: input.target.model,
          rest: parts(
            { type: "tool-call-start", index: 0, id: "c0", name: "send_reminder" },
            { type: "tool-call-delta", index: 0, arguments: '{"name":"<PERSON' },
            { type: "tool-call-start", index: 1, id: "c1", name: "send_reminder" },
            { type: "tool-call-delta", index: 1, arguments: '{"name":"<PERSON_1>"}' },
            { type: "tool-call-delta", index: 0, arguments: '_1>"}' },
            { type: "finish", finishReason: "tool_calls" },
          ),
        }),
    });

    const response = await send("/v1/chat/completions", request(`Recuerda ${NAME} su cita.`));
    const pieces = toolPieces(events(await response.text()));

    expect(JSON.parse(argumentsOf(pieces, 0))).toEqual({ name: NAME });
    expect(JSON.parse(argumentsOf(pieces, 1))).toEqual({ name: NAME });
  });

  it("US4-4: a failure before the call starts falls back; after it, the error event ends the stream", async () => {
    const { send } = await createTestApp({
      streamScript: async (input) => {
        if (input.target.id === "mistral-small") {
          return err(failure("http_error", { status: 400, on: target("mistral-small") }));
        }
        return ok({
          first: "",
          modelName: input.target.model,
          rest: parts(
            { type: "tool-call-start", index: 0, id: "c0", name: "send_reminder" },
            { type: "error", error: failure("network", { on: input.target }) },
          ),
        });
      },
    });

    const response = await send("/v1/chat/completions", request("Recuérdaselo."));
    const raw = await response.text();

    expect(response.headers.get("x-tamiz-fallback")).toContain("mistral-small");
    expect(toolPieces(events(raw))[0]?.id).toBe("c0");
    expect(raw).toContain('"error"');
    expect(raw).not.toContain("[DONE]");
  });
});

describe("content-free telemetry with tools (US6-2, US6-3)", () => {
  const MARKER = "zz-tool-marker-zz";

  it("spans carry tool counts and called names; the marker is nowhere", async () => {
    const chunks: string[] = [];
    const logger = createLogger({
      level: "debug",
      destination: { write: (c: string) => void chunks.push(c) },
    });
    const spans = captureSpans();
    const { send, audit } = await createTestApp({
      logger,
      tracer: spans.tracer,
      events: fanOut(createLogRoutingEvents(logger), spans.events),
      script: (input) =>
        ok({
          text: "",
          toolCalls: [{ id: "c9", name: "send_reminder", arguments: `{"name":"${MARKER}"}` }],
          finishReason: "tool_calls",
          usage: { promptTokens: 20, completionTokens: 9 },
          modelName: input.target.model,
        }),
    });
    const tools = [
      {
        type: "function",
        function: {
          name: "send_reminder",
          description: `Description ${MARKER}`,
          parameters: { type: "object", properties: { [MARKER]: { type: "string" } } },
        },
      },
    ];

    const response = await send("/v1/chat/completions", {
      method: "POST",
      headers: { ...AUTH, "content-type": "application/json" },
      body: JSON.stringify({
        model: "tamiz-auto",
        messages: [
          { role: "user", content: "Hola" },
          {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "c1",
                type: "function",
                function: { name: "send_reminder", arguments: `{"name":"${MARKER}"}` },
              },
            ],
          },
          { role: "tool", tool_call_id: "c1", content: `Result ${MARKER}` },
        ],
        tools,
      }),
    });
    expect(response.status).toBe(200);
    await response.text();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const request = spans.spans().find((span) => span.name === "tamiz.request");
    expect(request?.attributes).toMatchObject({
      "tamiz.tools.declared": 1,
      "tamiz.tools.messages": 1,
      "tamiz.tools.called": ["send_reminder"],
    });
    const attempt = spans.spans().find((span) => span.name !== "tamiz.request");
    expect(attempt?.attributes["gen_ai.response.finish_reasons"]).toEqual(["tool_calls"]);
    const keys = spans.spans().flatMap((span) => Object.keys(span.attributes));
    expect(keys.filter((key) => /^gen_ai\.tool\./.test(key))).toEqual([]);
    expect(spans.dump()).not.toContain(MARKER);
    expect(chunks.join("")).not.toContain(MARKER);
    expect(JSON.stringify(audit.entries())).not.toContain(MARKER);
  });
});
