/**
 * The contract schemas as named OpenAPI components (spec 002 FR-031, research R-11).
 *
 * `@hono/zod-openapi` adds `.openapi()` by patching Zod, but Zod 4 copies methods onto
 * each schema when it is created, so a contract schema built before that patch never
 * gets the method and `registry.register()` fails depending on import order. Zod 4's
 * native `.meta({ id })` is read by the generator instead: it names the component and
 * every route that uses the schema refers to it. `.meta()` returns a copy that
 * validates exactly like the contract schema.
 */
import {
  ChatCompletionChunkSchema,
  ChatCompletionRequestSchema,
  ChatCompletionResponseSchema,
  ErrorEnvelopeSchema,
  HealthResponseSchema,
  SimulateResponseSchema,
} from "@tamiz/contracts";

export const ChatCompletionRequestBody = ChatCompletionRequestSchema.meta({
  id: "ChatCompletionRequest",
});
export const ChatCompletionResponseBody = ChatCompletionResponseSchema.meta({
  id: "ChatCompletionResponse",
});
export const ChatCompletionChunkBody = ChatCompletionChunkSchema.meta({
  id: "ChatCompletionChunk",
});
export const ErrorEnvelopeBody = ErrorEnvelopeSchema.meta({ id: "ErrorEnvelope" });
export const HealthResponseBody = HealthResponseSchema.meta({ id: "HealthResponse" });
export const SimulateResponseBody = SimulateResponseSchema.meta({ id: "SimulateResponse" });
