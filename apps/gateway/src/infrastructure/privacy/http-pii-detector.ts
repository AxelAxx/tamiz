/**
 * `PiiDetectorPort` over the privacy service's `POST /analyze` (spec 005 FR-007, research
 * R-02, R-03, data-model section 4).
 *
 * One call per request: the message contents are joined by a blank line, which no
 * recognizer spans. The answer is checked against the Zod mirror of the service's
 * contract; the service's code-point offsets are converted to UTF-16 indices and mapped
 * back to each message. A finding that does not fall inside one message is a `contract`
 * failure (fail closed). Nothing from the request text reaches an error or a log: failures
 * are reported as a reason only.
 */
import { PrivacyAnalyzeResponseSchema } from "@tamiz/contracts";
import type { PiiDetectorPort } from "../../application/ports/pii-detector.port.js";
import type {
  DetectedEntity,
  DetectorFailure,
  Inspection,
} from "../../domain/model/sensitivity.js";

export const MESSAGE_SEPARATOR = "\n\n";

export interface HttpPiiDetectorOptions {
  /** Base URL of the privacy service, for example `http://privacy:8001`. */
  readonly baseUrl: string;
  readonly fetch?: typeof globalThis.fetch;
}

function failed(reason: DetectorFailure): Inspection {
  return { status: "failed", reason };
}

/** `index[cp]` is the UTF-16 offset of code point `cp`; the last entry is the length. */
function codePointToUtf16(text: string): number[] {
  const index = [0];
  let units = 0;
  for (const char of text) {
    units += char.length;
    index.push(units);
  }
  return index;
}

export function createHttpPiiDetector(options: HttpPiiDetectorOptions): PiiDetectorPort {
  // Resolved per call, so a test interceptor installed after construction is honoured.
  const fetchImpl: typeof globalThis.fetch =
    options.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const url = `${options.baseUrl.replace(/\/+$/, "")}/analyze`;

  return {
    async inspect(messages, signal) {
      const joined = messages.join(MESSAGE_SEPARATOR);
      let response: Response;
      try {
        response = await fetchImpl(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text: joined }),
          signal,
        });
      } catch {
        return failed(signal.aborted ? "timeout" : "unavailable");
      }
      if (response.status >= 500) return failed("unavailable");
      if (!response.ok) return failed("contract");

      let body: unknown;
      try {
        body = await response.json();
      } catch {
        return failed(signal.aborted ? "timeout" : "contract");
      }
      const parsed = PrivacyAnalyzeResponseSchema.safeParse(body);
      if (!parsed.success) return failed("contract");

      const utf16 = codePointToUtf16(joined);
      const starts: number[] = [];
      let offset = 0;
      for (const message of messages) {
        starts.push(offset);
        offset += message.length + MESSAGE_SEPARATOR.length;
      }

      const entities: DetectedEntity[] = [];
      for (const finding of parsed.data.findings) {
        const start = utf16[finding.start];
        const end = utf16[finding.end];
        if (start === undefined || end === undefined || end <= start) return failed("contract");
        let messageIndex = 0;
        while (messageIndex + 1 < starts.length && (starts[messageIndex + 1] ?? 0) <= start) {
          messageIndex += 1;
        }
        const messageStart = starts[messageIndex];
        const message = messages[messageIndex];
        if (messageStart === undefined || message === undefined) return failed("contract");
        if (end > messageStart + message.length) return failed("contract");
        entities.push({
          messageIndex,
          kind: finding.kind,
          start: start - messageStart,
          end: end - messageStart,
          score: finding.score,
        });
      }
      return { status: "ok", level: parsed.data.sensitivity_level, entities };
    },
  };
}
