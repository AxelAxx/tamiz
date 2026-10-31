/**
 * `SimulatePolicy` (spec 005 US5, FR-018): what the gateway would do with a request,
 * without calling any provider.
 *
 * The same steps as `routeInference` up to the provider call: inspection, classification,
 * decision and, for `anonymize`, the messages a provider would receive. The dependencies
 * have no provider registry, so a simulation cannot reach one by construction.
 *
 * Tool calling (009 tool-calling FR-015): each detected entity's text has a location
 * (message content, a tool call's arguments, a tool definition), and the anonymized
 * messages include the anonymized arguments and tool results.
 */
import type { InferenceRequest, Message } from "../../domain/model/inference-request.js";
import { inspectedTexts, type TextLocation } from "../../domain/model/inspected-text.js";
import type { Decision } from "../../domain/model/routing-decision.js";
import type { Inspection } from "../../domain/model/sensitivity.js";
import { protectRequest } from "./protect-request.js";
import { decideWithPrivacy, type RouteInferenceDeps } from "./route-inference.js";

export type SimulatePolicyDeps = Pick<
  RouteInferenceDeps,
  "policies" | "clock" | "events" | "inspect" | "anonymizationNotices"
>;

export interface SimulationResult {
  readonly inspection: Inspection;
  readonly decision: Decision;
  /** Where each inspected text is: `inspection.entities[i].textIndex` indexes this list. */
  readonly locations: ReadonlyArray<TextLocation>;
  /** Only for `anonymize`. */
  readonly providerMessages?: ReadonlyArray<Message>;
  readonly noticeVersion?: string;
}

export type SimulatePolicy = (request: InferenceRequest) => Promise<SimulationResult>;

export function simulatePolicy(deps: SimulatePolicyDeps): SimulatePolicy {
  return async (request) => {
    const { inspection, decision } = await decideWithPrivacy(deps, request);
    const locations = inspectedTexts(request).map(({ location }) => location);
    if (decision.kind === "block") return { inspection, decision, locations };
    const sent = protectRequest(decision, inspection, request, deps.anonymizationNotices);
    if (sent.noticeVersion === undefined) return { inspection, decision, locations };
    return {
      inspection,
      decision,
      locations,
      providerMessages: sent.providerMessages,
      noticeVersion: sent.noticeVersion,
    };
  };
}
