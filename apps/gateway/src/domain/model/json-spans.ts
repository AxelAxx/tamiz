/**
 * Where a detected span sits in a JSON text (009 tool-calling FR-010, FR-011, research
 * T-R06, data-model 1.3).
 *
 * Tool-call arguments are inspected as the JSON text the provider receives. A span can be
 * replaced by a placeholder only when the result is still JSON with the same shape:
 * - strictly inside one string literal, not cutting an escape sequence → in place;
 * - exactly one whole number literal → the placeholder as a JSON string;
 * - anything else (quotes, punctuation, several tokens) → unsafe.
 * The scanner is deliberately small: the edge has already checked the text is JSON.
 */

export type SpanPlacement = "in_string" | "whole_number" | "unsafe";

interface Token {
  readonly kind: "string" | "number" | "other";
  readonly start: number;
  /** Exclusive. */
  readonly end: number;
  /** Escape sequences of a string, as `[start, end)` ranges. */
  readonly escapes: ReadonlyArray<readonly [number, number]>;
}

const NUMBER_START = /[-0-9]/;
const NUMBER_PART = /[-+.eE0-9]/;
const WHITESPACE = /\s/;

function scanString(json: string, start: number): Token {
  const escapes: Array<readonly [number, number]> = [];
  let index = start + 1;
  while (index < json.length && json[index] !== '"') {
    if (json[index] === "\\") {
      const length = json[index + 1] === "u" ? 6 : 2;
      escapes.push([index, index + length]);
      index += length;
    } else {
      index += 1;
    }
  }
  return { kind: "string", start, end: Math.min(index + 1, json.length), escapes };
}

function tokens(json: string): Token[] {
  const found: Token[] = [];
  let index = 0;
  while (index < json.length) {
    const char = json[index] ?? "";
    if (WHITESPACE.test(char)) {
      index += 1;
    } else if (char === '"') {
      const token = scanString(json, index);
      found.push(token);
      index = token.end;
    } else if (NUMBER_START.test(char)) {
      let end = index + 1;
      while (end < json.length && NUMBER_PART.test(json[end] ?? "")) end += 1;
      found.push({ kind: "number", start: index, end, escapes: [] });
      index = end;
    } else {
      found.push({ kind: "other", start: index, end: index + 1, escapes: [] });
      index += 1;
    }
  }
  return found;
}

const cutsEscape = (token: Token, offset: number) =>
  token.escapes.some(([start, end]) => offset > start && offset < end);

export function placeJsonSpan(json: string, start: number, end: number): SpanPlacement {
  if (end <= start) return "unsafe";
  const token = tokens(json).find((t) => start >= t.start && start < t.end);
  if (token === undefined) return "unsafe";
  if (token.kind === "number") {
    return start === token.start && end === token.end ? "whole_number" : "unsafe";
  }
  if (token.kind !== "string") return "unsafe";
  const inside = start > token.start && end < token.end;
  if (!inside || cutsEscape(token, start) || cutsEscape(token, end)) return "unsafe";
  return "in_string";
}
