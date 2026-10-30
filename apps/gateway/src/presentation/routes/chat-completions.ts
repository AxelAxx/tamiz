/**
 * `POST /v1/chat/completions`, non-streaming (spec 002 FR-024 … FR-027, contracts/http.md;
 * spec 003 FR-015, FR-016, FR-019).
 *
 * The route is declared with `createRoute`, so the OpenAPI document is generated from
 * the contract schemas. Every response for which a routing decision was made carries
 * `x-tamiz-route` (the target that answered or, on failure, the last one reached) and
 * `x-tamiz-rule`, plus `x-tamiz-fallback` whenever a target was abandoned. A failure maps
 * to 451 (residency), 502 (provider error), 503 with `retry-after` (every circuit open)
 * or 504 (timeout or request deadline).
 */
import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import type { RouteInference } from "../../application/use-cases/route-inference.js";
import { type Abandoned, formatFallbackHeader } from "../../domain/model/fallback.js";
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
export const FALLBACK_HEADER = "x-tamiz-fallback";

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
      description: "The completion of the target that answered, after any fallbacks",
      headers: z.object({
        [ROUTE_HEADER]: z.string().describe("Target id that served the request"),
        [RULE_HEADER]: z.string().describe("Matched rule id, or `default`"),
        [FALLBACK_HEADER]: z
          .string()
          .optional()
          .describe(
            "Abandoned targets in order as `targetId:reason`; only when a fallback happened",
          ),
        "x-request-id": z.string().describe("Request id, echoed or generated"),
      }),
      content: { "application/json": { schema: ChatCompletionResponseBody } },
    },
    400: errorResponse("The body fails the contract, is not JSON, or exceeds 1 MiB"),
    401: errorResponse("Missing or invalid API key"),
    451: errorResponse("A target outside the allowed residencies would have been used"),
    502: errorResponse("Every target of the chain failed"),
    503: errorResponse("Every target was skipped because its circuit is open; see `retry-after`"),
    504: errorResponse("A target timed out last, or the request deadline was reached"),
  },
});

export type ChatEnv = { Variables: RequestIdVariables & ClientIdVariables };

function setRoutingHeaders(
  c: Context<ChatEnv>,
  decision: RoutingDecision,
  targetId: string,
  abandoned: ReadonlyArray<Abandoned>,
): void {
  c.header(ROUTE_HEADER, targetId);
  c.header(RULE_HEADER, decision.ruleId);
  if (abandoned.length > 0) c.header(FALLBACK_HEADER, formatFallbackHeader(abandoned));
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
      const { decision, failure } = result.error;
      setRoutingHeaders(c, decision, failure.target.id, failure.abandoned);
      if (failure.kind === "unavailable") {
        c.header("retry-after", String(Math.ceil(failure.error.retryAfterMs / 1000)));
      }
      const status = httpStatusFor(domainErrorToErrorType(failure.error)) as 451 | 502 | 503 | 504;
      return c.json(domainErrorToEnvelope(failure.error, requestId), status);
    }
    const { decision, target, abandoned } = result.value;
    setRoutingHeaders(c, decision, target.id, abandoned);
    return c.json(toChatCompletionResponse(result.value, requestId), 200);
  });
}
