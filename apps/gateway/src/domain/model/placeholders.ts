/**
 * Reversible placeholders (spec 005 FR-012, research R-01, R-10; port of spec 004 R-07).
 *
 * Each detected value becomes `<KIND_n>`: numbered per kind from 1 in order of first
 * appearance across all messages, one placeholder per distinct (kind, value), starting
 * after the highest `n` already present for that kind so restoration stays exact. The
 * Python reference (`services/privacy/src/privacy/domain/placeholders.py`) and this port
 * run the same test vectors. The mapping is returned to the caller and kept nowhere.
 */
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

function highestExisting(messages: ReadonlyArray<string>): Map<EntityKind, number> {
  const highest = new Map<EntityKind, number>();
  for (const message of messages) {
    for (const match of message.matchAll(globalPattern())) {
      const kind = match[1] as EntityKind;
      highest.set(kind, Math.max(highest.get(kind) ?? 0, Number(match[2])));
    }
  }
  return highest;
}

/**
 * Replaces `entities` (UTF-16 offsets per message) by placeholders. Entities outside their
 * message or overlapping an earlier one in the same message are ignored: the detector
 * never returns them, and replacing them would corrupt the text.
 */
export function anonymizeMessages(
  messages: ReadonlyArray<string>,
  entities: ReadonlyArray<DetectedEntity>,
): AnonymizedMessages {
  const lastNumber = highestExisting(messages);
  const byValue = new Map<string, string>();
  const mapping: PlaceholderEntry[] = [];
  const ordered = [...entities].sort(
    (a, b) => a.messageIndex - b.messageIndex || a.start - b.start,
  );

  const result = messages.map((message, index) => {
    const pieces: string[] = [];
    let cursor = 0;
    for (const entity of ordered) {
      if (entity.messageIndex !== index) continue;
      if (entity.start < cursor || entity.end > message.length || entity.end <= entity.start) {
        continue;
      }
      const value = message.slice(entity.start, entity.end);
      const key = `${entity.kind}\u0000${value}`;
      let placeholder = byValue.get(key);
      if (placeholder === undefined) {
        const next = (lastNumber.get(entity.kind) ?? 0) + 1;
        lastNumber.set(entity.kind, next);
        placeholder = `<${entity.kind}_${next}>`;
        byValue.set(key, placeholder);
        mapping.push({ placeholder, kind: entity.kind, value });
      }
      pieces.push(message.slice(cursor, entity.start), placeholder);
      cursor = entity.end;
    }
    pieces.push(message.slice(cursor));
    return pieces.join("");
  });
  return { messages: result, mapping };
}

/** One pass: each placeholder that is in the mapping becomes its value; nothing else changes. */
export function restore(text: string, mapping: ReadonlyArray<PlaceholderEntry>): string {
  if (mapping.length === 0) return text;
  const values = new Map(mapping.map((entry) => [entry.placeholder, entry.value]));
  return text.replace(globalPattern(), (match) => values.get(match) ?? match);
}
