import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type PlaceholderEntry, restore } from "../../src/domain/model/placeholders.js";
import {
  createStreamRestorer,
  isPlaceholderPrefix,
  MAX_HELD,
} from "../../src/domain/model/restore-stream.js";

// Spec 005 US4-1 … US4-5, FR-016, FR-017, SC-003, research R-07 (tasks.md T038).

const MAPPING: PlaceholderEntry[] = [
  { placeholder: "<PERSON_1>", kind: "PERSON", value: "Ana Ruiz" },
  { placeholder: "<EMAIL_1>", kind: "EMAIL", value: "ana@example.com" },
  { placeholder: "<CREDIT_CARD_12>", kind: "CREDIT_CARD", value: "4111 1111 1111 1111" },
];

function stream(chunks: string[]): string[] {
  const restorer = createStreamRestorer(MAPPING);
  return [...chunks.map((chunk) => restorer.push(chunk)), restorer.flush()];
}

describe("createStreamRestorer", () => {
  it("US4-1: a placeholder split across chunks comes out once, restored, in place", () => {
    const out = stream(["Hola <PERS", "ON_", "1>, ¿qué tal?"]);
    expect(out).toEqual(["Hola ", "", "Ana Ruiz, ¿qué tal?", ""]);
  });

  it("US4-2: text that cannot start a placeholder is forwarded immediately", () => {
    expect(stream(["Hola ", "mundo", " 3 < 4"])).toEqual(["Hola ", "mundo", " 3 < 4", ""]);
  });

  it("US4-3: a held prefix that does not complete a placeholder is released unchanged", () => {
    expect(stream(["Ver <PER", "RO> ahora"])).toEqual(["Ver ", "<PERRO> ahora", ""]);
    expect(stream(["<EMAIL_", "x"])).toEqual(["", "<EMAIL_x", ""]);
  });

  it("US4-4: the stream end flushes what is held", () => {
    expect(stream(["Firma: <PERSON_"])).toEqual(["Firma: ", "<PERSON_"]);
    expect(stream(["Firma: <PERSON_1"])).toEqual(["Firma: ", "<PERSON_1"]);
  });

  it("restores several placeholders in one chunk and leaves unmapped ones alone", () => {
    expect(stream(["<PERSON_1> y <EMAIL_1> y <PERSON_9>"]).join("")).toBe(
      "Ana Ruiz y ana@example.com y <PERSON_9>",
    );
  });

  it("never holds more than MAX_HELD characters", () => {
    const restorer = createStreamRestorer(MAPPING);
    expect(restorer.push(`<CREDIT_CARD_${"9".repeat(20)}`)).toBe(`<CREDIT_CARD_${"9".repeat(20)}`);
    expect(isPlaceholderPrefix("<CREDIT_CARD_123")).toBe(true);
    expect(isPlaceholderPrefix(`<CREDIT_CARD_${"1".repeat(MAX_HELD)}`)).toBe(false);
  });

  it.each([
    ["<", true],
    ["<P", true],
    ["<PERSON", true],
    ["<PERSON_12", true],
    ["<PERSON_1>", false],
    ["<person", false],
    ["<X", false],
    ["hola", false],
  ])("isPlaceholderPrefix(%j) = %s", (text, expected) => {
    expect(isPlaceholderPrefix(text)).toBe(expected);
  });

  it("US4-5, SC-003: for any answer and any split into up to 3 cuts, streaming = non-streaming", () => {
    const piece = fc.constantFrom(
      "<PERSON_1>",
      "<EMAIL_1>",
      "<CREDIT_CARD_12>",
      "<PERSON_9>",
      "<PERSON_",
      "<PERS",
      "<",
      ">",
      "Hola ",
      "y ",
      "3 < 4 ",
      "<EMAIL_x",
      "ñ😀",
    );
    fc.assert(
      fc.property(
        fc.array(piece, { maxLength: 12 }),
        fc.array(fc.nat(), { maxLength: 3 }),
        (pieces, cuts) => {
          const full = pieces.join("");
          const positions = [
            ...new Set(cuts.map((cut) => (full.length === 0 ? 0 : cut % (full.length + 1)))),
          ].sort((a, b) => a - b);
          const chunks: string[] = [];
          let previous = 0;
          for (const position of [...positions, full.length]) {
            chunks.push(full.slice(previous, position));
            previous = position;
          }
          expect(stream(chunks).join("")).toBe(restore(full, MAPPING));
        },
      ),
      { numRuns: 5_000 },
    );
  });

  it("every split point of a fixed answer gives the same text", () => {
    const full = "Para <PERSON_1> (<EMAIL_1>), tarjeta <CREDIT_CARD_12>; <PERSON_9> no.";
    for (let i = 0; i <= full.length; i += 1) {
      for (let j = i; j <= full.length; j += 1) {
        const out = stream([full.slice(0, i), full.slice(i, j), full.slice(j)]).join("");
        expect(out).toBe(restore(full, MAPPING));
      }
    }
  });
});
