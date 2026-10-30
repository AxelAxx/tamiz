import { context } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  type ReadableSpan,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import type { RoutingEventsPort } from "../../src/application/ports/routing-events.port.js";
import type { TracerPort } from "../../src/application/ports/tracer.port.js";
import { createOtelRoutingEvents } from "../../src/infrastructure/telemetry/otel-routing-events.js";
import { createOtelTracer } from "../../src/infrastructure/telemetry/otel-tracer.js";

// Context propagation is global in OpenTelemetry; the tracer provider is not, so each
// capture has its own exporter and tests do not see each other's spans.
context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());

export interface SpanCapture {
  readonly tracer: TracerPort;
  readonly events: RoutingEventsPort;
  spans(): ReadonlyArray<ReadableSpan>;
  /** Every name, attribute and event of every span, as one string to search. */
  dump(): string;
}

export function captureSpans(): SpanCapture {
  const exporter = new InMemorySpanExporter();
  const provider = new BasicTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });
  return {
    tracer: createOtelTracer(provider.getTracer("test")),
    events: createOtelRoutingEvents(),
    spans: () => exporter.getFinishedSpans(),
    dump: () =>
      JSON.stringify(
        exporter.getFinishedSpans().map((span) => ({
          name: span.name,
          attributes: span.attributes,
          events: span.events.map((event) => ({ name: event.name, attributes: event.attributes })),
          status: span.status,
        })),
      ),
  };
}
