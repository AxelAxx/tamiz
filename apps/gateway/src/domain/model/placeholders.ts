/**
 * Reversible placeholders (spec 005 FR-012, research R-01, R-10; port of spec 004 R-07).
 *
 * Each detected value becomes `<KIND_n>`: numbered per kind from 1 in order of first
 * appearance across all messages, one placeholder per distinct (kind, value), starting
 * after the highest `n` already present for that kind so restoration stays exact. The
 * Python reference (`services/privacy/src/privacy/domain/placeholders.py`) and this port
 * run the same test vectors. The mapping is returned to the caller and kept nowhere.
 *
 * The 009 tool-calling addendum (research T-R06, T-R07) adds JSON texts (tool-call
 * arguments): a value is replaced only where the JSON keeps its shape (`placeJsonSpan`),
 * a whole number becomes a quoted placeholder, and restoring into JSON escapes the value.
 */
import { placeJsonSpan } from "./json-spans.js";
import { type DetectedEntity, ENTITY_KINDS, type EntityKind } from "./sensitivity.js";

const KINDS_LONGEST_FIRST = [...ENTITY_KINDS].sort((a, b) => b.length - a.length).join("|");
/** Matches any `<KIND_n>`; create a new `RegExp` from its source to use the `g` flag. */
export const PLACEHOLDER_PATTERN = new RegExp(`<(${KINDS_LONGEST_FIRST})_(\\d+)>`);

export interface PlaceholderEntry {
  readonly placeholder: string;
  readonly kind: EntityKind;
  readonly value: string;
}

export interface AnonymizedMessages {
  readonly messages: ReadonlyArray<string>;
  /** In order of first appearance. */
  readonly mapping: ReadonlyArray<PlaceholderEntry>;
}

function globalPattern(): RegExp {
  return new RegExp(PLACEHOLDER_PATTERN.source, "g");
}

function highestExisting(texts: ReadonlyArray<string>): Map<EntityKind, number> {
  const highest = new Map<EntityKind, number>();
  for (const text of texts) {
    for (const match of text.matchAll(globalPattern())) {
      const kind = match[1] as EntityKind;
      highest.set(kind, Math.max(highest.get(kind) ?? 0, Number(match[2])));
    }
  }
  return highest;
}

export interface AnonymizedTexts {
  readonly texts: ReadonlyArray<string>;
  /** In order of first appearance. */
  readonly mapping: ReadonlyArray<PlaceholderEntry>;
  /** True when a value in a JSON text could not be replaced without breaking it. */
  readonly unsafe: boolean;
}

/**
 * Replaces `entities` (UTF-16 offsets per text) by placeholders. Entities outside their
 * text or overlapping an earlier one in the same text are ignored: the detector never
 * returns them, and replacing them would corrupt the text. Texts whose index is in
 * `jsonTexts` are JSON: see the module comment.
 */
export function anonymizeTexts(
  texts: ReadonlyArray<string>,
  entities: ReadonlyArray<DetectedEntity>,
  jsonTexts: ReadonlySet<number> = new Set(),
): AnonymizedTexts {
  const lastNumber = highestExisting(texts);
  const byValue = new Map<string, string>();
  const mapping: PlaceholderEntry[] = [];
  let unsafe = false;
  const ordered = [...entities].sort((a, b) => a.textIndex - b.textIndex || a.start - b.start);

  const result = texts.map((text, index) => {
    const pieces: string[] = [];
    let cursor = 0;
    for (const entity of ordered) {
      if (entity.textIndex !== index) continue;
      if (entity.start < cursor || entity.end > text.length || entity.end <= entity.start) {
        continue;
      }
      const placement = jsonTexts.has(index)
        ? placeJsonSpan(text, entity.start, entity.end)
        : "in_string";
      if (placement === "unsafe") {
        unsafe = true;
        continue;
      }
      const raw = text.slice(entity.start, entity.end);
      // Inside a JSON string the raw text may hold escapes: the mapping keeps the value.
      const value = jsonTexts.has(index) && placement === "in_string" ? unescapeJson(raw) : raw;
      const key = `${entity.kind}\u0000${value}`;
      let placeholder = byValue.get(key);
      if (placeholder === undefined) {
        const next = (lastNumber.get(entity.kind) ?? 0) + 1;
        lastNumber.set(entity.kind, next);
        placeholder = `<${entity.kind}_${next}>`;
        byValue.set(key, placeholder);
        mapping.push({ placeholder, kind: entity.kind, value });
      }
      const replacement = placement === "whole_number" ? `"${placeholder}"` : placeholder;
      pieces.push(text.slice(cursor, entity.start), replacement);
      cursor = entity.end;
    }
    pieces.push(text.slice(cursor));
    return pieces.join("");
  });
  return { texts: result, mapping, unsafe };
}

/** `anonymizeTexts` over plain message contents (spec 005). */
export function anonymizeMessages(
  messages: ReadonlyArray<string>,
  entities: ReadonlyArray<DetectedEntity>,
): AnonymizedMessages {
  const { texts, mapping } = anonymizeTexts(messages, entities);
  return { messages: texts, mapping };
}

/** A value as it may appear inside a JSON string literal. */
export function escapeJson(value: string): string {
  return JSON.stringify(value).slice(1, -1);
}

/** The value of raw JSON string content whose escapes are whole (`placeJsonSpan`). */
function unescapeJson(raw: string): string {
  return JSON.parse(`"${raw}"`) as string;
}

/**
 * One pass: each placeholder that is in the mapping becomes its value (passed through
 * `escapeValue`, for JSON texts); nothing else changes.
 */
export function restore(
  text: string,
  mapping: ReadonlyArray<PlaceholderEntry>,
  escapeValue: (value: string) => string = (value) => value,
): string {
  if (mapping.length === 0) return text;
  const values = new Map(mapping.map((entry) => [entry.placeholder, escapeValue(entry.value)]));
  return text.replace(globalPattern(), (match) => values.get(match) ?? match);
}
