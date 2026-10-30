/**
 * `POST /v1/chat/completions`, non-streaming (spec 002 FR-024 … FR-027, contracts/http.md).
 *
 * The route is declared with `createRoute`, so the OpenAPI document is generated from
 * the contract schemas. Every response for which a routing decision was made carries
 * `x-tamiz-route` and `x-tamiz-rule`, success and provider failure alike (FR-026).
 */
import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import type { RouteInference } from "../../application/use-cases/route-inference.js";
import type { RoutingDecision } from "../../domain/model/routing-decision.js";
import { toChatCompletionResponse } from "../mappers/chat-completion-response.js";
import {
  domainErrorToEnvelope,
  domainErrorToErrorType,
  httpStatusFor,
} from "../mappers/error-envelope.js";
import { toInferenceRequest } from "../mappers/inference-request.js";
import type { ClientIdVariables } from "../middlewares/api-key-auth.js";
import type { RequestIdVariables } from "../middlewares/request-id.js";
import {
  ChatCompletionRequestBody,
  ChatCompletionResponseBody,
  ErrorEnvelopeBody,
} from "../openapi-schemas.js";

export const ROUTE_HEADER = "x-tamiz-route";
export const RULE_HEADER = "x-tamiz-rule";

const errorResponse = (description: string) => ({
  description,
  content: { "application/json": { schema: ErrorEnvelopeBody } },
});

export const chatCompletionsRoute = createRoute({
  method: "post",
  path: "/v1/chat/completions",
  summary: "Create a chat completion, routed by the active policy",
  security: [{ bearerAuth: [] }],
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: ChatCompletionRequestBody } },
    },
  },
  responses: {
    200: {
      description: "The completion of the first target of the routing decision",
      headers: z.object({
        [ROUTE_HEADER]: z.string().describe("Target id that served the request"),
        [RULE_HEADER]: z.string().describe("Matched rule id, or `default`"),
        "x-request-id": z.string().describe("Request id, echoed or generated"),
      }),
      content: { "application/json": { schema: ChatCompletionResponseBody } },
    },
    400: errorResponse("The body fails the contract, is not JSON, or exceeds 1 MiB"),
    401: errorResponse("Missing or invalid API key"),
    502: errorResponse("The provider failed"),
    504: errorResponse("The provider timed out"),
  },
});

export type ChatEnv = { Variables: RequestIdVariables & ClientIdVariables };

function setRoutingHeaders(c: Context<ChatEnv>, decision: RoutingDecision, targetId: string): void {
  c.header(ROUTE_HEADER, targetId);
  c.header(RULE_HEADER, decision.ruleId);
}

export function registerChatCompletions(
  app: OpenAPIHono<ChatEnv>,
  routeInference: RouteInference,
): void {
  app.openapi(chatCompletionsRoute, async (c) => {
    const requestId = c.get("requestId");
    const request = toInferenceRequest(c.req.valid("json"), requestId, c.get("clientId"));
    const result = await routeInference(request);
    if (!result.ok) {
      const { decision, target, error } = result.error;
      setRoutingHeaders(c, decision, target.id);
      const status = httpStatusFor(domainErrorToErrorType(error)) as 502 | 504;
      return c.json(domainErrorToEnvelope(error, requestId), status);
    }
    setRoutingHeaders(c, result.value.decision, result.value.target.id);
    return c.json(toChatCompletionResponse(result.value, requestId), 200);
  });
}
