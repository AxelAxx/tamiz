/**
 * The gateway as the evals see it: its public HTTP contract (spec 007 research R-01).
 *
 * Responses are parsed with `@tamiz/contracts`; anything else is a `ServiceError` whose type
 * is the failure class, never the response body.
 */
import {
  ChatCompletionResponseSchema,
  HealthResponseSchema,
  SimulateResponseSchema,
} from "@tamiz/contracts";
import type { z } from "zod";
import { ServiceError } from "../eval.js";

export type ChatMessage = {
  readonly role: "system" | "user" | "assistant";
  readonly content: string;
};
export type SimulateResponse = z.infer<typeof SimulateResponseSchema>;

export interface ChatAnswer {
  readonly text: string;
  /** The model that answered, as the gateway reports it. */
  readonly model: string;
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly costUsd?: number;
}

export interface GatewayClient {
  simulate(messages: ReadonlyArray<ChatMessage>, model?: string): Promise<SimulateResponse>;
  /** A real completion through the gateway (the quality eval's arms). */
  chat(messages: ReadonlyArray<ChatMessage>, model: string, maxTokens: number): Promise<ChatAnswer>;
  version(): Promise<string | undefined>;
}

export interface GatewayClientOptions {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly fetch: typeof fetch;
  readonly timeoutMs?: number;
}

export function createGatewayClient(options: GatewayClientOptions): GatewayClient {
  const timeoutMs = options.timeoutMs ?? 30_000;

  async function call<T>(path: string, schema: z.ZodType<T>, init: RequestInit): Promise<T> {
    let response: Response;
    try {
      response = await options.fetch(new URL(path, options.baseUrl), {
        ...init,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      const timedOut = error instanceof DOMException && error.name === "TimeoutError";
      throw new ServiceError("gateway", timedOut ? "timeout" : "unavailable");
    }
    if (!response.ok) throw new ServiceError("gateway", `http_${response.status}`);
    const body: unknown = await response.json().catch(() => undefined);
    const parsed = schema.safeParse(body);
    if (!parsed.success) throw new ServiceError("gateway", "contract");
    return parsed.data;
  }

  return {
    simulate: (messages, model = "tamiz-auto") =>
      call("/v1/simulate", SimulateResponseSchema, {
        method: "POST",
        headers: {
          authorization: `Bearer ${options.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ model, messages }),
      }),
    async chat(messages, model, maxTokens) {
      const body = await call("/v1/chat/completions", ChatCompletionResponseSchema, {
        method: "POST",
        headers: {
          authorization: `Bearer ${options.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ model, messages, max_tokens: maxTokens, temperature: 0 }),
      });
      const cost = body.usage.cost_usd;
      return {
        text: body.choices[0]?.message.content ?? "",
        model: body.model,
        promptTokens: body.usage.prompt_tokens,
        completionTokens: body.usage.completion_tokens,
        ...(cost === undefined ? {} : { costUsd: cost }),
      };
    },
    async version() {
      try {
        return (await call("/health", HealthResponseSchema, { method: "GET" })).version;
      } catch {
        return undefined;
      }
    },
  };
}
