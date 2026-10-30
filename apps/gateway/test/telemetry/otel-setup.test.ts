import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { trace } from "@opentelemetry/api";
import { afterEach, describe, expect, it, vi } from "vitest";
import { exportEnabled, setupTelemetry } from "../../src/infrastructure/telemetry/otel-setup.js";

// Spec 006 US5-5, FR-011 (tasks.md T026).

function body(request: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
  trace.disable();
});

describe("trace export setup", () => {
  it("US5-5: without an endpoint nothing is registered and spans are no-ops", async () => {
    const telemetry = setupTelemetry({ env: {}, version: "0.1.0" });
    expect(telemetry.enabled).toBe(false);
    const span = trace.getTracer("t").startSpan("x");
    expect(span.isRecording()).toBe(false);
    span.end();
    await telemetry.shutdown();
  });

  it.each([
    [{ OTEL_EXPORTER_OTLP_ENDPOINT: "http://collector:4318" }, true],
    [{ OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: "http://collector:4318/v1/traces" }, true],
    [{ OTEL_EXPORTER_OTLP_ENDPOINT: " " }, false],
    [{ OTEL_EXPORTER_OTLP_ENDPOINT: "http://collector:4318", OTEL_SDK_DISABLED: "true" }, false],
  ])("the standard variables decide: %o → %s", (env, enabled) => {
    expect(exportEnabled(env)).toBe(enabled);
  });

  it("US5-5: with OTEL_EXPORTER_OTLP_ENDPOINT, spans reach the collector over OTLP/HTTP", async () => {
    const received: Array<{ path: string | undefined; body: string }> = [];
    const collector = createServer(async (request, response) => {
      received.push({ path: request.url, body: await body(request) });
      response.writeHead(200, { "content-type": "application/json" }).end("{}");
    });
    await new Promise<void>((resolve) => collector.listen(0, "127.0.0.1", resolve));
    const { port } = collector.address() as AddressInfo;
    const env = {
      OTEL_EXPORTER_OTLP_ENDPOINT: `http://127.0.0.1:${port}`,
      OTEL_EXPORTER_OTLP_PROTOCOL: "http/json",
      OTEL_SERVICE_NAME: "tamiz-test",
    };
    for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
    try {
      const telemetry = setupTelemetry({ env, version: "9.9.9" });
      expect(telemetry.enabled).toBe(true);
      trace.getTracer("t").startSpan("tamiz.request").end();
      await telemetry.shutdown();
      expect(received.map((r) => r.path)).toContain("/v1/traces");
      const sent = received.map((r) => r.body).join("");
      expect(sent).toContain("tamiz.request");
      expect(sent).toContain("tamiz-test");
    } finally {
      collector.close();
    }
  });
});
