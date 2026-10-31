/**
 * The model's answer in the agent's text tool protocol (spec 009 FR-015, research R-10,
 * data-model section 4.1, contracts/agent-protocol.md): exactly one JSON object, a tool call
 * or a final answer, optionally in a code fence or after some prose.
 */
import { z } from "zod";
import { err, ok, type Result } from "../result.js";

export const AgentActionSchema = z.union([
  z.strictObject({
    tool: z.string().min(1),
    arguments: z.record(z.string(), z.unknown()).default({}),
  }),
  z.strictObject({ answer: z.string().min(1) }),
]);

export type AgentAction = z.infer<typeof AgentActionSchema>;

/**
 * The first balanced JSON object in the text, parsed with {@link AgentActionSchema}. A text
 * that is a JSON array, holds no object, or whose first object is not an action is a format
 * error; the agent sends it back to the model as an observation.
 */
export function extractAction(text: string): Result<AgentAction, "format"> {
  const unfenced = text.replace(/```(?:json)?/g, "").trim();
  if (unfenced.startsWith("[")) return err("format");
  const candidate = firstObject(unfenced);
  if (candidate === undefined) return err("format");
  let value: unknown;
  try {
    value = JSON.parse(candidate);
  } catch {
    return err("format");
  }
  const parsed = AgentActionSchema.safeParse(value);
  return parsed.success ? ok(parsed.data) : err("format");
}

/** The text of the first `{ … }` whose braces balance outside JSON strings. */
function firstObject(text: string): string | undefined {
  const start = text.indexOf("{");
  if (start === -1) return undefined;
  let depth = 0;
  let inString = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (char === "\\") index += 1;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(start, index + 1);
    }
  }
  return undefined;
}
