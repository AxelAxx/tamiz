import type { InspectSensitivity } from "../../src/application/use-cases/inspect-sensitivity.js";
import type {
  AnonymizationNotice,
  AnonymizationNotices,
} from "../../src/application/use-cases/protect-request.js";
import type { Inspection } from "../../src/domain/model/sensitivity.js";

/** What the detector reports for a text without personal data. */
export const CLEAN: Inspection = { status: "ok", level: "none", entities: [] };

export const TEST_NOTICE: AnonymizationNotice = {
  version: "v1",
  text: "Keep every <KIND_n> placeholder exactly as written.",
};

export const TEST_TOOLS_NOTICE: AnonymizationNotice = {
  version: "v2",
  text: "Keep every <KIND_n> placeholder exactly as written, in tool arguments too.",
};

export const TEST_NOTICES: AnonymizationNotices = { plain: TEST_NOTICE, tools: TEST_TOOLS_NOTICE };

/** An `InspectSensitivity` that answers from a script, recording the inspected messages. */
export function inspectAs(
  answer: Inspection | ((messages: ReadonlyArray<string>) => Inspection),
): InspectSensitivity & { readonly calls: ReadonlyArray<ReadonlyArray<string>> } {
  const calls: Array<ReadonlyArray<string>> = [];
  const inspect = async ({ messages }: { messages: ReadonlyArray<string> }) => {
    calls.push(messages);
    return typeof answer === "function" ? answer(messages) : answer;
  };
  return Object.assign(inspect, { calls });
}

/** The privacy dependencies of the inference use cases, for tests that do not inspect. */
export function cleanPrivacyDeps(): {
  inspect: InspectSensitivity;
  anonymizationNotices: AnonymizationNotices;
} {
  return { inspect: inspectAs(CLEAN), anonymizationNotices: TEST_NOTICES };
}
