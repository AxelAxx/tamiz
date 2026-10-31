/**
 * Quality eval (spec 007 US5-1 … US5-4, FR-011, FR-012, research R-07).
 *
 * Each case is answered through the gateway on the cheapest local route (`tamiz-local`)
 * and graded by a blind judge against its reference. The comparison is:
 * - with `TAMIZ_EVAL_FRONTIER=on`, the same case answered on `tamiz-frontier` and judged
 *   the same way;
 * - otherwise, the accepted baseline score for the same answering model, judge model,
 *   dataset version and judge prompt (`baselines/quality.json`). Without one the eval is
 *   an error that shows the measured score, so accepting a baseline is a reviewed change.
 *
 * The gate is `relative_score = routed ÷ comparison ≥ 0.95`. More than 10 % unparseable
 * judgements make the eval an error. Answers and rationales never enter the report.
 */
import type { EvalFailingCase } from "@tamiz/contracts";
import { type ChatMessage, createGatewayClient } from "../clients/gateway.js";
import {
  createJudgeClient,
  type Judgement,
  type JudgePrompt,
  renderPrompt,
} from "../clients/judge.js";
import { type QualityCase, QualityCaseSchema } from "../datasets.js";
import type { Eval } from "../eval.js";

export const QUALITY_DATASET = { name: "quality-es", version: 1 } as const;
export const MAX_ANSWER_TOKENS = 256;
const MAX_JUDGE_ERRORS = 0.1;

export interface QualityBaselineEntry {
  readonly dataset: string;
  readonly datasetVersion: number;
  readonly judgePrompt: string;
  readonly answerModel: string;
  readonly judgeModel: string;
  /** Mean normalized score in [0, 1]. */
  readonly score: number;
  readonly acceptedAt: string;
  /** Where the accepted run came from (a CI run URL or a commit). */
  readonly source: string;
}

export interface QualityBaseline {
  readonly entries: ReadonlyArray<QualityBaselineEntry>;
}

interface Arm {
  readonly judgement: Judgement;
  readonly model: string;
  readonly promptTokens: number;
  readonly completionTokens: number;
}

export interface QualityObservation {
  readonly routed: Arm;
  readonly frontier?: Arm;
  readonly judgeModel: string;
}

/** A judge score 1–5 mapped to [0, 1]. */
export const normalize = (score: number) => (score - 1) / 4;

function mean(values: ReadonlyArray<number>): number {
  return values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;
}

function mostCommon(values: ReadonlyArray<string>): string {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "unknown";
}

function asRequest(messages: ReadonlyArray<ChatMessage>): string {
  return messages.map((m) => `${m.role}: ${m.content}`).join("\n");
}

export interface QualityOptions {
  readonly prompt: JudgePrompt;
  readonly baseline: QualityBaseline;
}

export function qualityEval(
  options: QualityOptions,
): Eval<QualityCase, QualityObservation, QualityObservation> {
  return {
    id: "quality",
    dataset: { file: "quality-es.v1.jsonl", name: QUALITY_DATASET.name, schema: QualityCaseSchema },
    requires: [
      "TAMIZ_EVAL_GATEWAY_URL",
      "TAMIZ_EVAL_API_KEY",
      "TAMIZ_EVAL_JUDGE_URL",
      "TAMIZ_EVAL_JUDGE_MODEL",
    ],

    prepare({ config, fetch }) {
      const apiKey = config.TAMIZ_EVAL_API_KEY ?? "";
      const main = createGatewayClient({
        baseUrl: config.TAMIZ_EVAL_GATEWAY_URL ?? "",
        apiKey,
        fetch,
        timeoutMs: 180_000,
      });
      const local = createGatewayClient({
        baseUrl: config.TAMIZ_EVAL_QUALITY_GATEWAY_URL ?? config.TAMIZ_EVAL_GATEWAY_URL ?? "",
        apiKey,
        fetch,
        timeoutMs: 180_000,
      });
      const judge = createJudgeClient({
        baseUrl: config.TAMIZ_EVAL_JUDGE_URL ?? "",
        model: config.TAMIZ_EVAL_JUDGE_MODEL ?? "",
        fetch,
      });
      const frontier = config.TAMIZ_EVAL_FRONTIER === "on";

      async function arm(c: QualityCase, model: string, client: typeof main): Promise<Arm> {
        const answer = await client.chat(c.messages, model, MAX_ANSWER_TOKENS);
        const judgement = await judge.judge(
          renderPrompt(options.prompt, {
            request: asRequest(c.messages),
            reference: c.reference,
            answer: answer.text,
          }),
        );
        return {
          judgement,
          model: answer.model,
          promptTokens: answer.promptTokens,
          completionTokens: answer.completionTokens,
        };
      }

      return {
        async observe(c) {
          const routed = await arm(c, "tamiz-local", local);
          return {
            routed,
            ...(frontier ? { frontier: await arm(c, "tamiz-frontier", main) } : {}),
            judgeModel: judge.model,
          };
        },
      };
    },

    score: (_c, observation) => observation,

    summarize(results) {
      const observations = results.map((r) => r.result);
      const errors = observations.filter(
        (o) => !o.routed.judgement.ok || (o.frontier !== undefined && !o.frontier.judgement.ok),
      ).length;
      const scores = (pick: (o: QualityObservation) => Arm | undefined) =>
        observations.flatMap((o) => {
          const j = pick(o)?.judgement;
          return j?.ok === true ? [normalize(j.score)] : [];
        });
      const routedMean = mean(scores((o) => o.routed));
      const answerModel = mostCommon(observations.map((o) => o.routed.model));
      const judgeModel = observations[0]?.judgeModel ?? "unknown";
      const withFrontier =
        observations.length > 0 && observations.every((o) => o.frontier !== undefined);
      const frontierModel = withFrontier
        ? mostCommon(observations.map((o) => o.frontier?.model ?? ""))
        : undefined;
      const models = {
        answer: answerModel,
        judge: judgeModel,
        ...(frontierModel === undefined ? {} : { frontier: frontierModel }),
      };

      const failing: EvalFailingCase[] = results.flatMap(({ c, result }) => {
        const j = result.routed.judgement;
        if (!j.ok) return [{ id: c.id, reason: "judge reply not parseable" }];
        return j.score <= 2
          ? [{ id: c.id, reason: "low score", actual: { score: j.score, taskType: c.taskType } }]
          : [];
      });
      const common = [
        { name: "mean_score.routed", value: routedMean, unit: "score" as const },
        { name: "judge_errors", value: errors, unit: "count" as const },
        {
          name: "tokens.routed_output",
          value: observations.reduce((total, o) => total + o.routed.completionTokens, 0),
          unit: "count" as const,
        },
        { name: "cases", value: results.length, unit: "count" as const },
      ];

      if (results.length > 0 && errors / results.length > MAX_JUDGE_ERRORS) {
        return { metrics: common, failing, models, error: "judge_unreliable" };
      }

      let comparison: number | undefined;
      if (withFrontier) {
        comparison = mean(scores((o) => o.frontier));
      } else {
        comparison = options.baseline.entries.find(
          (e) =>
            e.dataset === QUALITY_DATASET.name &&
            e.datasetVersion === QUALITY_DATASET.version &&
            e.judgePrompt === options.prompt.version &&
            e.answerModel === answerModel &&
            e.judgeModel === judgeModel,
        )?.score;
      }
      if (comparison === undefined) {
        return { metrics: common, failing, models, error: "baseline_missing" };
      }
      return {
        metrics: [
          ...common,
          { name: "mean_score.comparison", value: comparison, unit: "score" },
          {
            name: "relative_score",
            value: comparison === 0 ? 0 : routedMean / comparison,
            unit: "ratio",
          },
        ],
        failing,
        models,
      };
    },
  };
}
