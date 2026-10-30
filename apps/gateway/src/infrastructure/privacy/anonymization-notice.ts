/**
 * Loads the versioned placeholder notice (spec 005 research R-06): `prompts/<name>.v<N>.md`.
 * A missing or empty file is a configuration error, so the gateway never anonymizes
 * without telling the model to keep the placeholders.
 */
import { readFileSync } from "node:fs";
import type { AnonymizationNotice } from "../../application/use-cases/protect-messages.js";
import { type ConfigurationError, configurationError } from "../../domain/errors.js";
import { err, ok, type Result } from "../../domain/result.js";

export const ANONYMIZATION_NOTICE_VERSION = "v1";

export const ANONYMIZATION_NOTICE_FILE = new URL(
  `../../../prompts/anonymization-notice.${ANONYMIZATION_NOTICE_VERSION}.md`,
  import.meta.url,
);

export function loadAnonymizationNotice(
  file: URL = ANONYMIZATION_NOTICE_FILE,
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
  return ok({ version: ANONYMIZATION_NOTICE_VERSION, text });
}
