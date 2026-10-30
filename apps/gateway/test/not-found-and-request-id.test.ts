import { ErrorEnvelopeSchema } from "@tamiz/contracts";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/presentation/app.js";
import { NO_CHAT } from "./helpers/app.js";
import { noopLogger, recordingLogger } from "./helpers/noop-logger.js";

// Spec 001, US3 scenarios 3 and 4 and FR-018 / FR-019: unknown routes and unhandled
// errors answer with an ErrorEnvelope; every response carries x-request-id.

const startedAt = new Date("2026-01-01T00:00:00Z");
const clock = { now: () => startedAt };

/** The fields the app is expected to put on a request or error log line. */
interface LogBindingsShape {
  readonly requestId?: unknown;
  readonly status?: unknown;
  readonly req?: {
    readonly method?: unknown;
    readonly path?: unknown;
    readonly headers?: { readonly authorization?: unknown };
  };
}

function buildApp(logger = noopLogger) {
  return createApp({ clock, version: "0.1.0", startedAt, logger, ...NO_CHAT });
}

describe("unknown routes", () => {
  it("US3-3: GET /nope answers 404 with an ErrorEnvelope of type not_found", async () => {
    const response = await buildApp().request("/nope");
    expect(response.status).toBe(404);
    const body = ErrorEnvelopeSchema.parse(await response.json());
    expect(body.error.type).toBe("not_found");
    expect(body.error.message).toBe("Route not found");
    expect(body.error.requestId).toBe(response.headers.get("x-request-id"));
  });
});

describe("x-request-id", () => {
  it("US3-4: generates an id when the client sends none", async () => {
    const response = await buildApp().request("/health");
    const id = response.headers.get("x-request-id");
    expect(id).toMatch(/^[A-Za-z0-9_-]{1,128}$/);
  });

  it("US3-4: echoes a well-formed client value", async () => {
    const response = await buildApp().request("/nope", {
      headers: { "x-request-id": "abc-123" },
    });
    expect(response.headers.get("x-request-id")).toBe("abc-123");
    const body = ErrorEnvelopeSchema.parse(await response.json());
    expect(body.error.requestId).toBe("abc-123");
  });

  it("replaces a value longer than 128 characters with a generated one", async () => {
    const tooLong = "a".repeat(200);
    const response = await buildApp().request("/health", {
      headers: { "x-request-id": tooLong },
    });
    const id = response.headers.get("x-request-id");
    expect(id).not.toBe(tooLong);
    expect(id).toMatch(/^[A-Za-z0-9_-]{1,128}$/);
  });

  it("replaces a value with characters outside the RequestId charset", async () => {
    for (const bad of ["abc\u0007def", "with space", "id=1", "ünïcode", "a/b"]) {
      const response = await buildApp().request("/health", {
        headers: { "x-request-id": bad },
      });
      const id = response.headers.get("x-request-id");
      expect(id).not.toBe(bad);
      expect(id).toMatch(/^[A-Za-z0-9_-]{1,128}$/);
    }
  });

  it("accepts a 128-character value at the limit", async () => {
    const atLimit = "x".repeat(128);
    const response = await buildApp().request("/health", {
      headers: { "x-request-id": atLimit },
    });
    expect(response.headers.get("x-request-id")).toBe(atLimit);
  });
});

describe("unhandled errors", () => {
  it("FR-019: a route that throws answers 500 with an internal envelope and no stack", async () => {
    const { logger, entries } = recordingLogger();
    const app = buildApp(logger);
    app.get("/boom", () => {
      throw new Error("secret internal detail");
    });

    const response = await app.request("/boom", { headers: { "x-request-id": "req-1" } });

    expect(response.status).toBe(500);
    const text = await response.text();
    expect(text).not.toContain("secret internal detail");
    expect(text).not.toMatch(/\bat\s+\S+\s*\(/);
    const body = ErrorEnvelopeSchema.parse(JSON.parse(text));
    expect(body.error.type).toBe("internal");
    expect(body.error.requestId).toBe("req-1");
    expect(response.headers.get("x-request-id")).toBe("req-1");

    const errorEntry = entries.find((entry) => entry.level === "error");
    expect(errorEntry).toBeDefined();
    const errorBindings = errorEntry?.bindings as LogBindingsShape | undefined;
    expect(errorBindings?.requestId).toBe("req-1");
  });
});

describe("request logging", () => {
  it("logs one info line per request with method, path, status and requestId, never the body", async () => {
    const { logger, entries } = recordingLogger();
    const app = buildApp(logger);

    await app.request("/health", {
      method: "GET",
      headers: { "x-request-id": "log-1", authorization: "Bearer top-secret" },
    });

    const line = entries.find((entry) => entry.message === "request completed");
    expect(line).toBeDefined();
    expect(line?.level).toBe("info");
    const bindings = line?.bindings as LogBindingsShape | undefined;
    expect(bindings?.requestId).toBe("log-1");
    expect(bindings?.status).toBe(200);
    expect(bindings?.req?.method).toBe("GET");
    expect(bindings?.req?.path).toBe("/health");
    expect(bindings).not.toHaveProperty("body");
  });

  it("logs the authorization header only when the client sent one", async () => {
    const { logger, entries } = recordingLogger();
    const app = buildApp(logger);

    await app.request("/health");
    await app.request("/health", { headers: { authorization: "Bearer top-secret" } });

    const [without, withHeader] = entries
      .filter((entry) => entry.message === "request completed")
      .map((entry) => entry.bindings as LogBindingsShape);
    expect(without?.req?.headers).not.toHaveProperty("authorization");
    // The port receives the raw value; the pino adapter redacts it on the way out
    // (logger.test.ts covers that path), so a recording logger sees it here.
    expect(withHeader?.req?.headers?.authorization).toBe("Bearer top-secret");
  });
});
