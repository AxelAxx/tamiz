/**
 * Where personal data in a request is found (spec 005 FR-006, data-model section 3.1).
 *
 * The production adapter calls the privacy service; tests use a scripted fake. `inspect`
 * never rejects: an unreachable service, a timeout or an answer that breaks the contract
 * is an `Inspection` with `status: "failed"`, so the caller always applies the policy's
 * `onDetectorError` instead of treating the request as clean.
 */
import type { Inspection } from "../../domain/model/sensitivity.js";

export interface PiiDetectorPort {
  /** Findings for `messages` (the request's message contents, in order). */
  inspect(messages: ReadonlyArray<string>, signal: AbortSignal): Promise<Inspection>;
}
