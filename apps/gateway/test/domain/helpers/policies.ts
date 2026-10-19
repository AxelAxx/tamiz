import type {
  RoutingPolicy,
  RoutingPolicyInput,
} from "../../../src/domain/model/routing-policy.js";
import { validatePolicy } from "../../../src/domain/model/routing-policy.js";

/**
 * The policy of `specs/002-provider-routing/contracts/policy.example.yaml` as a plain
 * object, the shape the file loader hands to `validatePolicy` (T-002-05).
 */
export function examplePolicyInput(): RoutingPolicyInput {
  return {
    id: "default",
    version: 1,
    defaultTimeoutMs: 30_000,
    targets: [
      {
        id: "ollama-llama",
        provider: "ollama",
        model: "llama3.1:8b",
        region: "local",
        residency: "local",
        pricing: { inputUsdPerMillion: 0, outputUsdPerMillion: 0 },
        timeoutMs: 60_000,
      },
      {
        id: "mistral-small",
        provider: "mistral",
        model: "mistral-small-latest",
        region: "eu-west",
        residency: "eu",
        pricing: { inputUsdPerMillion: 0.1, outputUsdPerMillion: 0.3 },
      },
      {
        id: "openai-mini",
        provider: "openai",
        model: "gpt-4o-mini",
        region: "us-east",
        residency: "us",
        pricing: { inputUsdPerMillion: 0.15, outputUsdPerMillion: 0.6 },
      },
      {
        id: "anthropic-sonnet",
        provider: "anthropic",
        model: "claude-sonnet-4-5",
        region: "us-east",
        residency: "us",
        pricing: { inputUsdPerMillion: 3, outputUsdPerMillion: 15 },
        timeoutMs: 45_000,
      },
    ],
    rules: [
      { id: "pinned-local", when: { requestedModel: ["tamiz-local"] }, route: ["ollama-llama"] },
      {
        id: "code-to-frontier",
        when: { taskType: ["code"] },
        route: ["anthropic-sonnet", "openai-mini", "mistral-small"],
      },
      {
        id: "long-documents-eu",
        when: { taskType: ["summarize", "extract"], size: ["long"] },
        route: ["mistral-small", "openai-mini"],
      },
      {
        id: "cheap-short-tasks",
        when: {
          taskType: ["classify", "translate", "extract", "summarize"],
          size: ["short", "medium"],
        },
        route: ["openai-mini", "mistral-small", "ollama-llama"],
        orderBy: "cost",
        timeoutMs: 20_000,
      },
    ],
    default: { route: ["mistral-small", "openai-mini", "ollama-llama"] },
  };
}

/** Validates a policy input and fails the test if it is rejected. */
export function validPolicy(input: RoutingPolicyInput): RoutingPolicy {
  const result = validatePolicy(input);
  if (!result.ok) {
    throw new Error(`expected a valid policy: ${JSON.stringify(result.error.issues)}`);
  }
  return result.value;
}
