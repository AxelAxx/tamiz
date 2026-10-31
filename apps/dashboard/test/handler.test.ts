// @vitest-environment node

import { ChatCompletionRequestSchema } from "@tamiz/contracts";
import { describe, expect, it, vi } from "vitest";
import {
  compose,
  readCookie,
  readJson,
  withNoStore,
  withOrigin,
  withSession,
} from "../src/lib/server/handler";

// Spec 008 US1-1, US1-5, research R-01, constitution IX (tasks.md T010).

const ORIGIN = "https://tamiz.example.com";

describe("handler wrappers", () => {
  it("US1-1: without a valid session a data endpoint answers 401 and calls nothing", async () => {
    const inner = vi.fn(async () => Response.json({ reached: true }));
    const handler = withSession("tamiz_session", (cookie) => cookie === "good")(inner);
    const none = await handler(new Request(`${ORIGIN}/api/audit`));
    expect(none.status).toBe(401);
    expect(await none.json()).toEqual({
      error: { type: "unauthenticated", message: expect.any(String) },
    });
    const bad = await handler(
      new Request(`${ORIGIN}/api/audit`, { headers: { cookie: "tamiz_session=bad" } }),
    );
    expect(bad.status).toBe(401);
    expect(inner).not.toHaveBeenCalled();

    const good = await handler(
      new Request(`${ORIGIN}/api/audit`, { headers: { cookie: "a=1; tamiz_session=good" } }),
    );
    expect(good.status).toBe(200);
  });

  it("US1-5: writes check the origin before the session, and every answer is no-store", async () => {
    const isValid = vi.fn(() => true);
    const handler = compose(
      withNoStore,
      withOrigin(() => ORIGIN),
      withSession("tamiz_session", isValid),
    )(async () => Response.json({ ok: true }));
    const foreign = await handler(
      new Request(`${ORIGIN}/api/simulate`, {
        method: "POST",
        headers: { origin: "https://evil.example", cookie: "tamiz_session=x" },
      }),
    );
    expect(foreign.status).toBe(403);
    expect(foreign.headers.get("cache-control")).toBe("no-store");
    expect(isValid).not.toHaveBeenCalled();

    const same = await handler(
      new Request(`${ORIGIN}/api/simulate`, {
        method: "POST",
        headers: { origin: ORIGIN, cookie: "tamiz_session=x" },
      }),
    );
    expect(same.status).toBe(200);
    expect(same.headers.get("cache-control")).toBe("no-store");
  });

  it("reads one cookie among several", () => {
    const request = new Request(ORIGIN, { headers: { cookie: "a=1; tamiz_session=v.s%3D; b=2" } });
    expect(readCookie(request, "tamiz_session")).toBe("v.s=");
    expect(readCookie(request, "missing")).toBeUndefined();
  });

  it("refuses a body that breaks its contract with 400 and issue paths only", async () => {
    const result = await readJson(
      new Request(ORIGIN, {
        method: "POST",
        body: JSON.stringify({ model: "tamiz-auto", messages: [{ role: "user", content: 7 }] }),
      }),
      ChatCompletionRequestSchema,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(400);
    expect(await result.response.json()).toEqual({
      error: {
        type: "invalid_request",
        message: expect.any(String),
        issues: ["messages.0.content"],
      },
    });
    const notJson = await readJson(
      new Request(ORIGIN, { method: "POST", body: "{" }),
      ChatCompletionRequestSchema,
    );
    expect(notJson.ok).toBe(false);
  });
});
