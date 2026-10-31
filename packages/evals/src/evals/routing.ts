/**
 * Routing eval (spec 007 US4, FR-010, research R-06): each case of `routing.v1.jsonl` goes
 * through the gateway's simulation endpoint, with the real privacy inspection, and must
 * reach its expected first target. No model is called and nothing is audited.
 *
 * An expected route of `block` means the request must be blocked. A mismatch shows the
 * expected and actual route, rule, task type, size and sensitivity; task-type agreement is
 * reported beside the gated route accuracy.
 */
import type { EvalFailingCase } from "@tamiz/contracts";
import { createGatewayClient } from "../clients/gateway.js";
import { type RoutingCase, RoutingCaseSchema } from "../datasets.js";
import type { Eval } from "../eval.js";

/** The expected route of a case that must be blocked. */
export const BLOCK = "block";

export interface RoutingObservation {
  readonly route: string | null;
  readonly rule: string;
  readonly taskType: string;
  readonly size: string;
  readonly sensitivity: string;
  readonly decision: "route" | "block";
}

export interface RoutingOutcome {
  readonly ok: boolean;
  readonly taskTypeOk: boolean;
  readonly observation: RoutingObservation;
}

export function scoreRouting(c: RoutingCase, observation: RoutingObservation): RoutingOutcome {
  const ok =
    c.expected.route === BLOCK
      ? observation.decision === "block"
      : observation.decision === "route" && observation.route === c.expected.route;
  return { ok, taskTypeOk: observation.taskType === c.expected.taskType, observation };
}

export const routingEval: Eval<RoutingCase, RoutingObservation, RoutingOutcome> = {
  id: "routing",
  dataset: { file: "routing.v1.jsonl", name: "routing", schema: RoutingCaseSchema },
  requires: ["TAMIZ_EVAL_GATEWAY_URL", "TAMIZ_EVAL_API_KEY"],

  prepare({ config, fetch }) {
    const gateway = createGatewayClient({
      baseUrl: config.TAMIZ_EVAL_GATEWAY_URL ?? "",
      apiKey: config.TAMIZ_EVAL_API_KEY ?? "",
      fetch,
    });
    return {
      async observe(c) {
        const simulated = await gateway.simulate(c.messages, c.model);
        return {
          route: simulated.chain[0]?.id ?? null,
          rule: simulated.ruleId,
          taskType: simulated.taskType,
          size: simulated.size,
          sensitivity: simulated.sensitivity,
          decision: simulated.decision,
        };
      },
    };
  },

  score: scoreRouting,

  summarize(results) {
    const correct = results.filter((r) => r.result.ok).length;
    const failing: EvalFailingCase[] = results
      .filter((r) => !r.result.ok)
      .map(({ c, result: { observation } }) => ({
        id: c.id,
        reason:
          observation.decision === "block"
            ? "blocked"
            : c.expected.route === BLOCK
              ? "not blocked"
              : "unexpected route",
        expected: { route: c.expected.route, taskType: c.expected.taskType, size: c.expected.size },
        actual: {
          route: observation.decision === "block" ? BLOCK : (observation.route ?? "none"),
          rule: observation.rule,
          taskType: observation.taskType,
          size: observation.size,
          sensitivity: observation.sensitivity,
        },
      }));
    return {
      metrics: [
        {
          name: "route_accuracy",
          value: results.length === 0 ? 0 : correct / results.length,
          unit: "ratio",
        },
        {
          name: "task_type_accuracy",
          value:
            results.length === 0
              ? 0
              : results.filter((r) => r.result.taskTypeOk).length / results.length,
          unit: "ratio",
        },
        { name: "cases", value: results.length, unit: "count" },
      ],
      failing,
    };
  },
};
