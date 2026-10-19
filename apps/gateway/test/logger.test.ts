import { describe, expect, it } from "vitest";
import { createLogger, REDACTED } from "../src/infrastructure/logging/logger.js";

// Spec 001, US5 scenarios 1-3 (FR-016): the project logger redacts prompt content and
// credentials by key name and emits one JSON object per line.

interface SensitiveFields {
  readonly prompt?: unknown;
  readonly messages?: unknown;
  readonly authorization?: unknown;
}

interface CapturedLine extends SensitiveFields {
  readonly level?: unknown;
  readonly time?: unknown;
  readonly msg?: unknown;
  readonly service?: unknown;
  readonly model?: unknown;
  readonly req?: {
    readonly method?: unknown;
    readonly headers?: SensitiveFields & { host?: unknown };
  };
  readonly body?: SensitiveFields & { readonly model?: unknown };
  readonly anything?: SensitiveFields;
}

function captureLogger(level: "info" | "debug" = "info") {
  const chunks: string[] = [];
  const destination = {
    write(chunk: string): void {
      chunks.push(chunk);
    },
  };
  const logger = createLogger({ level, destination });
  const lines = (): CapturedLine[] =>
    chunks
      .join("")
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as CapturedLine);
  return { logger, lines, raw: () => chunks.join("") };
}

describe("createLogger redaction", () => {
  it("US5-1: redacts prompt, messages and authorization at the top level", () => {
    const { logger, lines, raw } = captureLogger();
    logger.info(
      {
        prompt: "my secret prompt",
        messages: [{ role: "user", content: "hola" }],
        authorization: "Bearer token",
        model: "gpt-x",
      },
      "inference",
    );
    const [line] = lines();
    expect(line?.prompt).toBe(REDACTED);
    expect(line?.messages).toBe(REDACTED);
    expect(line?.authorization).toBe(REDACTED);
    expect(line?.model).toBe("gpt-x");
    expect(raw()).not.toContain("my secret prompt");
    expect(raw()).not.toContain("hola");
    expect(raw()).not.toContain("Bearer token");
  });

  it("US5-2: redacts authorization under req.headers and prompt / messages under body", () => {
    const { logger, lines, raw } = captureLogger();
    logger.info(
      {
        req: { method: "POST", headers: { authorization: "Bearer nested", host: "x" } },
        body: { prompt: "nested prompt", messages: [{ content: "nested msg" }], model: "m" },
      },
      "request",
    );
    const [line] = lines();
    expect(line?.req?.headers?.authorization).toBe(REDACTED);
    expect(line?.req?.headers?.host).toBe("x");
    expect(line?.req?.method).toBe("POST");
    expect(line?.body?.prompt).toBe(REDACTED);
    expect(line?.body?.messages).toBe(REDACTED);
    expect(line?.body?.model).toBe("m");
    expect(raw()).not.toContain("Bearer nested");
    expect(raw()).not.toContain("nested prompt");
    expect(raw()).not.toContain("nested msg");
  });

  it("redacts the sensitive keys one level deep under any key", () => {
    const { logger, lines, raw } = captureLogger();
    logger.info(
      {
        anything: { prompt: "deep prompt", messages: ["m"], authorization: "Basic abc" },
      },
      "wildcard",
    );
    const [line] = lines();
    expect(line?.anything?.prompt).toBe(REDACTED);
    expect(line?.anything?.messages).toBe(REDACTED);
    expect(line?.anything?.authorization).toBe(REDACTED);
    expect(raw()).not.toContain("deep prompt");
    expect(raw()).not.toContain("Basic abc");
  });
});

describe("createLogger output shape", () => {
  it("US5-3: emits one JSON object per line with level, time and msg", () => {
    const { logger, lines, raw } = captureLogger();
    logger.info({ a: 1 }, "first");
    logger.warn({ b: 2 }, "second");
    expect(raw().trimEnd().split("\n")).toHaveLength(2);
    const [first, second] = lines();
    expect(first?.msg).toBe("first");
    expect(first?.level).toBe("info");
    expect(typeof first?.time).toBe("string");
    expect(() => new Date(first?.time as string).toISOString()).not.toThrow();
    expect(first?.service).toBe("tamiz-gateway");
    expect(second?.msg).toBe("second");
    expect(second?.level).toBe("warn");
  });

  it("US5-3: drops lines below the configured level", () => {
    const { logger, lines } = captureLogger("info");
    logger.debug({}, "hidden");
    logger.info({}, "shown");
    expect(lines().map((line) => line.msg)).toEqual(["shown"]);
  });

  it("keeps debug lines when the level is debug", () => {
    const { logger, lines } = captureLogger("debug");
    logger.debug({}, "visible");
    expect(lines().map((line) => line.msg)).toEqual(["visible"]);
  });
});
