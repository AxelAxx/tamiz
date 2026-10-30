import { describe, expect, it } from "vitest";
import { createScriptedPort } from "../src/scripted-port.js";

// Spec 002, research R-14 (tasks.md T015): a generic port double. The gateway types its
// handler (for example as `LlmProviderPort["complete"]`), so this package stays free of
// gateway types.

describe("createScriptedPort", () => {
  it("records every input in call order", async () => {
    const port = createScriptedPort((input: string) => input.toUpperCase());

    await port.fn("a");
    await port.fn("b");

    expect(port.calls).toEqual(["a", "b"]);
  });

  it("passes the zero-based call index to the script", async () => {
    const port = createScriptedPort((_input: string, call: number) => call);

    expect(await port.fn("x")).toBe(0);
    expect(await port.fn("y")).toBe(1);
    expect(await port.fn("z")).toBe(2);
  });

  it("resolves the script's result whether it is a value or a promise", async () => {
    const sync = createScriptedPort((input: number) => input + 1);
    const async = createScriptedPort(async (input: number) => input * 2);

    await expect(sync.fn(1)).resolves.toBe(2);
    await expect(async.fn(4)).resolves.toBe(8);
  });

  it("records the call before the script runs, so a throwing script is still recorded", async () => {
    const port = createScriptedPort((_input: string): string => {
      throw new Error("scripted failure");
    });

    await expect(port.fn("boom")).rejects.toThrow("scripted failure");
    expect(port.calls).toEqual(["boom"]);
  });

  it("starts with no calls", () => {
    const port = createScriptedPort((input: string) => input);

    expect(port.calls).toEqual([]);
  });
});
