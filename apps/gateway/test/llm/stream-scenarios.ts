import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import type {
  LlmProviderPort,
  ProviderCompletionInput,
  StartedStream,
  StreamPart,
} from "../../src/application/ports/llm-provider.port.js";
import type { ProviderError } from "../../src/domain/errors.js";
import type { ProviderName } from "../../src/domain/model/model-target.js";
import {
  millisecondsUnchecked,
  targetIdUnchecked,
  usdUnchecked,
} from "../../src/domain/model/units.js";
import type { Result } from "../../src/domain/result.js";
import { useMswServer } from "./msw.js";

// Spec 003 US6-1, US6-3 … US6-5, FR-024, FR-025, FR-028, research R-09 (tasks.md T042):
// the streaming scenarios every provider adapter must satisfy, over MSW
// `text/event-stream` bodies. Each provider supplies how its events are spelled.

export interface StreamUsage {
  readonly promptTokens: number;
  readonly completionTokens: number;
}

/** How one provider spells its server-sent events. */
export interface StreamDialect {
  /** Events for the given text pieces, a raw finish reason and optional usage. */
  readonly events: (pieces: ReadonlyArray<string>, finish: string, usage?: StreamUsage) => string[];
  /** Events for the given text pieces with no finish at all. */
  readonly withoutFinish: (pieces: ReadonlyArray<string>) => string[];
}

export interface StreamScenarioConfig {
  readonly provider: ProviderName;
  readonly url: string;
  readonly model: string;
  readonly createAdapter: () => LlmProviderPort;
  readonly dialect: StreamDialect;
  /** The raw finish reason that means a normal stop. */
  readonly stopReason: string;
  /** True when the API always reports usage, so the "no usage" scenario does not apply. */
  readonly usageAlways?: boolean;
}

const encoder = new TextEncoder();

/** A body that sends `events`, then closes, errors, or never ends. */
function body(events: ReadonlyArray<string>, ending: "close" | "error" | "hang"): ReadableStream {
  return new ReadableStream({
    start(controller) {
      for (const event of events) controller.enqueue(encoder.encode(event));
      if (ending === "close") controller.close();
      // Later, so the queued events are read first (`error` discards what is still queued).
      if (ending === "error") {
        setTimeout(() => controller.error(new TypeError("connection reset")), 20);
      }
    },
  });
}

function sse(events: ReadonlyArray<string>, ending: "close" | "error" | "hang" = "close") {
  return new HttpResponse(body(events, ending), {
    headers: { "content-type": "text/event-stream" },
  });
}

async function collect(stream: StartedStream): Promise<StreamPart[]> {
  const parts: StreamPart[] = [];
  for await (const part of stream.rest) parts.push(part);
  return parts;
}

export function describeStreamScenarios(config: StreamScenarioConfig): void {
  describe(`${config.provider} adapter streaming (US6)`, () => {
    const server = useMswServer();

    function input(timeoutMs = 5_000, signal?: AbortSignal): ProviderCompletionInput {
      return {
        target: {
          id: targetIdUnchecked("stream-target"),
          provider: config.provider,
          model: config.model,
          region: "test",
          residency: "local",
          pricing: { inputUsdPerMillion: usdUnchecked(0), outputUsdPerMillion: usdUnchecked(0) },
        },
        messages: [{ role: "user", content: "Say hello." }],
        timeoutMs: millisecondsUnchecked(timeoutMs),
        ...(signal === undefined ? {} : { signal }),
      };
    }

    function respond(make: (request: Request) => Response | Promise<Response>) {
      const seen = {
        calls: 0,
        signal: undefined as AbortSignal | undefined,
        body: undefined as unknown,
      };
      server.use(
        http.post(config.url, async ({ request }) => {
          seen.calls += 1;
          seen.signal = request.signal;
          seen.body = await request.clone().json();
          return make(request);
        }),
      );
      return seen;
    }

    function started(result: Result<StartedStream, ProviderError>): StartedStream {
      if (!result.ok) throw new Error(`expected a started stream, got ${result.error.cause}`);
      return result.value;
    }

    it("US6-1: resolves at the first token, then yields the deltas and one finish with usage", async () => {
      const seen = respond(() =>
        sse(
          config.dialect.events(["Hel", "lo", " world"], config.stopReason, {
            promptTokens: 12,
            completionTokens: 3,
          }),
        ),
      );

      const stream = started(await config.createAdapter().stream(input()));
      const parts = await collect(stream);

      expect(stream.first).toBe("Hel");
      expect(stream.modelName).toBe(config.model);
      expect(parts).toEqual([
        { type: "delta", text: "lo" },
        { type: "delta", text: " world" },
        { type: "finish", finishReason: "stop", usage: { promptTokens: 12, completionTokens: 3 } },
      ]);
      expect(seen.body).toMatchObject({ stream: true });
    });

    it("US6-3: a failure before the first token is a ProviderError from stream(), with the status", async () => {
      respond(() => HttpResponse.json({ error: { message: "overloaded" } }, { status: 503 }));

      const result = await config.createAdapter().stream(input());

      expect(result).toEqual({
        ok: false,
        error: expect.objectContaining({ cause: "http_error", retryable: true, status: 503 }),
      });
    });

    it("reads an upstream retry-after header into retryAfterMs (FR-004)", async () => {
      respond(() =>
        HttpResponse.json(
          { error: { message: "slow down" } },
          { status: 429, headers: { "retry-after": "2" } },
        ),
      );

      const result = await config.createAdapter().stream(input());

      expect(result.ok || result.error).toMatchObject({
        cause: "rate_limited",
        retryAfterMs: 2_000,
      });
    });

    it("US6-4: a failure after the first tokens ends the stream with one error part", async () => {
      respond(() => sse(config.dialect.withoutFinish(["Hel", "lo"]), "error"));

      const stream = started(await config.createAdapter().stream(input()));
      const parts = await collect(stream);

      expect(stream.first).toBe("Hel");
      expect(parts.filter((part) => part.type === "finish")).toEqual([]);
      expect(parts.at(-1)).toMatchObject({ type: "error", error: { kind: "provider" } });
      expect(parts.filter((part) => part.type === "error")).toHaveLength(1);
    });

    it("US6-5: no first token within the timeout → timeout, and the connection is aborted", async () => {
      const seen = respond(() => sse([], "hang"));
      const started_ = Date.now();

      const result = await config.createAdapter().stream(input(200));

      expect(result.ok || result.error).toMatchObject({ cause: "timeout", retryable: true });
      expect(Date.now() - started_).toBeLessThan(1_000);
      expect(seen.signal?.aborted).toBe(true);
    });

    it("US6-5: a gap between chunks longer than the timeout → an error part with timeout", async () => {
      respond(() => sse(config.dialect.withoutFinish(["Hel", "lo"]), "hang"));

      const stream = started(await config.createAdapter().stream(input(200)));
      const parts = await collect(stream);

      expect(parts.at(-1)).toMatchObject({ type: "error", error: { cause: "timeout" } });
    });

    it("a stream that ends without a finish reason is a malformed_response error part (edge case)", async () => {
      respond(() => sse(config.dialect.withoutFinish(["Hel", "lo"]), "close"));

      const stream = started(await config.createAdapter().stream(input()));
      const parts = await collect(stream);

      expect(parts.at(-1)).toMatchObject({ type: "error", error: { cause: "malformed_response" } });
    });

    it.skipIf(config.usageAlways === true)(
      "a finish without usage yields a finish part without usage",
      async () => {
        respond(() => sse(config.dialect.events(["Hi"], config.stopReason)));

        const parts = await collect(started(await config.createAdapter().stream(input())));

        expect(parts).toEqual([{ type: "finish", finishReason: "stop" }]);
      },
    );

    it("US6-6: a consumer that stops reading early cancels the upstream call", async () => {
      const seen = respond(() =>
        sse(config.dialect.withoutFinish(["Hel", "lo", " world"]), "hang"),
      );

      const stream = started(await config.createAdapter().stream(input()));
      for await (const _part of stream.rest) break;

      expect(seen.signal?.aborted).toBe(true);
    });

    it("an answer without any text still finishes (first is empty)", async () => {
      respond(() =>
        sse(config.dialect.events([], config.stopReason, { promptTokens: 3, completionTokens: 0 })),
      );

      const stream = started(await config.createAdapter().stream(input()));

      expect(stream.first).toBe("");
      expect(await collect(stream)).toEqual([
        { type: "finish", finishReason: "stop", usage: { promptTokens: 3, completionTokens: 0 } },
      ]);
    });

    it("an aborted request signal before the first token → aborted, not retryable", async () => {
      respond(() => sse([], "hang"));
      const controller = new AbortController();

      const pending = config.createAdapter().stream(input(5_000, controller.signal));
      setTimeout(() => controller.abort(), 50);
      const result = await pending;

      expect(result.ok || result.error).toMatchObject({ cause: "aborted", retryable: false });
    });
  });
}

/** The OpenAI chat-completion chunk dialect, shared by OpenAI, Mistral and Ollama. */
export function openAiDialect(model: string): StreamDialect {
  const chunk = (choices: unknown[], extra: Record<string, unknown> = {}) =>
    `data: ${JSON.stringify({ id: "chatcmpl-stream", object: "chat.completion.chunk", created: 1_793_350_800, model, choices, ...extra })}\n\n`;
  const deltas = (pieces: ReadonlyArray<string>) =>
    pieces.map((text, index) =>
      chunk([
        {
          index: 0,
          delta: index === 0 ? { role: "assistant", content: text } : { content: text },
          finish_reason: null,
        },
      ]),
    );
  return {
    events: (pieces, finish, usage) => [
      ...deltas(pieces),
      chunk(
        [{ index: 0, delta: {}, finish_reason: finish }],
        usage === undefined
          ? {}
          : {
              usage: {
                prompt_tokens: usage.promptTokens,
                completion_tokens: usage.completionTokens,
                total_tokens: usage.promptTokens + usage.completionTokens,
              },
            },
      ),
      "data: [DONE]\n\n",
    ],
    withoutFinish: deltas,
  };
}

/** Anthropic's Messages API event dialect. */
export function anthropicDialect(model: string): StreamDialect {
  const event = (name: string, data: Record<string, unknown>) =>
    `event: ${name}\ndata: ${JSON.stringify({ type: name, ...data })}\n\n`;
  const start = (inputTokens: number) => [
    event("message_start", {
      message: {
        id: "msg_stream",
        type: "message",
        role: "assistant",
        model,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: inputTokens, output_tokens: 1 },
      },
    }),
    event("content_block_start", { index: 0, content_block: { type: "text", text: "" } }),
  ];
  const deltas = (pieces: ReadonlyArray<string>) =>
    pieces.map((text) =>
      event("content_block_delta", { index: 0, delta: { type: "text_delta", text } }),
    );
  return {
    events: (pieces, finish, usage) => [
      ...start(usage?.promptTokens ?? 0),
      ...deltas(pieces),
      event("content_block_stop", { index: 0 }),
      event("message_delta", {
        delta: { stop_reason: finish, stop_sequence: null },
        usage: { output_tokens: usage?.completionTokens ?? 0 },
      }),
      event("message_stop", {}),
    ],
    withoutFinish: (pieces) => [...start(0), ...deltas(pieces)],
  };
}
