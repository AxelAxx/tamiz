/**
 * `ClassifyTask` (spec 002 FR-011, data-model section 4.2): turns a validated request
 * into the `ClassifiedRequest` the routing decision reads.
 *
 * Since spec 005 the request's inspection (where its personal data is) travels with it.
 */
import type { InferenceRequest } from "../../domain/model/inference-request.js";
import type { Inspection } from "../../domain/model/sensitivity.js";
import { type ClassifiedRequest, classify } from "../../domain/model/task-classifier.js";

export function classifyTask(request: InferenceRequest, inspection: Inspection): ClassifiedRequest {
  return { ...request, ...classify(request.messages, request.tools), inspection };
}
