import {
  createFakeClock,
  createInMemoryPolicyRepository,
  createScriptedPort,
} from "@tamiz/test-utils";
import { describe, expect, it } from "vitest";
import type {
  ProviderCompletion,
  ProviderCompletionInput,
} from "../../src/application/ports/llm-provider.port.js";
import type { ProviderRegistry } from "../../src/application/provider-registry.js";
import { classifyTask } from "../../src/application/use-cases/classify-task.js";
import { routeInference } from "../../src/application/use-cases/route-inference.js";
import { type ProviderError, providerError } from "../../src/domain/errors.js";
import type { InferenceRequest } from "../../src/domain/model/inference-request.js";
import type { ProviderName } from "../../src/domain/model/model-target.js";
import { decide } from "../../src/domain/model/routing-decision.js";
import type { RoutingPolicy } from "../../src/domain/model/routing-policy.js";
import {
  clientIdUnchecked,
  requestIdUnchecked,
  targetIdUnchecked,
} from "../../src/domain/model/units.js";
import { err, ok, type Result } from "../../src/domain/result.js";
import { createInMemoryCircuitState } from "../../src/infrastructure/cache/in-memory-circuit-state.js";
import { examplePolicyInput, validPolicy } from "../domain/helpers/policies.js";
import { recordingEvents } from "../resilience/helpers.js";

// Spec 002 FR-012, US6-6 (tasks.md T016) and spec 003 US1-5, FR-011 (tasks.md T026):
// the use case runs the decided chain through `executeChain`. Fakes only: no network,
// no real clock (failure paths are driven with `clock.drive`). The policy is the 002
// `contracts/policy.example.yaml`.

type CompletionResult = Result<ProviderCompletion, ProviderError>;

const START = new Date("2026-05-06T07:08:09.000Z");

const COMPLETION: ProviderCompletion = {
  text: "Hola.",
  finishReason: "stop",
  usage: { promptTokens: 12, completionTokens: 3 },
  modelName: "mistral-small-2409",
};

function request(content: string, overrides: Partial<InferenceRequest> = {}): InferenceRequest {
  return {
    requestId: requestIdUnchecked("req-1"),
    clientId: clientIdUnchecked("client-a"),
    requestedModel: "gpt-4o-mini",
    messages: [{ role: "user", content }],
    ...overrides,
  };
}

/** Wires the use case to fakes; the provider script may advance the clock. */
function setup(
  script: (
    input: ProviderCompletionInput,
    call: number,
  ) => CompletionResult | Promise<CompletionResult> = () => ok(COMPLETION),
  policy: RoutingPolicy = validPolicy(examplePolicyInput()),
) {
  const clock = createFakeClock(START);
  const provider = createScriptedPort(script);
  const resolved: ProviderName[] = [];
  const providers: ProviderRegistry = {
    resolve: (name) => {
      resolved.push(name);
      return { complete: provider.fn };
    },
  };
  const policies = createInMemoryPolicyRepository(policy);
  const events = recordingEvents();
  const route = routeInference({
    policies,
    providers,
    clock,
    circuitState: createInMemoryCircuitState(clock),
    events,
    random: () => 0.5,
  });
  return { route, clock, provider, resolved, policies, policy, events };
}

describe("routeInference", () => {
  it("returns the decision, the first target, the completion and createdAt from the clock", async () => {
    const { route, clock, provider } = setup((input) => {
      clock.advance(250);
      return ok({ ...COMPLETION, modelName: input.target.model });
    });

    const result = await route(request("Hola, ¿qué tal?"));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { decision, target, completion, createdAt } = result.value;
    expect(decision.ruleId).toBe("default");
    expect(target.id).toBe("mistral-small");
    expect(target).toBe(decision.chain[0]);
    expect(completion).toEqual({ ...COMPLETION, modelName: "mistral-small-latest" });
    // FR-034: reported usage is used as is, and priced with the target (FR-033).
    expect(result.value.usage).toEqual({ promptTokens: 12, completionTokens: 3, estimated: false });
    const { inputUsdPerMillion, outputUsdPerMillion } = target.pricing;
    expect(result.value.cost).toBeCloseTo(
      (12 * inputUsdPerMillion + 3 * outputUsdPerMillion) / 1e6,
      12,
    );
    // Read after the provider call: the clock moved inside the call.
    expect(createdAt.toISOString()).toBe("2026-05-06T07:08:09.250Z");
    expect(provider.calls).toHaveLength(1);
  });

  it("US7-4: estimates usage from the messages and the text when the provider reports none", async () => {
    const { route } = setup(() =>
      ok({ text: "Una respuesta de treinta y dos c.", finishReason: "stop", modelName: "m" }),
    );
    const system = "Eres conciso.";
    const user = "Hola, ¿qué tal estás hoy?";

    const result = await route({
      ...request(user),
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The classifier's estimator: one token per four characters, over all messages.
    const promptTokens = Math.ceil((system.length + user.length) / 4);
    const completionTokens = Math.ceil("Una respuesta de treinta y dos c.".length / 4);
    expect(result.value.usage).toEqual({ promptTokens, completionTokens, estimated: true });
    const { inputUsdPerMillion, outputUsdPerMillion } = result.value.target.pricing;
    expect(result.value.cost).toBeCloseTo(
      (promptTokens * inputUsdPerMillion + completionTokens * outputUsdPerMillion) / 1e6,
      12,
    );
  });

  it("decides with exactly what classifyTask produced (FR-011, FR-012)", async () => {
    const { route, policy } = setup();
    const input = request("Classify this ticket: billing or support?");

    const result = await route(input);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.decision).toEqual(decide(policy, classifyTask(input)));
    expect(result.value.decision.sensitivity).toBe("unknown");
  });

  it("uses the active policy at call time", async () => {
    const { route, policies } = setup();
    const next = validPolicy({ ...examplePolicyInput(), version: 2 });
    policies.set(next);

    const result = await route(request("Hola"));

    expect(result.ok && result.value.decision.policyVersion).toBe(2);
  });

  it("resolves the adapter by the target's provider and forwards messages and sampling", async () => {
    const { route, provider, resolved } = setup();
    const input = request("Hola", { temperature: 0.3, maxTokens: 64 });

    await route(input);

    expect(resolved).toEqual(["mistral"]);
    const [call] = provider.calls;
    expect(call?.target.id).toBe("mistral-small");
    expect(call?.messages).toBe(input.messages);
    expect(call?.temperature).toBe(0.3);
    expect(call?.maxTokens).toBe(64);
  });

  it("does not forward absent sampling parameters", async () => {
    const { route, provider } = setup();

    await route(request("Hola"));

    const [call] = provider.calls;
    expect(call !== undefined && "temperature" in call).toBe(false);
    expect(call !== undefined && "maxTokens" in call).toBe(false);
  });

  describe("US6-6: effective timeout", () => {
    it("the matched rule's timeout wins over the target's and the policy default", async () => {
      const { route, provider } = setup();

      // `cheap-short-tasks` sets 20 000 ms; cost order puts `ollama-llama` (60 000 ms) first.
      const result = await route(request("Classify this ticket: billing or support?"));

      expect(result.ok && result.value.decision.ruleId).toBe("cheap-short-tasks");
      expect(provider.calls[0]?.target.id).toBe("ollama-llama");
      expect(provider.calls[0]?.timeoutMs).toBe(20_000);
    });

    it("without a rule timeout, the target's timeout bounds the call", async () => {
      const { route, provider } = setup();

      // `code-to-frontier` sets no timeout; `anthropic-sonnet` sets 45 000 ms.
      await route(request("Fix this code:\n```ts\nconst x = 1\n```"));

      expect(provider.calls[0]?.target.id).toBe("anthropic-sonnet");
      expect(provider.calls[0]?.timeoutMs).toBe(45_000);
    });

    it("without rule or target timeout, the policy default applies", async () => {
      const { route, provider } = setup();

      // No rule matches a chat request; the default chain starts with `mistral-small`.
      await route(request("Hola, ¿qué tal?"));

      expect(provider.calls[0]?.target.id).toBe("mistral-small");
      expect(provider.calls[0]?.timeoutMs).toBe(30_000);
    });
  });

  describe("provider failure", () => {
    const failure = providerError({
      targetId: targetIdUnchecked("anthropic-sonnet"),
      provider: "anthropic",
      cause: "http_error",
      retryable: true,
      message: "Upstream returned 503",
      status: 503,
    });

    it("returns RoutingFailure { decision, failure } without throwing when every target fails", async () => {
      const { route, clock } = setup(() => err(failure));

      const result = await clock.drive(route(request("Fix this code:\n```ts\nconst x = 1\n```")));

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.decision.ruleId).toBe("code-to-frontier");
      expect(result.error.failure).toMatchObject({
        kind: "exhausted",
        error: failure,
        abandoned: [
          { targetId: "anthropic-sonnet", reason: "http_error" },
          { targetId: "openai-mini", reason: "http_error" },
        ],
      });
      expect(result.error.failure.target.id).toBe("mistral-small");
    });

    it("spec 003: walks the whole chain, with retries, instead of stopping at chain[0]", async () => {
      const { route, clock, provider, resolved } = setup(() => err(failure));

      await clock.drive(route(request("Fix this code:\n```ts\nconst x = 1\n```")));

      expect(provider.calls.map((call) => call.target.id)).toEqual([
        "anthropic-sonnet",
        "anthropic-sonnet",
        "openai-mini",
        "openai-mini",
        "mistral-small",
        "mistral-small",
      ]);
      expect(resolved).toEqual([
        "anthropic",
        "anthropic",
        "openai",
        "openai",
        "mistral",
        "mistral",
      ]);
    });

    it("US1-5: on fallback, target, usage, cost and model are the answering target's", async () => {
      const { route, clock } = setup((input) =>
        input.target.id === "anthropic-sonnet"
          ? err(failure)
          : ok({ ...COMPLETION, modelName: `${input.target.model}-served` }),
      );

      const result = await clock.drive(route(request("Fix this code:\n```ts\nconst x = 1\n```")));

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.target.id).toBe("openai-mini");
      expect(result.value.completion.modelName).toBe("gpt-4o-mini-served");
      expect(result.value.abandoned).toEqual([
        { targetId: "anthropic-sonnet", reason: "http_error" },
      ]);
      // openai-mini: 0.15 / 0.6 USD per million tokens.
      expect(result.value.cost).toBeCloseTo((12 * 0.15 + 3 * 0.6) / 1e6, 12);
      expect(result.value.usage).toEqual({
        promptTokens: 12,
        completionTokens: 3,
        estimated: false,
      });
    });
  });

  it("throws on an unvalidated policy whose decision has an empty chain", async () => {
    const valid = validPolicy(examplePolicyInput());
    const broken: RoutingPolicy = { ...valid, rules: [], default: { route: [] } };
    const { route, provider } = setup(undefined, broken);

    await expect(route(request("Hola"))).rejects.toThrow(/empty chain/);
    expect(provider.calls).toHaveLength(0);
  });
});
