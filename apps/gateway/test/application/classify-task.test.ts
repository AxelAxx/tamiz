import { describe, expect, it } from "vitest";
import { classifyTask } from "../../src/application/use-cases/classify-task.js";
import type { InferenceRequest } from "../../src/domain/model/inference-request.js";
import { NOT_INSPECTED } from "../../src/domain/model/sensitivity.js";
import { classify } from "../../src/domain/model/task-classifier.js";
import { clientIdUnchecked, requestIdUnchecked } from "../../src/domain/model/units.js";

// Spec 002 FR-011 (tasks.md T022): the use case wraps the domain classifier. The cue and
// size rules themselves are covered by `test/domain/task-classifier.test.ts`.

function request(overrides: Partial<InferenceRequest> = {}): InferenceRequest {
  return {
    requestId: requestIdUnchecked("req-1"),
    clientId: clientIdUnchecked("client-a"),
    requestedModel: "gpt-4o-mini",
    messages: [{ role: "user", content: "Resume este documento, por favor." }],
    ...overrides,
  };
}

describe("classifyTask", () => {
  it("adds the domain classification to the request", () => {
    const input = request();

    const classified = classifyTask(input);

    expect(classified).toMatchObject(classify(input.messages));
    expect(classified.taskType).toBe("summarize");
    expect(classified.size).toBe("short");
  });

  it("uses NOT_INSPECTED (level `none`) until the gateway inspects the request (spec 005 T009)", () => {
    expect(classifyTask(request()).inspection).toEqual(NOT_INSPECTED);
  });

  it("keeps every request field, including the optional sampling parameters", () => {
    const input = request({ temperature: 0.2, maxTokens: 128 });

    const classified = classifyTask(input);

    expect(classified).toMatchObject(input);
    expect(classified.messages).toBe(input.messages);
  });

  it("does not add absent optional fields", () => {
    const classified = classifyTask(request());

    expect("temperature" in classified).toBe(false);
    expect("maxTokens" in classified).toBe(false);
  });

  it("classifies code requests from a fenced block", () => {
    const classified = classifyTask(
      request({ messages: [{ role: "user", content: "Why?\n```ts\nconst x = 1;\n```" }] }),
    );

    expect(classified.taskType).toBe("code");
  });
});
