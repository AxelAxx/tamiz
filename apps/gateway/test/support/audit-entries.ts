import type { AuditEntry } from "../../src/domain/model/audit-entry.js";

/** A valid, content-free audit entry for query tests; `n` makes id and time unique. */
export function sampleEntry(n: number, overrides: Partial<AuditEntry> = {}): AuditEntry {
  const started = new Date(Date.UTC(2026, 9, 1) + n * 60_000);
  return {
    id: `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`,
    requestId: `req-${n}`,
    clientId: "demo",
    startedAt: started.toISOString(),
    endedAt: new Date(started.getTime() + 500).toISOString(),
    latencyMs: 500,
    requestHash: "c".repeat(64),
    policyId: "default",
    policyVersion: 3,
    ruleId: n % 2 === 0 ? "default" : "code-to-frontier",
    taskType: "chat",
    size: "short",
    sensitivity: n % 3 === 0 ? "critical" : "none",
    entities: n % 3 === 0 ? { DNI: 1 } : {},
    privacyAction: n % 3 === 0 ? "restrict_to_local" : "allow",
    outcome: "answered",
    streamed: false,
    target:
      n % 3 === 0
        ? { id: "ollama-llama", provider: "ollama", model: "llama3.1:8b", residency: "local" }
        : {
            id: "mistral-small",
            provider: "mistral",
            model: "mistral-small-latest",
            residency: "eu",
          },
    abandoned: [],
    usage: { inputTokens: 40, outputTokens: 10, estimated: false },
    costUsd: n % 3 === 0 ? 0 : 0.000007,
    baselineCostUsd: 0.00027,
    baselineTargetId: "anthropic-sonnet",
    ...overrides,
  };
}
