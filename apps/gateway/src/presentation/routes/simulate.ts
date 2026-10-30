/**
 * `POST /v1/simulate` (spec 005 US5, FR-018, FR-019): a dry run of inspection, routing
 * and privacy for a chat completion request. No provider is called, and the answer holds
 * positions, never values (except, for `anonymize`, the placeholder messages a provider
 * would receive, which contain none by construction).
 */
import { createRoute, type OpenAPIHono } from "@hono/zod-openapi";
import type { SimulateResponse } from "@tamiz/contracts";
import type {
  SimulatePolicy,
  SimulationResult,
} from "../../application/use-cases/simulate-policy.js";
import { toInferenceRequest } from "../mappers/inference-request.js";
import {
  ChatCompletionRequestBody,
  ErrorEnvelopeBody,
  SimulateResponseBody,
} from "../openapi-schemas.js";
import type { ChatEnv } from "./chat-completions.js";

const errorResponse = (description: string) => ({
  description,
  content: { "application/json": { schema: ErrorEnvelopeBody } },
});

export const simulateRoute = createRoute({
  method: "post",
  path: "/v1/simulate",
  summary: "Dry-run the routing and privacy decision for a request; no provider is called",
  security: [{ bearerAuth: [] }],
  request: {
    body: {
      content: { "application/json": { schema: ChatCompletionRequestBody } },
      required: true,
    },
  },
  responses: {
    200: {
      description: "What the gateway would do with this request",
      content: { "application/json": { schema: SimulateResponseBody } },
    },
    400: errorResponse("The body fails the contract, is not JSON, or exceeds 1 MiB"),
    401: errorResponse("Missing or invalid API key"),
  },
});

export function toSimulateResponse(result: SimulationResult): SimulateResponse {
  const { inspection, decision } = result;
  const entities = inspection.status === "ok" ? inspection.entities : [];
  const common = {
    sensitivity: decision.sensitivity,
    detector: inspection.status === "ok" ? ("ok" as const) : inspection.reason,
    entities: entities.map((e) => ({
      messageIndex: e.messageIndex,
      kind: e.kind,
      start: e.start,
      end: e.end,
      score: e.score,
    })),
    ruleId: decision.ruleId,
    privacyAction: decision.privacyAction,
  };
  if (decision.kind === "block") {
    return {
      ...common,
      decision: "block",
      chain: [],
      allowedResidencies: [],
      blockReason: decision.reason,
    };
  }
  return {
    ...common,
    decision: "route",
    chain: decision.chain.map((t) => ({
      id: t.id,
      provider: t.provider,
      model: t.model,
      residency: t.residency,
    })),
    allowedResidencies: [...decision.allowedResidencies],
    ...(result.providerMessages === undefined
      ? {}
      : {
          providerMessages: result.providerMessages.map((m) => ({
            role: m.role,
            content: m.content,
          })),
        }),
    ...(result.noticeVersion === undefined ? {} : { notice: result.noticeVersion }),
  };
}

export function registerSimulate(app: OpenAPIHono<ChatEnv>, simulate: SimulatePolicy): void {
  app.openapi(simulateRoute, async (c) => {
    const body = c.req.valid("json");
    const request = toInferenceRequest(body, c.get("requestId"), c.get("clientId"));
    return c.json(toSimulateResponse(await simulate(request)), 200);
  });
}
