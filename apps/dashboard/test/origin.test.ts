// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { withOrigin } from "../src/lib/server/handler";
import { isSameOrigin } from "../src/lib/server/origin";

// Spec 008 US1-5, FR-004, research R-04 (tasks.md T003).

const ORIGIN = "https://tamiz.example.com";

function request(method: string, headers: Record<string, string> = {}, body?: string): Request {
  return new Request(`${ORIGIN}/api/simulate`, {
    method,
    headers,
    ...(body === undefined ? {} : { body }),
  });
}

describe("origin check", () => {
  it("US1-5: a same-origin write passes", () => {
    expect(isSameOrigin(request("POST", { origin: ORIGIN }), ORIGIN)).toBe(true);
    expect(isSameOrigin(request("DELETE", { referer: `${ORIGIN}/live?x=1` }), ORIGIN)).toBe(true);
  });

  it("US1-5: a foreign Origin, a foreign Referer, or neither is refused", () => {
    expect(isSameOrigin(request("POST", { origin: "https://evil.example" }), ORIGIN)).toBe(false);
    expect(isSameOrigin(request("POST", { origin: "null" }), ORIGIN)).toBe(false);
    expect(isSameOrigin(request("PUT", { referer: "https://evil.example/x" }), ORIGIN)).toBe(false);
    expect(isSameOrigin(request("DELETE", { referer: "not a url" }), ORIGIN)).toBe(false);
    expect(isSameOrigin(request("POST"), ORIGIN)).toBe(false);
    // Origin wins over a matching Referer.
    expect(
      isSameOrigin(
        request("POST", { origin: "https://evil.example", referer: `${ORIGIN}/` }),
        ORIGIN,
      ),
    ).toBe(false);
    // A sibling port or scheme is another origin.
    expect(isSameOrigin(request("POST", { origin: "http://tamiz.example.com" }), ORIGIN)).toBe(
      false,
    );
  });

  it("US1-5: reads are not checked", () => {
    expect(isSameOrigin(request("GET"), ORIGIN)).toBe(true);
    expect(isSameOrigin(request("HEAD", { origin: "https://evil.example" }), ORIGIN)).toBe(true);
  });

  it("US1-5: refuses with 403 forbidden_origin before the body is read", async () => {
    const inner = vi.fn(async () => new Response("reached"));
    const handler = withOrigin(() => ORIGIN)(inner);
    const foreign = request("POST", { origin: "https://evil.example" }, '{"a":1}');
    const response = await handler(foreign);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: { type: "forbidden_origin", message: expect.any(String) },
    });
    expect(inner).not.toHaveBeenCalled();
    expect(foreign.bodyUsed).toBe(false);

    const same = await handler(request("POST", { origin: ORIGIN }, "{}"));
    expect(await same.text()).toBe("reached");
  });
});
