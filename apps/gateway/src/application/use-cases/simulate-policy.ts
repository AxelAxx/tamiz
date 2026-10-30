/**
 * `SimulatePolicy` (spec 005 US5, FR-018): what the gateway would do with a request,
 * without calling any provider.
 *
 * The same steps as `routeInference` up to the provider call: inspection, classification,
 * decision and, for `anonymize`, the messages a provider would receive. The dependencies
 * have no provider registry, so a simulation cannot reach one by construction.
 */
import type { InferenceRequest, Message } from "../../domain/model/inference-request.js";
import type { Decision } from "../../domain/model/routing-decision.js";
import type { Inspection } from "../../domain/model/sensitivity.js";
import { protectMessages } from "./protect-messages.js";
import { decideWithPrivacy, type RouteInferenceDeps } from "./route-inference.js";

export type SimulatePolicyDeps = Pick<
  RouteInferenceDeps,
  "policies" | "clock" | "events" | "inspect" | "anonymizationNotice"
>;

export interface SimulationResult {
  readonly inspection: Inspection;
  readonly decision: Decision;
  /** Only for `anonymize`. */
  readonly providerMessages?: ReadonlyArray<Message>;
  readonly noticeVersion?: string;
}

export type SimulatePolicy = (request: InferenceRequest) => Promise<SimulationResult>;

export function simulatePolicy(deps: SimulatePolicyDeps): SimulatePolicy {
  return async (request) => {
    const { inspection, decision } = await decideWithPrivacy(deps, request);
    if (decision.kind === "block") return { inspection, decision };
    const sent = protectMessages(decision, inspection, request.messages, deps.anonymizationNotice);
    if (sent.noticeVersion === undefined) return { inspection, decision };
    return {
      inspection,
      decision,
      providerMessages: sent.providerMessages,
      noticeVersion: sent.noticeVersion,
    };
  };
}
