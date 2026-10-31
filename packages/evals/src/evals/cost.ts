/**
 * Cost eval (spec 007 US5-5, FR-013, research R-08): reported, never gated.
 *
 * Each routing case is simulated; its input tokens are estimated with the gateway's rule
 * (characters ÷ 4, per message) and its output fixed at 300 tokens. Both are priced on the
 * first target of the decided chain and on the baseline target (the policy's most
 * expensive, as in feature 006). Prices come from the policy file named in the routing
 * dataset's header, since the simulation answer carries none.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { createGatewayClient } from "../clients/gateway.js";
import { type RoutingCase, RoutingCaseSchema } from "../datasets.js";
import type { Eval } from "../eval.js";

export const ESTIMATED_OUTPUT_TOKENS = 300;

const PolicyPricesSchema = z.object({
  targets: z
    .array(
      z.object({
        id: z.string(),
        pricing: z.object({ inputUsdPerMillion: z.number(), outputUsdPerMillion: z.number() }),
      }),
    )
    .min(1),
});

export type Prices = ReadonlyMap<string, { readonly input: number; readonly output: number }>;

export async function loadPrices(path: string): Promise<Prices> {
  const policy = PolicyPricesSchema.parse(parseYaml(await readFile(path, "utf8")));
  return new Map(
    policy.targets.map((t) => [
      t.id,
      { input: t.pricing.inputUsdPerMillion, output: t.pricing.outputUsdPerMillion },
    ]),
  );
}

/** The most expensive target by input + output price; the first one declared on a tie. */
export function baselineOf(prices: Prices): string {
  let best: string | undefined;
  let bestPrice = -1;
  for (const [id, p] of prices) {
    if (p.input + p.output > bestPrice) {
      best = id;
      bestPrice = p.input + p.output;
    }
  }
  return best ?? "";
}

export const estimateTokens = (text: string) => Math.ceil(text.length / 4);

export function priced(
  prices: Prices,
  targetId: string,
  inputTokens: number,
  outputTokens = ESTIMATED_OUTPUT_TOKENS,
): number {
  const p = prices.get(targetId);
  return p === undefined ? 0 : (inputTokens * p.input + outputTokens * p.output) / 1_000_000;
}

export interface CostObservation {
  readonly route: string | null;
  readonly routedUsd: number;
  readonly baselineUsd: number;
}

export const POLICY_FILE = "apps/gateway/policies/default.yaml";

export const costEval: Eval<RoutingCase, CostObservation, CostObservation> = {
  id: "cost",
  dataset: { file: "routing.v1.jsonl", name: "routing", schema: RoutingCaseSchema },
  requires: ["TAMIZ_EVAL_GATEWAY_URL", "TAMIZ_EVAL_API_KEY"],

  prepare({ config, fetch, repoRoot }) {
    const gateway = createGatewayClient({
      baseUrl: config.TAMIZ_EVAL_GATEWAY_URL ?? "",
      apiKey: config.TAMIZ_EVAL_API_KEY ?? "",
      fetch,
    });
    const prices = loadPrices(join(repoRoot, POLICY_FILE));
    return {
      async observe(c) {
        const [simulated, table] = await Promise.all([
          gateway.simulate(c.messages, c.model),
          prices,
        ]);
        const route = simulated.decision === "route" ? (simulated.chain[0]?.id ?? null) : null;
        const input = c.messages.reduce((total, m) => total + estimateTokens(m.content), 0);
        return {
          route,
          routedUsd: route === null ? 0 : priced(table, route, input),
          baselineUsd: priced(table, baselineOf(table), input),
        };
      },
    };
  },

  score: (_c, observation) => observation,

  summarize(results) {
    const routed = results.reduce((total, r) => total + r.result.routedUsd, 0);
    const baseline = results.reduce((total, r) => total + r.result.baselineUsd, 0);
    return {
      metrics: [
        { name: "cost.routed_estimate", value: routed, unit: "usd" },
        { name: "cost.baseline_estimate", value: baseline, unit: "usd" },
        { name: "saving", value: baseline === 0 ? 0 : 1 - routed / baseline, unit: "ratio" },
        { name: "cases", value: results.length, unit: "count" },
      ],
      failing: [],
    };
  },
};
