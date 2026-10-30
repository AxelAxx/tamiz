/**
 * Routing eval (spec 007 US4, FR-010, research R-06): each case of `routing.v1.jsonl` goes
 * through the gateway's simulation endpoint, with the real privacy inspection, and must
 * reach its expected first target. No model is called and nothing is audited.
 */
import type { EvalFailingCase } from "@tamiz/contracts";
import { createGatewayClient } from "../clients/gateway.js";
import { type RoutingCase, RoutingCaseSchema } from "../datasets.js";
import type { Eval } from "../eval.js";

export interface RoutingObservation {
  readonly route: string | null;
  readonly rule: string;
  readonly sensitivity: string;
  readonly decision: "route" | "block";
}

export interface RoutingOutcome {
  readonly ok: boolean;
  readonly observation: RoutingObservation;
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
          sensitivity: simulated.sensitivity,
          decision: simulated.decision,
        };
      },
    };
  },

  score(c, observation) {
    return { ok: observation.route === c.expected.route, observation };
  },

  summarize(results) {
    const correct = results.filter((r) => r.result.ok).length;
    const failing: EvalFailingCase[] = results
      .filter((r) => !r.result.ok)
      .map(({ c, result: { observation } }) => ({
        id: c.id,
        reason: observation.decision === "block" ? "blocked" : "unexpected route",
        expected: { route: c.expected.route, taskType: c.expected.taskType },
        actual: {
          route: observation.route ?? "none",
          rule: observation.rule,
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
        { name: "cases", value: results.length, unit: "count" },
      ],
      failing,
    };
  },
};
