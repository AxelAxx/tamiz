import { describe, expect, it } from "vitest";
import type {
  ProviderCompletionInput,
  StreamPart,
} from "../src/application/ports/llm-provider.port.js";
import type { Inspection } from "../src/domain/model/sensitivity.js";
import { ok } from "../src/domain/result.js";
import { AUTH, createTestApp } from "./helpers/app.js";
import { inspectAs } from "./helpers/privacy.js";
import { failure } from "./resilience/helpers.js";

// Spec 005 US4-1, US4-4, FR-016, FR-017 (tasks.md T039, T040): an anonymized stream is
// restored across chunk boundaries, and what is held is flushed before the usage chunk
// or the error event.

const TEXT = "Escribe a Ana Ruiz (ana@example.com).";
const INSPECTION: Inspection = {
  status: "ok",
  level: "high",
  entities: [
    { messageIndex: 0, kind: "PERSON", start: 10, end: 18, score: 0.85 },
    { messageIndex: 0, kind: "EMAIL", start: 20, end: 35, score: 1 },
  ],
};

async function* parts(...items: StreamPart[]): AsyncGenerator<StreamPart> {
  for (const item of items) yield item;
}

function request() {
  return {
    method: "POST",
    headers: { ...AUTH, "content-type": "application/json" },
    body: JSON.stringify({
      model: "tamiz-auto",
      stream: true,
      messages: [{ role: "user", content: TEXT }],
    }),
  };
}

function events(raw: string): unknown[] {
  return raw
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).trim())
    .filter((data) => data !== "[DONE]")
    .map((data) => JSON.parse(data) as unknown);
}

function contentOf(chunks: unknown[]): string {
  return chunks
    .map((chunk) => {
      const choice = (chunk as { choices?: Array<{ delta?: { content?: string } }> }).choices?.[0];
      return choice?.delta?.content ?? "";
    })
    .join("");
}

describe("streaming restoration (spec 005)", () => {
  it("US4-1: placeholders split across chunks reach the client restored, once", async () => {
    const seen: ProviderCompletionInput[] = [];
    const { send } = await createTestApp({
      inspect: inspectAs(INSPECTION),
      streamScript: async (input) => {
        seen.push(input);
        return ok({
          first: "Hecho: <PERS",
          modelName: input.target.model,
          rest: parts(
            { type: "delta", text: "ON_1> recibirá el co" },
            { type: "delta", text: "rreo en <EMA" },
            { type: "delta", text: "IL_1>." },
            {
              type: "finish",
              finishReason: "stop",
              usage: { promptTokens: 20, completionTokens: 9 },
            },
          ),
        });
      },
    });

    const response = await send("/v1/chat/completions", request());
    const raw = await response.text();

    expect(contentOf(events(raw))).toBe("Hecho: Ana Ruiz recibirá el correo en ana@example.com.");
    expect(raw).not.toMatch(/<PERS|<EMA/);
    expect(JSON.stringify(seen)).not.toContain("Ana Ruiz");
  });

  it("US4-4: text held at the end is flushed before the usage chunk", async () => {
    const { send } = await createTestApp({
      inspect: inspectAs(INSPECTION),
      streamScript: async (input) =>
        ok({
          first: "Firma: ",
          modelName: input.target.model,
          rest: parts(
            { type: "delta", text: "<PERSON_" },
            {
              type: "finish",
              finishReason: "stop",
              usage: { promptTokens: 5, completionTokens: 3 },
            },
          ),
        }),
    });

    const chunks = events(await (await send("/v1/chat/completions", request())).text());
    const usageIndex = chunks.findIndex((chunk) => (chunk as { usage?: unknown }).usage != null);
    const flushedIndex = chunks.findIndex((chunk) => contentOf([chunk]) === "<PERSON_");

    expect(contentOf(chunks)).toBe("Firma: <PERSON_");
    expect(flushedIndex).toBeGreaterThan(-1);
    expect(flushedIndex).toBeLessThan(usageIndex);
  });

  it("held text is flushed before a mid-stream error event", async () => {
    const { send } = await createTestApp({
      inspect: inspectAs(INSPECTION),
      streamScript: async (input) =>
        ok({
          first: "Para <PERSON_1",
          modelName: input.target.model,
          rest: parts({ type: "error", error: failure("network", { on: input.target }) }),
        }),
    });

    const chunks = events(await (await send("/v1/chat/completions", request())).text());

    expect(contentOf(chunks)).toBe("Para <PERSON_1");
    expect(chunks.at(-1)).toHaveProperty("error");
  });
});
