/**
 * One `tamiz.request` span per request (spec 006 FR-009, FR-010, US5-1, US5-3, research
 * R-09, R-10).
 *
 * `withTracing` and `withTracingStream` wrap the inference use cases like the audit does:
 * the use case runs with the request span active, so attempt spans (from `executeChain`)
 * and routing events become its children and events. After the result the span gets the
 * decision as `tamiz.*` attributes and a `routing.decision` event. A stream's span stays
 * open until its last part, an error part or the client going away.
 *
 * Every value set here is an id, an enum, a count, a cost or a duration: the request's
 * messages and the answer never reach this module's outputs.
 */
import type { Abandoned } from "../../domain/model/fallback.js";
import type { ModelTarget } from "../../domain/model/model-target.js";
import type { Decision } from "../../domain/model/routing-decision.js";
import { failureResult } from "../audit/with-audit.js";
import type { RequestSpan, SpanAttributes, TracerPort } from "../ports/tracer.port.js";
import type { RouteInference } from "../use-cases/route-inference.js";
import type { RoutedStreamPart, StreamInference } from "../use-cases/stream-inference.js";

function decisionAttributes(decision: Decision): SpanAttributes {
  const entities = Object.fromEntries(
    Object.entries(decision.entityCounts).map(([kind, count]) => [
      `tamiz.entities.${kind}`,
      count ?? 0,
    ]),
  );
  return {
    "tamiz.policy.id": decision.policyId,
    "tamiz.policy.version": decision.policyVersion,
    "tamiz.rule": decision.ruleId,
    "tamiz.task_type": decision.taskType,
    "tamiz.sensitivity": decision.sensitivity,
    "tamiz.privacy.action": decision.privacyAction,
    ...entities,
  };
}

function recordDecision(span: RequestSpan, decision: Decision): void {
  span.set(decisionAttributes(decision));
  span.event("routing.decision", {
    rule: decision.ruleId,
    action: decision.privacyAction,
    sensitivity: decision.sensitivity,
    ...(decision.kind === "route"
      ? { chain: decision.chain.map((target) => target.id) }
      : { reason: decision.reason }),
  });
}

function servedAttributes(target: ModelTarget, abandoned: ReadonlyArray<Abandoned>) {
  return {
    "tamiz.route": target.id,
    "tamiz.fallbacks": abandoned.length,
    ...(abandoned.length === 0
      ? {}
      : { "tamiz.fallback.targets": abandoned.map((a) => a.targetId) }),
  };
}

export function withTracing(route: RouteInference, tracer: TracerPort): RouteInference {
  return async (request) => {
    const span = tracer.startRequest();
    span.set({ "tamiz.request_id": request.requestId, "tamiz.streamed": false });
    try {
      const result = await span.run(() => route(request));
      if (result.ok) {
        const { decision, target, abandoned, usage, cost } = result.value;
        recordDecision(span, decision);
        span.set({
          ...servedAttributes(target, abandoned),
          "tamiz.usage.input_tokens": usage.promptTokens,
          "tamiz.usage.output_tokens": usage.completionTokens,
          "tamiz.cost_usd": cost,
        });
      } else {
        recordDecision(span, result.error.decision);
        const failed = failureResult(result.error);
        if (failed.target !== undefined)
          span.set(servedAttributes(failed.target, failed.abandoned));
        span.fail("errorType" in failed ? failed.errorType : "internal_error");
      }
      return result;
    } catch (error) {
      span.fail("internal_error");
      throw error;
    } finally {
      span.end();
    }
  };
}

export function withTracingStream(stream: StreamInference, tracer: TracerPort): StreamInference {
  return async (request, signal) => {
    const span = tracer.startRequest();
    span.set({ "tamiz.request_id": request.requestId, "tamiz.streamed": true });
    let result: Awaited<ReturnType<StreamInference>>;
    try {
      result = await span.run(() => stream(request, signal));
    } catch (error) {
      span.fail("internal_error");
      span.end();
      throw error;
    }
    if (!result.ok) {
      recordDecision(span, result.error.decision);
      const failed = failureResult(result.error);
      if (failed.target !== undefined) span.set(servedAttributes(failed.target, failed.abandoned));
      span.fail("errorType" in failed ? failed.errorType : "internal_error");
      span.end();
      return result;
    }
    const routed = result.value;
    recordDecision(span, routed.decision);
    span.set(servedAttributes(routed.target, routed.abandoned));

    async function* traced(): AsyncGenerator<RoutedStreamPart> {
      const iterator = routed.parts[Symbol.asyncIterator]();
      let done = false;
      let ended = false;
      try {
        while (true) {
          // Each step runs with the span active, so mid-stream events attach to it.
          const next = await span.run(() => iterator.next());
          if (next.done === true) {
            done = true;
            break;
          }
          const part = next.value;
          if (part.type === "finish") {
            ended = true;
            span.set({
              "tamiz.usage.input_tokens": part.usage.promptTokens,
              "tamiz.usage.output_tokens": part.usage.completionTokens,
              "tamiz.cost_usd": part.cost,
            });
          } else if (part.type === "error") {
            ended = true;
            if (part.error.cause === "aborted") span.set({ "tamiz.cancelled": true });
            else span.fail(part.error.cause);
          }
          yield part;
        }
      } finally {
        if (!done) await iterator.return?.();
        if (!ended) span.set({ "tamiz.cancelled": true });
        span.end();
      }
    }

    return { ok: true, value: { ...routed, parts: traced() } };
  };
}
