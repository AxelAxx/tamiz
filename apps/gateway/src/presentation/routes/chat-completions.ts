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
 *
 * With `stream: true` (spec 003 FR-021 … FR-027) the response starts only once the
 * answering target's first token is there, so the headers are final; it is a stream of
 * chunks, a finish and a usage chunk, then `[DONE]`. A failure before the first token
 * gets the JSON error response above; after it, one error event and no `[DONE]`. The
 * client's disconnect aborts the upstream call.
 */
import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import type { Context, Schema } from "hono";
import { streamSSE } from "hono/streaming";
import type {
  RouteInference,
  RoutingFailure,
} from "../../application/use-cases/route-inference.js";
import type { StreamInference } from "../../application/use-cases/stream-inference.js";
import { type Abandoned, formatFallbackHeader } from "../../domain/model/fallback.js";
import type { Decision, RoutingDecision } from "../../domain/model/routing-decision.js";
import { chunkMapper } from "../mappers/chat-completion-chunk.js";
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
  ChatCompletionChunkBody,
  ChatCompletionRequestBody,
  ChatCompletionResponseBody,
  ErrorEnvelopeBody,
} from "../openapi-schemas.js";

export const ROUTE_HEADER = "x-tamiz-route";
export const RULE_HEADER = "x-tamiz-rule";
export const FALLBACK_HEADER = "x-tamiz-fallback";
/** Spec 005 FR-014: the request's sensitivity and the privacy action applied. */
export const SENSITIVITY_HEADER = "x-tamiz-sensitivity";
export const PRIVACY_HEADER = "x-tamiz-privacy";

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
        [SENSITIVITY_HEADER]: z
          .enum(["unknown", "none", "low", "high", "critical"])
          .describe("Highest sensitivity found in the messages; `unknown` if inspection failed"),
        [PRIVACY_HEADER]: z
          .string()
          .describe(
            "Privacy action applied: `allow`, `anonymize;notice=v1` or `restrict_to_local`",
          ),
        "x-request-id": z.string().describe("Request id, echoed or generated"),
      }),
      content: {
        "application/json": { schema: ChatCompletionResponseBody },
        // With `stream: true`: server-sent `data:` lines, each a chunk, then `[DONE]`.
        "text/event-stream": { schema: ChatCompletionChunkBody },
      },
    },
    400: errorResponse("The body fails the contract, is not JSON, or exceeds 1 MiB"),
    401: errorResponse("Missing or invalid API key"),
    451: errorResponse(
      "Refused by policy: a target outside the allowed residencies, or the privacy action blocks",
    ),
    502: errorResponse("Every target of the chain failed"),
    503: errorResponse(
      "Every circuit is open (see `retry-after`), or the privacy service failed and the policy blocks",
    ),
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

/** `anonymize;notice=v1` when the notice was added, else the action. */
function setPrivacyHeaders(c: Context<ChatEnv>, decision: Decision, noticeVersion?: string): void {
  c.header(SENSITIVITY_HEADER, decision.sensitivity);
  c.header(
    PRIVACY_HEADER,
    noticeVersion === undefined
      ? decision.privacyAction
      : `${decision.privacyAction};notice=${noticeVersion}`,
  );
}

function failed(c: Context<ChatEnv>, requestId: string, routing: RoutingFailure) {
  setPrivacyHeaders(c, routing.decision);
  if (routing.failure.kind === "blocked") {
    c.header(RULE_HEADER, routing.decision.ruleId);
    const error = routing.failure.error;
    const status = httpStatusFor(domainErrorToErrorType(error)) as 451 | 503;
    return c.json(domainErrorToEnvelope(error, requestId), status);
  }
  const { decision, failure } = routing as Extract<RoutingFailure, { decision: RoutingDecision }>;
  setRoutingHeaders(c, decision, failure.target.id, failure.abandoned);
  if (failure.kind === "unavailable") {
    c.header("retry-after", String(Math.ceil(failure.error.retryAfterMs / 1000)));
  }
  const status = httpStatusFor(domainErrorToErrorType(failure.error)) as 451 | 502 | 503 | 504;
  return c.json(domainErrorToEnvelope(failure.error, requestId), status);
}

export function registerChatCompletions<S extends Schema, B extends string>(
  app: OpenAPIHono<ChatEnv, S, B>,
  routeInference: RouteInference,
  streamInference: StreamInference,
) {
  return app.openapi(chatCompletionsRoute, async (c) => {
    const requestId = c.get("requestId");
    const body = c.req.valid("json");
    const request = toInferenceRequest(body, requestId, c.get("clientId"));

    if (body.stream === true) {
      const streamed = await streamInference(request, c.req.raw.signal);
      if (!streamed.ok) return failed(c, requestId, streamed.error);
      const routed = streamed.value;
      setRoutingHeaders(c, routed.decision, routed.target.id, routed.abandoned);
      setPrivacyHeaders(c, routed.decision, routed.noticeVersion);
      const chunks = chunkMapper(routed, requestId);
      // The documented 200 is JSON; the event stream is the same status with another type.
      return streamSSE(c, async (sse) => {
        const send = (data: unknown) => sse.writeSSE({ data: JSON.stringify(data) });
        await send(chunks.first());
        for await (const part of routed.parts) {
          if (part.type === "delta") {
            await send(chunks.delta(part.text));
          } else if (part.type === "finish") {
            for (const chunk of chunks.finish(part)) await send(chunk);
            await sse.writeSSE({ data: "[DONE]" });
            return;
          } else {
            await send(chunks.error(part.error));
            return;
          }
        }
      }) as never;
    }

    const result = await routeInference(request);
    if (!result.ok) return failed(c, requestId, result.error);
    const { decision, target, abandoned, noticeVersion } = result.value;
    setRoutingHeaders(c, decision, target.id, abandoned);
    setPrivacyHeaders(c, decision, noticeVersion);
    return c.json(toChatCompletionResponse(result.value, requestId), 200);
  });
}
