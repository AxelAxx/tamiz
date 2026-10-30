/**
 * Chat completion request DTO → domain `InferenceRequest` (spec 002 FR-002, FR-016,
 * research R-01). The contract already validated the body; the ids come from the
 * request-id middleware and the authenticated key. The client's `user` field is never
 * forwarded (US6-7).
 */
import type { ChatCompletionRequest } from "@tamiz/contracts";
import type { InferenceRequest } from "../../domain/model/inference-request.js";
import { clientIdUnchecked, requestIdUnchecked } from "../../domain/model/units.js";

export function toInferenceRequest(
  dto: ChatCompletionRequest,
  requestId: string,
  clientId: string,
): InferenceRequest {
  return {
    requestId: requestIdUnchecked(requestId),
    clientId: clientIdUnchecked(clientId),
    requestedModel: dto.model,
    messages: dto.messages,
    ...(dto.temperature !== undefined && { temperature: dto.temperature }),
    ...(dto.max_tokens !== undefined && { maxTokens: dto.max_tokens }),
  };
}
