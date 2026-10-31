/**
 * The Tamiz gateway as the agent's model (spec 009 FR-014, research R-09): an
 * OpenAI-compatible provider pointed at `<gateway>/v1`, with the agent's own client key.
 * The agent holds no provider key; routing, privacy, retries and fallbacks are the
 * gateway's, so every model call is a normal, audited gateway request.
 */
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";

export interface GatewayModelOptions {
  gatewayUrl: string;
  apiKey: string;
  /** The requested model; `tamiz-local` matches the default policy's `pinned-local` rule. */
  model: string;
  fetch?: typeof fetch;
}

export interface GatewayModel {
  /** The requested model name, as the run record shows it. */
  id: string;
  model: LanguageModel;
}

export const DEFAULT_AGENT_MODEL = "tamiz-local";

export function createGatewayModel(options: GatewayModelOptions): GatewayModel {
  const provider = createOpenAICompatible({
    name: "tamiz",
    baseURL: `${options.gatewayUrl.replace(/\/+$/, "")}/v1`,
    apiKey: options.apiKey,
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
  });
  return { id: options.model, model: provider.chatModel(options.model) };
}
