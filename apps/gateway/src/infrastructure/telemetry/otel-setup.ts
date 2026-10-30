/**
 * Trace export from the standard OpenTelemetry variables (spec 006 FR-011, US5-5,
 * research R-11).
 *
 * With `OTEL_EXPORTER_OTLP_ENDPOINT` or `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` set, a Node
 * tracer provider is registered with an OTLP/HTTP exporter behind a batch processor; the
 * exporter and the sampler (`OTEL_TRACES_SAMPLER`) read their own variables. The service
 * name is `OTEL_SERVICE_NAME`, by default `tamiz-gateway`. Without an endpoint nothing is
 * registered and the API stays a no-op.
 */
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { BatchSpanProcessor, type SpanExporter } from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";

export interface Telemetry {
  readonly enabled: boolean;
  /** Flushes pending spans and stops the exporter. */
  shutdown(): Promise<void>;
}

export interface TelemetryOptions {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly version: string;
  /** Tests pass an in-memory exporter; production uses OTLP/HTTP. */
  readonly exporter?: SpanExporter;
}

const DISABLED: Telemetry = { enabled: false, shutdown: async () => {} };

export function exportEnabled(env: TelemetryOptions["env"]): boolean {
  const endpoint = env["OTEL_EXPORTER_OTLP_TRACES_ENDPOINT"] ?? env["OTEL_EXPORTER_OTLP_ENDPOINT"];
  return endpoint !== undefined && endpoint.trim() !== "" && env["OTEL_SDK_DISABLED"] !== "true";
}

export function setupTelemetry(options: TelemetryOptions): Telemetry {
  if (!exportEnabled(options.env)) return DISABLED;
  const provider = new NodeTracerProvider({
    resource: resourceFromAttributes({
      "service.name": options.env["OTEL_SERVICE_NAME"] ?? "tamiz-gateway",
      "service.version": options.version,
    }),
    spanProcessors: [new BatchSpanProcessor(options.exporter ?? new OTLPTraceExporter())],
  });
  provider.register();
  return { enabled: true, shutdown: () => provider.shutdown() };
}
