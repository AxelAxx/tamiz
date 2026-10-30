import { createFakeClock, createInMemoryPolicyRepository } from "@tamiz/test-utils";
import { describe, expect, it } from "vitest";
import type {
  LlmProviderPort,
  ProviderCompletionInput,
  StartedStream,
  StreamPart,
} from "../../src/application/ports/llm-provider.port.js";
import {
  type RoutedStreamPart,
  streamInference,
} from "../../src/application/use-cases/stream-inference.js";
import type { ProviderError } from "../../src/domain/errors.js";
import type { InferenceRequest } from "../../src/domain/model/inference-request.js";
import {
  clientIdUnchecked,
  requestIdUnchecked,
  targetIdUnchecked,
} from "../../src/domain/model/units.js";
import { err, ok, type Result } from "../../src/domain/result.js";
import { createInMemoryCircuitState } from "../../src/infrastructure/cache/in-memory-circuit-state.js";
import { examplePolicyInput, validPolicy } from "../domain/helpers/policies.js";
import { failure, recordingEvents } from "../resilience/helpers.js";

// Spec 003 US6-3, US6-4, US6-6, US6-7, FR-023, FR-024, FR-026, FR-027 (tasks.md T043):
// the streaming use case on the same chain executor; fallback only before the first
// token. The policy is the 002 example; a chat request routes to the default chain
// mistral-small → openai-mini → ollama-llama.

const START = new Date("2026-05-06T07:08:09.000Z");

function request(content = "Hola, ¿qué tal?"): InferenceRequest {
  return {
    requestId: requestIdUnchecked("req-stream"),
    clientId: clientIdUnchecked("client-a"),
    requestedModel: "tamiz-auto",
    messages: [{ role: "user", content }],
  };
}

async function* parts(...items: StreamPart[]): AsyncGenerator<StreamPart> {
  for (const item of items) yield item;
}

type StreamScript = (
  input: ProviderCompletionInput,
) => Promise<Result<StartedStream, ProviderError>>;

function setup(script: StreamScript) {
  const clock = createFakeClock(START);
  const events = recordingEvents();
  const circuitState = createInMemoryCircuitState(clock);
  const calls: ProviderCompletionInput[] = [];
  const provider: LlmProviderPort = {
    complete: () => Promise.reject(new Error("complete must not be called")),
    stream: (input) => {
      calls.push(input);
      return script(input);
    },
  };
  const stream = streamInference({
    policies: createInMemoryPolicyRepository(validPolicy(examplePolicyInput())),
    providers: { resolve: () => provider },
    clock,
    circuitState,
    events,
    random: () => 0.5,
  });
  return { stream, clock, events, calls, circuitState };
}

async function collect(stream: AsyncIterable<RoutedStreamPart>): Promise<RoutedStreamPart[]> {
  const out: RoutedStreamPart[] = [];
  for await (const part of stream) out.push(part);
  return out;
}

const started = (first: string, ...rest: StreamPart[]) =>
  ok({ first, modelName: "model-from-target", rest: parts(...rest) });

describe("streamInference", () => {
  it("streams the first target's answer and prices the finish (US6-1 at the use-case level)", async () => {
    const { stream, clock } = setup(async () =>
      started(
        "Hola",
        { type: "delta", text: ", ¿qué tal?" },
        {
          type: "finish",
          finishReason: "stop",
          usage: { promptTokens: 12, completionTokens: 3 },
        },
      ),
    );

    const result = await clock.drive(stream(request()));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.target.id).toBe("mistral-small");
    expect(result.value.first).toBe("Hola");
    expect(result.value.abandoned).toEqual([]);
    expect(await collect(result.value.parts)).toEqual([
      { type: "delta", text: ", ¿qué tal?" },
      {
        type: "finish",
        finishReason: "stop",
        usage: { promptTokens: 12, completionTokens: 3, estimated: false },
        cost: expect.closeTo((12 * 0.1 + 3 * 0.3) / 1e6, 12),
      },
    ]);
  });

  it("US6-3: a failure before the first token falls back like a completion", async () => {
    const { stream, clock, calls } = setup(async (input) =>
      input.target.id === "mistral-small"
        ? err(failure("http_error", { status: 503, on: input.target }))
        : started("Hi", { type: "finish", finishReason: "stop" }),
    );

    const result = await clock.drive(stream(request()));

    expect(result.ok && result.value.target.id).toBe("openai-mini");
    expect(result.ok && result.value.abandoned).toEqual([
      { targetId: "mistral-small", reason: "http_error" },
    ]);
    expect(calls.map((call) => call.target.id)).toEqual([
      "mistral-small",
      "mistral-small",
      "openai-mini",
    ]);
  });

  it("US6-4: an error after the first token is surfaced, not fallen back, and counted by the breaker", async () => {
    const midStream = failure("network", { on: { ...examplePolicyTarget("mistral-small") } });
    const { stream, clock, calls, events, circuitState } = setup(async () =>
      started("Hola", { type: "delta", text: " a" }, { type: "error", error: midStream }),
    );

    const result = await clock.drive(stream(request()));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const out = await collect(result.value.parts);

    expect(out).toEqual([
      { type: "delta", text: " a" },
      { type: "error", error: midStream },
    ]);
    expect(calls).toHaveLength(1);
    expect((await circuitState.snapshot(targetIdUnchecked("mistral-small"))).failures).toBe(1);
    expect(events.events.filter((event) => event.type === "stream.failed")).toEqual([
      expect.objectContaining({ targetId: "mistral-small", reason: "network" }),
    ]);
  });

  it("US6-7: every target failing before a token returns a RoutingFailure", async () => {
    const { stream, clock } = setup(async (input) => err(failure("timeout", { on: input.target })));

    const result = await clock.drive(stream(request()));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.failure).toMatchObject({ kind: "exhausted", error: { cause: "timeout" } });
  });

  it("estimates usage from the streamed text when the finish has none, and prices it", async () => {
    const { stream, clock } = setup(async () =>
      started("abcd", { type: "delta", text: "efgh" }, { type: "finish", finishReason: "length" }),
    );

    const result = await clock.drive(stream(request("Hola, ¿qué tal?")));
    if (!result.ok) throw new Error("expected a stream");
    const finish = (await collect(result.value.parts)).at(-1);

    // 15 characters of prompt → 4 tokens; "abcdefgh" → 2 tokens.
    expect(finish).toMatchObject({
      type: "finish",
      finishReason: "length",
      usage: { promptTokens: 4, completionTokens: 2, estimated: true },
    });
  });

  it("US6-6: the client's signal reaches the provider and an abort is not counted", async () => {
    const controller = new AbortController();
    let providerSignal: AbortSignal | undefined;
    const aborted = failure("aborted");
    const { stream, clock, circuitState, events } = setup(async (input) => {
      providerSignal = input.signal;
      return started("Hola", { type: "error", error: aborted });
    });

    const result = await clock.drive(stream(request(), controller.signal));
    controller.abort();
    if (!result.ok) throw new Error("expected a stream");
    await collect(result.value.parts);

    expect(providerSignal?.aborted).toBe(true);
    expect((await circuitState.snapshot(targetIdUnchecked("mistral-small"))).failures).toBe(0);
    expect(events.events.filter((event) => event.type === "stream.failed")).toEqual([]);
  });
});

function examplePolicyTarget(id: string) {
  const target = validPolicy(examplePolicyInput()).targets.find((candidate) => candidate.id === id);
  if (target === undefined) throw new Error(`no target ${id}`);
  return target;
}
