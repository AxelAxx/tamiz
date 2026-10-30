import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  anonymizeMessages,
  type PlaceholderEntry,
  restore,
} from "../../src/domain/model/placeholders.js";
import type { DetectedEntity, EntityKind } from "../../src/domain/model/sensitivity.js";

// Spec 005 US2-2, US2-3, FR-012, research R-01, R-10 (tasks.md T025).

const SPECS = resolve(import.meta.dirname, "../../../../specs");

interface Vector {
  readonly name: string;
  readonly text: string;
  readonly findings: ReadonlyArray<{ kind: EntityKind; start: number; end: number }>;
  readonly expected: { text: string; mapping: PlaceholderEntry[] };
}

const vectors = (
  JSON.parse(
    readFileSync(
      resolve(SPECS, "005-privacy-aware-routing/contracts/placeholder-vectors.json"),
      "utf8",
    ),
  ) as { vectors: Vector[] }
).vectors;

const entitiesOf = (findings: Vector["findings"], messageIndex = 0): DetectedEntity[] =>
  findings.map((f) => ({ messageIndex, kind: f.kind, start: f.start, end: f.end, score: 1 }));

describe("shared placeholder vectors (Python reference = TypeScript port)", () => {
  it.each(vectors.map((v) => [v.name, v] as const))("%s", (_name, vector) => {
    const result = anonymizeMessages([vector.text], entitiesOf(vector.findings));
    expect(result.messages).toEqual([vector.expected.text]);
    expect(result.mapping).toEqual(vector.expected.mapping);
    expect(restore(result.messages[0] ?? "", result.mapping)).toBe(vector.text);
  });

  it("spec 004's anonymize example", () => {
    const example = JSON.parse(
      readFileSync(resolve(SPECS, "004-privacy-service/contracts/anonymize.example.json"), "utf8"),
    ) as {
      request: { text: string };
      response: {
        text: string;
        mapping: PlaceholderEntry[];
        analysis: { findings: Vector["findings"] };
      };
    };
    const result = anonymizeMessages(
      [example.request.text],
      entitiesOf(example.response.analysis.findings),
    );
    expect(result.messages[0]).toBe(example.response.text);
    expect(result.mapping).toEqual(example.response.mapping);
  });
});

describe("anonymizeMessages across messages", () => {
  it("US2-2: the same value in two messages gets one placeholder; numbering continues", () => {
    const messages = ["Soy Ana Ruiz.", "Ana Ruiz y Pedro Gil firman."];
    const result = anonymizeMessages(messages, [
      { messageIndex: 0, kind: "PERSON", start: 4, end: 12, score: 0.85 },
      { messageIndex: 1, kind: "PERSON", start: 0, end: 8, score: 0.85 },
      { messageIndex: 1, kind: "PERSON", start: 11, end: 20, score: 0.85 },
    ]);
    expect(result.messages).toEqual(["Soy <PERSON_1>.", "<PERSON_1> y <PERSON_2> firman."]);
    expect(result.mapping.map((e) => e.placeholder)).toEqual(["<PERSON_1>", "<PERSON_2>"]);
  });

  it("numbering skips placeholders already present in any message", () => {
    const result = anonymizeMessages(
      ["Plantilla <DNI_2>.", "DNI 12345678Z"],
      [{ messageIndex: 1, kind: "DNI", start: 4, end: 13, score: 1 }],
    );
    expect(result.messages[1]).toBe("DNI <DNI_3>");
  });

  it("ignores entities out of range or overlapping an earlier one", () => {
    const result = anonymizeMessages(
      ["Ana Ruiz"],
      [
        { messageIndex: 0, kind: "PERSON", start: 0, end: 8, score: 0.85 },
        { messageIndex: 0, kind: "LOCATION", start: 4, end: 8, score: 0.85 },
        { messageIndex: 0, kind: "PERSON", start: 5, end: 99, score: 0.85 },
      ],
    );
    expect(result.messages).toEqual(["<PERSON_1>"]);
  });
});

describe("restore", () => {
  const mapping: PlaceholderEntry[] = [
    { placeholder: "<PERSON_1>", kind: "PERSON", value: "Ana Ruiz" },
  ];

  it("US2-3: leaves unmapped or altered placeholders untouched", () => {
    expect(restore("<PERSON_1>, <PERSON_9>, PERSON_1, <Person_1>", mapping)).toBe(
      "Ana Ruiz, <PERSON_9>, PERSON_1, <Person_1>",
    );
  });

  it("never re-replaces a value that looks like a placeholder", () => {
    const tricky: PlaceholderEntry[] = [
      { placeholder: "<PERSON_1>", kind: "PERSON", value: "<PERSON_2>" },
      { placeholder: "<PERSON_2>", kind: "PERSON", value: "Ana" },
    ];
    expect(restore("<PERSON_1> y <PERSON_2>", tricky)).toBe("<PERSON_2> y Ana");
  });

  it("round trip for any texts and non-overlapping entities", () => {
    const textArb = fc.string({ unit: fc.constantFrom(..."ab <>_DNIPERSON0123 ".split("")) });
    fc.assert(
      fc.property(fc.array(textArb, { minLength: 1, maxLength: 3 }), fc.nat(), (texts, seed) => {
        const entities: DetectedEntity[] = [];
        texts.forEach((text, messageIndex) => {
          let cursor = seed % 3;
          while (cursor + 2 <= text.length) {
            entities.push({
              messageIndex,
              kind: "PERSON",
              start: cursor,
              end: cursor + 2,
              score: 1,
            });
            cursor += 4;
          }
        });
        const result = anonymizeMessages(texts, entities);
        expect(result.messages.map((m) => restore(m, result.mapping))).toEqual(texts);
      }),
      { numRuns: 500 },
    );
  });
});
