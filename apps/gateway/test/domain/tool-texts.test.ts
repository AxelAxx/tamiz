/**
 * Inspected texts, JSON span placement, anonymizing and restoring tool-call arguments
 * (009 tool-calling FR-007, FR-009 … FR-013, US2-3, US3-3 … US3-6, research T-R04,
 * T-R06, T-R07).
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { Message } from "../../src/domain/model/inference-request.js";
import { inspectedTexts, notAnonymizableReason } from "../../src/domain/model/inspected-text.js";
import { placeJsonSpan } from "../../src/domain/model/json-spans.js";
import {
  anonymizeTexts,
  escapeJson,
  type PlaceholderEntry,
  restore,
} from "../../src/domain/model/placeholders.js";
import { createStreamRestorer } from "../../src/domain/model/restore-stream.js";
import type { DetectedEntity, Inspection } from "../../src/domain/model/sensitivity.js";

const ARGS = '{"name":"Ana Ruiz Gil","phone":612345678,"note":"Jos\\u00e9 \\"Pepe\\""}';

const conversation: ReadonlyArray<Message> = [
  { role: "system", content: "Be brief." },
  { role: "user", content: "Remind the patient." },
  {
    role: "assistant",
    content: null,
    toolCalls: [{ id: "c1", name: "send_reminder", arguments: ARGS }],
  },
  { role: "tool", toolCallId: "c1", toolName: "send_reminder", content: "DNI 12345678Z ok" },
  { role: "assistant", content: "Done.", toolCalls: [] },
];

const span = (text: string, value: string) => {
  const start = text.indexOf(value);
  return { start, end: start + value.length };
};

describe("inspectedTexts (FR-007, T-R04)", () => {
  it("lists contents, then each call's arguments, then tool definitions, with locations", () => {
    const texts = inspectedTexts({
      messages: conversation,
      tools: [{ name: "send_reminder", description: "Send it", parameters: { type: "object" } }],
    });
    expect(texts.map((t) => t.location)).toEqual([
      { kind: "content", messageIndex: 0 },
      { kind: "content", messageIndex: 1 },
      { kind: "arguments", messageIndex: 2, toolCallIndex: 0 },
      { kind: "content", messageIndex: 3 },
      { kind: "content", messageIndex: 4 },
      { kind: "tool_definition", toolIndex: 0 },
    ]);
    expect(texts[2]?.text).toBe(ARGS);
    expect(texts[5]?.text).toBe('Send it\n{"type":"object"}');
  });

  it("is exactly the message contents for a tool-free request", () => {
    const messages: Message[] = [
      { role: "user", content: "a" },
      { role: "assistant", content: "", toolCalls: [] },
    ];
    expect(inspectedTexts({ messages }).map((t) => t.text)).toEqual(["a", ""]);
  });
});

describe("placeJsonSpan (FR-010, T-R06)", () => {
  it("places a value inside a string, a whole number, and rejects structure", () => {
    const name = span(ARGS, "Ana Ruiz Gil");
    expect(placeJsonSpan(ARGS, name.start, name.end)).toBe("in_string");
    const phone = span(ARGS, "612345678");
    expect(placeJsonSpan(ARGS, phone.start, phone.end)).toBe("whole_number");
    expect(placeJsonSpan(ARGS, phone.start + 1, phone.end)).toBe("unsafe");
    expect(placeJsonSpan(ARGS, name.start - 1, name.end)).toBe("unsafe");
    expect(placeJsonSpan(ARGS, name.start, name.end + 1)).toBe("unsafe");
    const across = span(ARGS, 'Gil","phone');
    expect(placeJsonSpan(ARGS, across.start, across.end)).toBe("unsafe");
  });

  it("never cuts an escape sequence", () => {
    const escaped = span(ARGS, "\\u00e9");
    expect(placeJsonSpan(ARGS, escaped.start - 3, escaped.end)).toBe("in_string");
    expect(placeJsonSpan(ARGS, escaped.start + 2, escaped.end)).toBe("unsafe");
    const quote = span(ARGS, '\\"Pepe');
    expect(placeJsonSpan(ARGS, quote.start + 1, quote.end)).toBe("unsafe");
  });

  it("US3-4, US3-5: any span it places keeps the JSON parseable with the same number of keys", () => {
    const value = fc.oneof(
      fc.string({ minLength: 1, maxLength: 12 }),
      fc.integer({ min: 0, max: 999_999_999 }),
    );
    fc.assert(
      fc.property(
        fc.dictionary(fc.constantFrom("a", "b", "c"), value, { minKeys: 1 }),
        fc.nat(),
        fc.nat(),
        (object, a, b) => {
          const json = JSON.stringify(object);
          const start = a % json.length;
          const end = start + 1 + (b % (json.length - start));
          const placement = placeJsonSpan(json, start, end);
          if (placement === "unsafe") return;
          const placeholder = placement === "whole_number" ? '"<PHONE_1>"' : "<PHONE_1>";
          const replaced = json.slice(0, start) + placeholder + json.slice(end);
          expect(Object.keys(JSON.parse(replaced) as object)).toHaveLength(
            Object.keys(object).length,
          );
        },
      ),
    );
  });
});

const texts = inspectedTexts({ messages: conversation }).map((t) => t.text);
const ARGS_INDEX = 2;
const RESULT_INDEX = 3;

function entity(kind: DetectedEntity["kind"], textIndex: number, value: string): DetectedEntity {
  const { start, end } = span(texts[textIndex] ?? "", value);
  return { kind, textIndex, start, end, score: 0.9 };
}

describe("anonymizeTexts over JSON arguments (FR-009, FR-010)", () => {
  it("US3-1, US3-4, US3-5: replaces values in results and arguments; JSON still parses", () => {
    const entities = [
      entity("PERSON", ARGS_INDEX, "Ana Ruiz Gil"),
      entity("PHONE", ARGS_INDEX, "612345678"),
      entity("DNI", RESULT_INDEX, "12345678Z"),
    ];
    const out = anonymizeTexts(texts, entities, new Set([ARGS_INDEX]));
    expect(out.unsafe).toBe(false);
    expect(out.texts[RESULT_INDEX]).toBe("DNI <DNI_1> ok");
    expect(JSON.parse(out.texts[ARGS_INDEX] ?? "")).toEqual({
      name: "<PERSON_1>",
      phone: "<PHONE_1>",
      note: 'José "Pepe"',
    });
  });

  it("keeps the decoded value of an escaped string in the mapping", () => {
    const out = anonymizeTexts(
      texts,
      [entity("PERSON", ARGS_INDEX, "Jos\\u00e9")],
      new Set([ARGS_INDEX]),
    );
    expect(out.mapping).toEqual([{ placeholder: "<PERSON_1>", kind: "PERSON", value: "José" }]);
  });

  it("US3-6: flags a span that crosses JSON structure and leaves it in place", () => {
    const out = anonymizeTexts(
      texts,
      [entity("PERSON", ARGS_INDEX, 'Gil","phone')],
      new Set([ARGS_INDEX]),
    );
    expect(out.unsafe).toBe(true);
    expect(out.texts[ARGS_INDEX]).toBe(ARGS);
  });

  it("gives the same placeholder to the same value in content and arguments", () => {
    const withName = [...texts.slice(0, RESULT_INDEX), "Ana Ruiz Gil was reminded"];
    const out = anonymizeTexts(
      withName,
      [
        entity("PERSON", ARGS_INDEX, "Ana Ruiz Gil"),
        { kind: "PERSON", textIndex: RESULT_INDEX, start: 0, end: 12, score: 0.9 },
      ],
      new Set([ARGS_INDEX]),
    );
    expect(out.mapping).toHaveLength(1);
    expect(out.texts[RESULT_INDEX]).toBe("<PERSON_1> was reminded");
  });
});

describe("notAnonymizableReason (FR-011)", () => {
  const ok = (entities: DetectedEntity[]): Inspection => ({
    status: "ok",
    level: "high",
    entities,
  });

  it("is undefined when every value can be replaced", () => {
    const located = inspectedTexts({ messages: conversation });
    expect(
      notAnonymizableReason(located, ok([entity("PERSON", ARGS_INDEX, "Ana Ruiz Gil")])),
    ).toBeUndefined();
  });

  it("US3-6: names JSON structure and tool definitions", () => {
    const located = inspectedTexts({
      messages: conversation,
      tools: [{ name: "send_reminder", description: "For Ana Ruiz Gil" }],
    });
    expect(notAnonymizableReason(located, ok([entity("PERSON", ARGS_INDEX, 'Gil","phone')]))).toBe(
      "json_structure",
    );
    const inDefinition = { kind: "PERSON" as const, textIndex: 5, start: 4, end: 16, score: 0.9 };
    expect(notAnonymizableReason(located, ok([inDefinition]))).toBe("tool_definition");
  });
});

describe("restoring into JSON (FR-012, FR-013)", () => {
  const mapping: PlaceholderEntry[] = [
    { placeholder: "<PERSON_1>", kind: "PERSON", value: 'Ana "La" Ruiz\\Gil' },
  ];

  it('US3-3: escapes a value with " and \\ so the arguments still parse', () => {
    const restored = restore('{"name":"<PERSON_1>"}', mapping, escapeJson);
    expect(JSON.parse(restored)).toEqual({ name: 'Ana "La" Ruiz\\Gil' });
  });

  it("restores a split placeholder in streamed arguments exactly like the whole text", () => {
    const whole = '{"name":"<PERSON_1>","n":1}';
    fc.assert(
      fc.property(fc.array(fc.nat({ max: whole.length }), { maxLength: 6 }), (cuts) => {
        const points = [...new Set(cuts)].sort((a, b) => a - b);
        const restorer = createStreamRestorer(mapping, escapeJson);
        let out = "";
        let previous = 0;
        for (const point of [...points, whole.length]) {
          const piece = restorer.push(whole.slice(previous, point));
          expect(piece).not.toMatch(/<PERS|<PERSON_1>/);
          out += piece;
          previous = point;
        }
        out += restorer.flush();
        expect(out).toBe(restore(whole, mapping, escapeJson));
      }),
    );
  });
});
