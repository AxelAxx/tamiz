import { describe, expect, it } from "vitest";
import { createTestApp } from "./helpers/app.js";

// Spec 002 US1-5, FR-031 (tasks.md T053): the OpenAPI document is generated from the
// contract schemas and served by the gateway.

interface OpenApiDocument {
  readonly openapi: string;
  readonly paths: Record<
    string,
    Record<
      string,
      { responses: Record<string, { headers?: Record<string, unknown> }>; security?: unknown }
    >
  >;
  readonly components: {
    schemas: Record<string, unknown>;
    securitySchemes: Record<string, unknown>;
  };
}

describe("GET /openapi.json (US1-5)", () => {
  it("serves an OpenAPI 3.1 document describing the chat route, health and the envelope", async () => {
    const { app } = await createTestApp();

    const response = await app.request("/openapi.json");

    expect(response.status).toBe(200);
    const doc = (await response.json()) as OpenApiDocument;
    expect(doc.openapi).toBe("3.1.0");
    expect(Object.keys(doc.paths)).toEqual(
      expect.arrayContaining(["/v1/chat/completions", "/health"]),
    );
    expect(Object.keys(doc.components.schemas)).toEqual(
      expect.arrayContaining(["ErrorEnvelope", "ChatCompletionRequest", "ChatCompletionResponse"]),
    );
    const chat = doc.paths["/v1/chat/completions"]?.["post"];
    expect(Object.keys(chat?.responses["200"]?.headers ?? {})).toEqual(
      expect.arrayContaining(["x-tamiz-route", "x-tamiz-rule", "x-request-id"]),
    );
    expect(Object.keys(chat?.responses ?? {})).toEqual(
      expect.arrayContaining(["200", "400", "401", "502", "504"]),
    );
    expect(chat?.security).toEqual([{ bearerAuth: [] }]);
    expect(doc.components.securitySchemes["bearerAuth"]).toEqual({
      type: "http",
      scheme: "bearer",
    });
  });
});
