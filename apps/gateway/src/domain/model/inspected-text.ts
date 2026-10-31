/**
 * Every text a provider will read, with where it is (009 tool-calling FR-007, research
 * T-R04, data-model 1.2).
 *
 * Order: messages in order; within a message its content (when it has text), then each
 * tool call's arguments; then the tool definitions. The detector inspects these texts and
 * `DetectedEntity.textIndex` is an index into this list. For a request without tools the
 * list is exactly the message contents, so detection of tool-free requests is unchanged.
 * Tool names and tool-call ids are identifiers, not inspected.
 */
import type { InferenceRequest, ToolDefinition } from "./inference-request.js";
import { placeJsonSpan } from "./json-spans.js";
import type { NotAnonymizableReason } from "./privacy-policy.js";
import type { Inspection } from "./sensitivity.js";

export type TextLocation =
  | { readonly kind: "content"; readonly messageIndex: number }
  | { readonly kind: "arguments"; readonly messageIndex: number; readonly toolCallIndex: number }
  | { readonly kind: "tool_definition"; readonly toolIndex: number };

export interface InspectedText {
  readonly location: TextLocation;
  readonly text: string;
}

/** What the provider reads of a tool definition besides its name. */
export function definitionText(tool: ToolDefinition): string {
  const parts = [
    tool.description ?? "",
    tool.parameters === undefined ? "" : JSON.stringify(tool.parameters),
  ];
  return parts.join("\n");
}

export function inspectedTexts(
  request: Pick<InferenceRequest, "messages" | "tools">,
): ReadonlyArray<InspectedText> {
  const texts: InspectedText[] = [];
  request.messages.forEach((message, messageIndex) => {
    if (message.content !== null) {
      texts.push({ location: { kind: "content", messageIndex }, text: message.content });
    }
    if (message.role !== "assistant") return;
    message.toolCalls.forEach((call, toolCallIndex) => {
      texts.push({
        location: { kind: "arguments", messageIndex, toolCallIndex },
        text: call.arguments,
      });
    });
  });
  request.tools?.forEach((tool, toolIndex) => {
    texts.push({ location: { kind: "tool_definition", toolIndex }, text: definitionText(tool) });
  });
  return texts;
}

/**
 * Why anonymizing this request would not be safe, if it would not (009 tool-calling
 * FR-011, research T-R06): a value in a tool definition, or one in tool-call arguments
 * that does not sit inside a JSON string or exactly on a number.
 */
export function notAnonymizableReason(
  texts: ReadonlyArray<InspectedText>,
  inspection: Inspection,
): NotAnonymizableReason | undefined {
  if (inspection.status !== "ok") return undefined;
  let reason: NotAnonymizableReason | undefined;
  for (const entity of inspection.entities) {
    const inspected = texts[entity.textIndex];
    if (inspected === undefined) continue;
    if (inspected.location.kind === "tool_definition") return "tool_definition";
    if (
      inspected.location.kind === "arguments" &&
      placeJsonSpan(inspected.text, entity.start, entity.end) === "unsafe"
    ) {
      reason = "json_structure";
    }
  }
  return reason;
}
