/**
 * `ClassifyTask` (spec 002 FR-011, data-model section 4.2): turns a validated request
 * into the `ClassifiedRequest` the routing decision reads.
 *
 * Sensitivity is `unknown` until feature 005 inspects the request.
 */
import type { InferenceRequest } from "../../domain/model/inference-request.js";
import { type ClassifiedRequest, classify } from "../../domain/model/task-classifier.js";

export function classifyTask(request: InferenceRequest): ClassifiedRequest {
  return { ...request, ...classify(request.messages), sensitivity: "unknown" };
}
