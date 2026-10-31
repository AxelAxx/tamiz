/**
 * Placeholder-safe restoration of a streamed answer (spec 005 FR-016, FR-017, research R-07).
 *
 * A provider may split `<PERSON_1>` across chunks (`<PERS` + `ON_1>`). `push` restores
 * every complete placeholder it has and returns everything except a trailing piece that
 * could still become a placeholder: the text from the last `<`, when it is a prefix of
 * `<KIND_n>` and no longer than `MAX_HELD`. Anything else is released at once, so plain
 * text is never delayed. `flush` releases the rest at the end of the stream. For any
 * chunking, the concatenated output equals `restore` over the whole text.
 *
 * For streamed tool-call arguments (009 tool-calling FR-013) the restorer is given
 * `escapeJson`, so restored values stay valid inside JSON strings.
 */
import { type PlaceholderEntry, restore } from "./placeholders.js";
import { ENTITY_KINDS } from "./sensitivity.js";

/** `<CREDIT_CARD_` plus up to nine digits; longer prefixes are released unchanged. */
export const MAX_HELD = "<CREDIT_CARD_".length + 9;

export interface StreamRestorer {
  push(text: string): string;
  flush(): string;
}

/** True when `text` (starting with `<`) can still grow into `<KIND_n>`. */
export function isPlaceholderPrefix(text: string): boolean {
  if (!text.startsWith("<") || text.length > MAX_HELD) return false;
  const rest = text.slice(1);
  return ENTITY_KINDS.some((kind) => {
    const head = `${kind}_`;
    if (head.startsWith(rest)) return true;
    return rest.startsWith(head) && /^\d*$/.test(rest.slice(head.length));
  });
}

export function createStreamRestorer(
  mapping: ReadonlyArray<PlaceholderEntry>,
  escapeValue?: (value: string) => string,
): StreamRestorer {
  let pending = "";
  return {
    push(text) {
      pending += text;
      const lastOpen = pending.lastIndexOf("<");
      const held = lastOpen >= 0 && isPlaceholderPrefix(pending.slice(lastOpen)) ? lastOpen : -1;
      const ready = held < 0 ? pending : pending.slice(0, held);
      pending = held < 0 ? "" : pending.slice(held);
      return restore(ready, mapping, escapeValue);
    },
    flush() {
      const rest = pending;
      pending = "";
      return restore(rest, mapping, escapeValue);
    },
  };
}
