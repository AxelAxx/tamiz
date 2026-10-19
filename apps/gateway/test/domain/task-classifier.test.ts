import { describe, expect, it } from "vitest";
import { MESSAGE_ROLES, type Message } from "../../src/domain/model/inference-request.js";
import {
  CUES,
  classify,
  estimateTokens,
  SIZE_THRESHOLDS,
  TASK_SIZES,
  TASK_TYPES,
  TYPE_PRECEDENCE,
} from "../../src/domain/model/task-classifier.js";

// Spec 002 US4, FR-002, FR-008, research R-07, tasks.md T001.

function user(content: string): Message {
  return { role: "user", content };
}

function system(content: string): Message {
  return { role: "system", content };
}

function assistant(content: string): Message {
  return { role: "assistant", content };
}

describe("closed lists and constants", () => {
  it("declares the message roles of the contract", () => {
    expect(MESSAGE_ROLES).toEqual(["system", "user", "assistant"]);
  });

  it("declares the task types, sizes, thresholds and precedence of R-07", () => {
    expect(TASK_TYPES).toEqual(["chat", "summarize", "extract", "classify", "code", "translate"]);
    expect(TASK_SIZES).toEqual(["short", "medium", "long"]);
    expect(SIZE_THRESHOLDS).toEqual({ short: 512, medium: 4096 });
    expect(TYPE_PRECEDENCE).toEqual(["code", "translate", "extract", "classify", "summarize"]);
  });

  it("has a cue list for every type in the precedence and none for chat", () => {
    expect(Object.keys(CUES).sort()).toEqual([...TYPE_PRECEDENCE].sort());
  });
});

describe("task type", () => {
  it.each([
    // US4-1
    ["Resume este informe en tres frases", "summarize"],
    ["Summarize the following", "summarize"],
    // US4-2
    ["```ts\nconst a = 1;\n```", "code"],
    ["Can you fix this function?", "code"],
    ["Escribe una función en TypeScript que sume dos números", "code"],
    // US4-3
    ["Traduce al inglés: buenos días", "translate"],
    ["Translate into Spanish: good morning", "translate"],
    ["Extrae el nombre y la fecha", "extract"],
    ["Extract the invoice number as JSON", "extract"],
    ["Clasifica el sentimiento de esta reseña", "classify"],
    ["Which category does this belong to?", "classify"],
    // US4-4
    ["Hola, ¿qué tal estás?", "chat"],
    ["What a lovely day", "chat"],
  ] as const)("%j → %s", (content, expected) => {
    expect(classify([user(content)]).taskType).toBe(expected);
  });

  it("applies the documented precedence when cues of several types appear (US4-6)", () => {
    expect(classify([user("Please translate this code")]).taskType).toBe("code");
    expect(classify([user("Translate the summary into Spanish")]).taskType).toBe("translate");
    expect(classify([user("Extract the fields, then classify the sentiment")]).taskType).toBe(
      "extract",
    );
    expect(classify([user("Classify this and give me a summary")]).taskType).toBe("classify");
  });

  it("ignores accents and case", () => {
    expect(classify([user("TRADUCCIÓN, por favor")]).taskType).toBe("translate");
    expect(classify([user("traduccion por favor")]).taskType).toBe("translate");
    expect(classify([user("Pásalo al Español")]).taskType).toBe("translate");
  });

  it("matches whole words only", () => {
    // "classic" is not "class", "javascripts" is not "javascript", "summaryzer" is not "summary"
    expect(classify([user("A classic novel about summaryzers")]).taskType).toBe("chat");
  });

  it("ignores cues in earlier user turns and in assistant turns", () => {
    const messages = [
      user("Translate this into English"),
      assistant("Here is the translation and the code you asked for"),
      user("Thanks, how are you?"),
    ];
    expect(classify(messages).taskType).toBe("chat");
  });

  it("reads cues in system messages", () => {
    const messages = [system("You summarize documents for lawyers."), user("Here it is.")];
    expect(classify(messages).taskType).toBe("summarize");
  });

  it("classifies empty or whitespace-only content as chat and short", () => {
    expect(classify([user("")])).toEqual({
      taskType: "chat",
      size: "short",
      estimatedInputTokens: 0,
    });
    expect(classify([user("   \n\t ")])).toMatchObject({ taskType: "chat", size: "short" });
  });

  it("classifies a conversation without a user message by its system messages", () => {
    expect(classify([system("Translate everything into Spanish")]).taskType).toBe("translate");
    expect(classify([assistant("summary")]).taskType).toBe("chat");
  });
});

describe("task size (US4-5)", () => {
  it("estimates tokens as ceil(characters / 4)", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("a")).toBe(1);
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcde")).toBe(2);
  });

  it.each([
    [512, "short"],
    [513, "medium"],
    [4096, "medium"],
    [4097, "long"],
  ] as const)("%i estimated tokens → %s", (tokens, size) => {
    const result = classify([user("x".repeat(tokens * 4))]);
    expect(result.estimatedInputTokens).toBe(tokens);
    expect(result.size).toBe(size);
  });

  it("counts every message, including earlier turns and assistant turns", () => {
    const messages = [
      system("x".repeat(1000)),
      user("x".repeat(1000)),
      assistant("x".repeat(52)),
      user("hi"),
    ];
    // 2054 characters → 514 tokens
    expect(classify(messages)).toMatchObject({ estimatedInputTokens: 514, size: "medium" });
  });
});

describe("determinism (US4-6)", () => {
  it("returns identical results for the same messages", () => {
    const messages = [system("Be brief."), user("Summarize and translate this code")];
    expect(classify(messages)).toEqual(classify(messages));
  });

  it("does not mutate its input", () => {
    const messages = [user("Resume este informe")];
    const copy = structuredClone(messages);
    classify(messages);
    expect(messages).toEqual(copy);
  });
});
