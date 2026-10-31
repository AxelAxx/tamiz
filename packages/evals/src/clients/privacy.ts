/**
 * The privacy service as the evals see it: `POST /analyze` (spec 004 contract), with the
 * service's own defaults, exactly as the gateway calls it.
 */
import { type PrivacyAnalyzeResponseDto, PrivacyAnalyzeResponseSchema } from "@tamiz/contracts";
import { ServiceError } from "../eval.js";

export interface PrivacyClient {
  analyze(text: string): Promise<PrivacyAnalyzeResponseDto>;
}

export function createPrivacyClient(options: {
  readonly baseUrl: string;
  readonly fetch: typeof fetch;
  readonly timeoutMs?: number;
}): PrivacyClient {
  return {
    async analyze(text) {
      let response: Response;
      try {
        response = await options.fetch(new URL("/analyze", options.baseUrl), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text }),
          signal: AbortSignal.timeout(options.timeoutMs ?? 30_000),
        });
      } catch (error) {
        const timedOut = error instanceof DOMException && error.name === "TimeoutError";
        throw new ServiceError("privacy", timedOut ? "timeout" : "unavailable");
      }
      if (!response.ok) throw new ServiceError("privacy", `http_${response.status}`);
      const parsed = PrivacyAnalyzeResponseSchema.safeParse(
        await response.json().catch(() => undefined),
      );
      if (!parsed.success) throw new ServiceError("privacy", "contract");
      return parsed.data;
    },
  };
}
