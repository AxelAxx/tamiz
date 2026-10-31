import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createJudgeClient, parseVerdict, renderPrompt } from "../src/clients/judge.js";
import { loadDataset, QualityCaseSchema } from "../src/datasets.js";
import { baselineOf, estimateTokens, loadPrices, priced } from "../src/evals/cost.js";
import {
  normalize,
  QUALITY_DATASET,
  type QualityBaseline,
  type QualityObservation,
  qualityEval,
} from "../src/evals/quality.js";
import { register, runEvals } from "../src/runner.js";
import { FIRST_NAMES, SURNAMES } from "../src/synthetic/names.js";

// Spec 007 US5-1 … US5-5, FR-011 … FR-013 (tasks.md T023 … T026).

const PACKAGE = fileURLToPath(new URL("../", import.meta.url));
const REPO = fileURLToPath(new URL("../../../", import.meta.url));
const PROMPT = { version: "judge.v1", template: "" };
const GATEWAY = "http://gateway.test";
const JUDGE = "http://judge.test/v1";

beforeAll(async () => {
  PROMPT.template = await readFile(join(PACKAGE, "prompts", "judge.v1.md"), "utf8");
});

const okArm = (score: number, model = "qwen2.5:1.5b") => ({
  judgement: { ok: true as const, score, rationale: "" },
  model,
  promptTokens: 20,
  completionTokens: 30,
});
const failedArm = () => ({
  judgement: { ok: false as const },
  model: "qwen2.5:1.5b",
  promptTokens: 20,
  completionTokens: 0,
});

function summarize(
  observations: QualityObservation[],
  baseline: QualityBaseline = { entries: [] },
) {
  const results = observations.map((result, i) => ({
    c: {
      id: `quality-${String(i + 1).padStart(3, "0")}`,
      taskType: "chat",
      language: "es" as const,
      messages: [{ role: "user" as const, content: "x" }],
      reference: "y",
    },
    result,
  }));
  return qualityEval({ prompt: PROMPT, baseline }).summarize(results);
}

const BASELINE: QualityBaseline = {
  entries: [
    {
      dataset: QUALITY_DATASET.name,
      datasetVersion: QUALITY_DATASET.version,
      judgePrompt: "judge.v1",
      answerModel: "qwen2.5:1.5b",
      judgeModel: "qwen2.5:3b",
      score: 0.75,
      acceptedAt: "2026-10-31T00:00:00.000Z",
      source: "test",
    },
  ],
};

describe("judge replies", () => {
  it.each([
    ['{"score": 4, "rationale": "ok"}', 4],
    ['Here you go:\n```json\n{"score": 5, "rationale": "complete"}\n```', 5],
    ['{"score": "3"}', 3],
  ])("parses %j", (reply, score) => {
    expect(parseVerdict(reply)).toMatchObject({ ok: true, score });
  });

  it.each([["no json"], ['{"score": 9}'], ['{"rationale": "missing"}'], ["{broken"]])(
    "rejects %j",
    (reply) => {
      expect(parseVerdict(reply)).toEqual({ ok: false });
    },
  );

  it("US5-4: the prompt is the versioned file, with no route or model in it", () => {
    const rendered = renderPrompt(PROMPT, {
      request: "user: hola",
      reference: "ref",
      answer: "ans",
    });
    expect(rendered).toContain("user: hola");
    expect(rendered).toContain("REFERENCE:\nref");
    expect(rendered).toContain("ANSWER:\nans");
    expect(rendered).not.toMatch(/\{\{|tamiz-local|tamiz-frontier|ollama|qwen|route|frontier/i);
  });
});

describe("quality scoring", () => {
  it("US5-1, US5-3: routed mean against the accepted baseline for the same models", () => {
    const routed = [okArm(5), okArm(4), okArm(4), okArm(3)];
    const summary = summarize(
      routed.map((r) => ({ routed: r, judgeModel: "qwen2.5:3b" })),
      BASELINE,
    );
    const metric = (name: string) => summary.metrics.find((m) => m.name === name)?.value;
    const mean = (normalize(5) + normalize(4) * 2 + normalize(3)) / 4;
    expect(metric("mean_score.routed")).toBeCloseTo(mean);
    expect(metric("mean_score.comparison")).toBe(0.75);
    expect(metric("relative_score")).toBeCloseTo(mean / 0.75);
    expect(summary.models).toEqual({ answer: "qwen2.5:1.5b", judge: "qwen2.5:3b" });
    expect(summary.error).toBeUndefined();
  });

  it("US5-3: no baseline for these models → error that still shows the measured score", () => {
    const summary = summarize([{ routed: okArm(4), judgeModel: "another-judge" }], BASELINE);
    expect(summary.error).toBe("baseline_missing");
    expect(summary.metrics.find((m) => m.name === "mean_score.routed")?.value).toBe(0.75);
    expect(summary.metrics.some((m) => m.name === "relative_score")).toBe(false);
  });

  it("US5-2: with the frontier arm the comparison is the frontier's mean", () => {
    const summary = summarize([
      { routed: okArm(4), frontier: okArm(5, "claude-sonnet"), judgeModel: "j" },
      { routed: okArm(3), frontier: okArm(5, "claude-sonnet"), judgeModel: "j" },
    ]);
    const metric = (name: string) => summary.metrics.find((m) => m.name === name)?.value;
    expect(metric("mean_score.comparison")).toBe(1);
    expect(metric("relative_score")).toBeCloseTo((0.75 + 0.5) / 2);
    expect(summary.models?.frontier).toBe("claude-sonnet");
  });

  it("more than 10 % unparseable judgements → judge_unreliable", () => {
    const observations = [
      ...Array.from({ length: 8 }, () => ({ routed: okArm(4), judgeModel: "qwen2.5:3b" })),
      { routed: failedArm(), judgeModel: "qwen2.5:3b" },
      { routed: failedArm(), judgeModel: "qwen2.5:3b" },
    ];
    expect(summarize(observations, BASELINE).error).toBe("judge_unreliable");
  });

  it("low scores and unparseable replies are listed by id, without answers", () => {
    const summary = summarize(
      [
        { routed: okArm(2), judgeModel: "qwen2.5:3b" },
        { routed: okArm(5), judgeModel: "qwen2.5:3b" },
      ],
      BASELINE,
    );
    expect(summary.failing).toEqual([
      { id: "quality-001", reason: "low score", actual: { score: 2, taskType: "chat" } },
    ]);
  });

  it("the dataset's references carry no personal data", async () => {
    const dataset = await loadDataset(
      join(PACKAGE, "datasets", "quality-es.v1.jsonl"),
      "quality-es",
      QualityCaseSchema,
    );
    expect(dataset.cases.length).toBeGreaterThanOrEqual(24);
    const all = dataset.cases
      .map((c) => `${c.reference}\n${c.messages.map((m) => m.content).join("\n")}`)
      .join("\n");
    expect(all).not.toMatch(/\d{8}[A-Z]|[XYZ]\d{7}[A-Z]|ES\d{22}|@|\+34|\b[6789]\d{8}\b/i);
    for (const name of [...FIRST_NAMES, ...SURNAMES]) expect(all).not.toContain(name);
  });
});

describe("cost", () => {
  it("US5-5: prices from the default policy; the baseline is the most expensive target", async () => {
    const prices = await loadPrices(join(REPO, "apps/gateway/policies/default.yaml"));
    expect(baselineOf(prices)).toBe("anthropic-sonnet");
    expect(priced(prices, "ollama-llama", 1000)).toBe(0);
    // 1000 input tokens × 3 + 300 output × 15, per million.
    expect(priced(prices, "anthropic-sonnet", 1000)).toBeCloseTo((1000 * 3 + 300 * 15) / 1e6);
    expect(estimateTokens("abcde")).toBe(2);
  });
});

describe("quality through the gateway and the judge (MSW)", () => {
  let judgeCalls = 0;
  let replies: string[] = [];
  const answeredModels: string[] = [];
  const server = setupServer(
    http.post(`${GATEWAY}/v1/chat/completions`, async ({ request }) => {
      const body = (await request.json()) as { model: string };
      answeredModels.push(body.model);
      return HttpResponse.json({
        id: "c1",
        object: "chat.completion",
        created: 0,
        model: body.model === "tamiz-local" ? "qwen2.5:1.5b" : "claude-sonnet",
        choices: [
          { index: 0, message: { role: "assistant", content: "respuesta" }, finish_reason: "stop" },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      });
    }),
    http.post(`${JUDGE}/chat/completions`, async ({ request }) => {
      judgeCalls += 1;
      const body = (await request.json()) as {
        temperature: number;
        seed: number;
        messages: { content: string }[];
      };
      expect(body.temperature).toBe(0);
      expect(body.seed).toBe(42);
      expect(body.messages[0]?.content).not.toMatch(/tamiz-local|qwen2\.5:1\.5b/);
      const reply = replies.shift() ?? '{"score": 4, "rationale": "fine"}';
      return HttpResponse.json({ choices: [{ message: { role: "assistant", content: reply } }] });
    }),
  );
  beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
  afterEach(() => {
    judgeCalls = 0;
    replies = [];
    answeredModels.length = 0;
  });
  afterAll(() => server.close());

  const config = {
    TAMIZ_EVAL_GATEWAY_URL: GATEWAY,
    TAMIZ_EVAL_API_KEY: "k",
    TAMIZ_EVAL_JUDGE_URL: JUDGE,
    TAMIZ_EVAL_JUDGE_MODEL: "qwen2.5:3b",
    TAMIZ_EVAL_FRONTIER: "off" as const,
    TAMIZ_EVAL_CONCURRENCY: 4,
  };

  async function run(frontier: "on" | "off", baseline: QualityBaseline) {
    return runEvals({
      evals: [register(qualityEval({ prompt: PROMPT, baseline }))],
      context: {
        config: { ...config, TAMIZ_EVAL_FRONTIER: frontier },
        fetch: globalThis.fetch,
        repoRoot: REPO,
      },
      datasetsDir: join(PACKAGE, "datasets"),
      repoRoot: REPO,
      now: () => new Date(),
    });
  }

  it("CI mode: local arm only, judged blind, compared with the baseline → pass", async () => {
    const { report } = await run("off", {
      entries: [{ ...BASELINE.entries[0], score: 0.75 } as QualityBaseline["entries"][number]],
    });
    expect(report.status).toBe("pass");
    expect(new Set(answeredModels)).toEqual(new Set(["tamiz-local"]));
    expect(judgeCalls).toBe(24);
    expect(report.run.models).toEqual({ answer: "qwen2.5:1.5b", judge: "qwen2.5:3b" });
    expect(report.evals[0]?.metrics.find((m) => m.name === "relative_score")).toMatchObject({
      value: 1,
      pass: true,
    });
  });

  it("frontier mode: both arms; an unparseable reply is retried once", async () => {
    replies = ["not json", '{"score": 4}'];
    const { report } = await run("on", { entries: [] });
    expect(new Set(answeredModels)).toEqual(new Set(["tamiz-local", "tamiz-frontier"]));
    expect(judgeCalls).toBe(49);
    expect(report.evals[0]?.status).toBe("pass");
    expect(report.run.models.frontier).toBe("claude-sonnet");
  });

  it("a regression below 95 % of the baseline fails", async () => {
    const { report } = await run("off", {
      entries: [{ ...BASELINE.entries[0], score: 0.9 } as QualityBaseline["entries"][number]],
    });
    expect(report.status).toBe("fail");
    expect(report.evals[0]?.metrics.find((m) => m.name === "relative_score")?.pass).toBe(false);
  });
});
