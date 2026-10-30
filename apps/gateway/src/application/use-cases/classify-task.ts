/**
 * `ClassifyTask` (spec 002 FR-011, data-model section 4.2): turns a validated request
 * into the `ClassifiedRequest` the routing decision reads.
 *
 * The inspection is `NOT_INSPECTED` (level `none`) until the gateway calls the privacy
 * service (spec 005 tasks.md T036).
 */
import type { InferenceRequest } from "../../domain/model/inference-request.js";
import { type Inspection, NOT_INSPECTED } from "../../domain/model/sensitivity.js";
import { type ClassifiedRequest, classify } from "../../domain/model/task-classifier.js";

export function classifyTask(
  request: InferenceRequest,
  inspection: Inspection = NOT_INSPECTED,
): ClassifiedRequest {
  return { ...request, ...classify(request.messages), inspection };
}
