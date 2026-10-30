/**
 * `TracerPort` over `@opentelemetry/api` (spec 006 FR-009, research R-09, R-10).
 *
 * Request spans are `tamiz.request` (kind SERVER); attempt spans are `chat {model}` (kind
 * CLIENT) with the GenAI attributes of the target. `gen_ai.system` is set next to
 * `gen_ai.provider.name` while backends migrate to the new name. Without a registered
 * provider (no OTLP endpoint) the API hands out non-recording spans: a no-op.
 */
import {
  type Attributes,
  context,
  type Span,
  SpanKind,
  SpanStatusCode,
  type Tracer,
  trace,
} from "@opentelemetry/api";
import type {
  RequestSpan,
  SpanAttributes,
  SpanHandle,
  TracerPort,
} from "../../application/ports/tracer.port.js";

export const TRACER_NAME = "tamiz-gateway";

function attributes(values: SpanAttributes): Attributes {
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => [key, Array.isArray(value) ? [...value] : value]),
  ) as Attributes;
}

function handle(span: Span): SpanHandle {
  return {
    set: (values) => {
      span.setAttributes(attributes(values));
    },
    event: (name, values) => {
      span.addEvent(name, values === undefined ? undefined : attributes(values));
    },
    fail: (errorType) => {
      span.setAttribute("error.type", errorType);
      span.setStatus({ code: SpanStatusCode.ERROR });
    },
  };
}

export function createOtelTracer(tracer: Tracer = trace.getTracer(TRACER_NAME)): TracerPort {
  return {
    startRequest(): RequestSpan {
      const span = tracer.startSpan("tamiz.request", { kind: SpanKind.SERVER });
      const active = trace.setSpan(context.active(), span);
      let ended = false;
      return {
        ...handle(span),
        run: (fn) => context.with(active, fn),
        end: () => {
          if (ended) return;
          ended = true;
          span.end();
        },
      };
    },

    attempt(target, fn) {
      return tracer.startActiveSpan(
        `chat ${target.model}`,
        {
          kind: SpanKind.CLIENT,
          attributes: {
            "gen_ai.operation.name": "chat",
            "gen_ai.provider.name": target.provider,
            "gen_ai.system": target.provider,
            "gen_ai.request.model": target.model,
            "tamiz.target": target.id,
            "tamiz.residency": target.residency,
          },
        },
        async (span) => {
          try {
            return await fn(handle(span));
          } catch (error) {
            span.setAttribute("error.type", "internal_error");
            span.setStatus({ code: SpanStatusCode.ERROR });
            throw error;
          } finally {
            span.end();
          }
        },
      );
    },
  };
}
