/**
 * Loads the versioned placeholder notices (spec 005 research R-06): `prompts/<name>.v<N>.md`.
 * `v1` is for requests without tools; `v2` also asks to keep placeholders in tool-call
 * arguments and is used when a request has tools or tool messages (009 tool-calling FR-014,
 * research T-R12). A missing or empty file is a configuration error, so the gateway never
 * anonymizes without telling the model to keep the placeholders.
 */
import { readFileSync } from "node:fs";
import type {
  AnonymizationNotice,
  AnonymizationNotices,
} from "../../application/use-cases/protect-request.js";
import { type ConfigurationError, configurationError } from "../../domain/errors.js";
import { err, ok, type Result } from "../../domain/result.js";

export const ANONYMIZATION_NOTICE_VERSION = "v1";
export const TOOLS_ANONYMIZATION_NOTICE_VERSION = "v2";

const noticeFile = (version: string) =>
  new URL(`../../../prompts/anonymization-notice.${version}.md`, import.meta.url);

export const ANONYMIZATION_NOTICE_FILE = noticeFile(ANONYMIZATION_NOTICE_VERSION);
export const TOOLS_ANONYMIZATION_NOTICE_FILE = noticeFile(TOOLS_ANONYMIZATION_NOTICE_VERSION);

export function loadAnonymizationNotice(
  file: URL = ANONYMIZATION_NOTICE_FILE,
  version: string = ANONYMIZATION_NOTICE_VERSION,
): Result<AnonymizationNotice, ConfigurationError> {
  let text: string;
  try {
    text = readFileSync(file, "utf8").trim();
  } catch {
    text = "";
  }
  if (text === "") {
    return err(
      configurationError("Missing anonymization notice", [
        {
          path: "prompts",
          message: `expected a non-empty anonymization notice file (${file.pathname})`,
        },
      ]),
    );
  }
  return ok({ version, text });
}

/** Both notices; the first missing one is the error. */
export function loadAnonymizationNotices(): Result<AnonymizationNotices, ConfigurationError> {
  const plain = loadAnonymizationNotice();
  if (!plain.ok) return plain;
  const tools = loadAnonymizationNotice(
    TOOLS_ANONYMIZATION_NOTICE_FILE,
    TOOLS_ANONYMIZATION_NOTICE_VERSION,
  );
  if (!tools.ok) return tools;
  return ok({ plain: plain.value, tools: tools.value });
}
