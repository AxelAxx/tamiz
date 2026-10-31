import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { EvalReportSchema } from "@tamiz/contracts";
import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { main } from "../src/cli.js";
import { loadDataset, RoutingCaseSchema } from "../src/datasets.js";

// Spec 007 US1-1 … US1-3, US1-5, US4-1, US4-2, FR-001, FR-005 (tasks.md T003): the CLI
// against an MSW fake of the gateway's simulation endpoint.

const GATEWAY = "http://gateway.test";
const ROUTING = fileURLToPath(new URL("../datasets/routing.v1.jsonl", import.meta.url));
const dataset = await loadDataset(ROUTING, "routing", RoutingCaseSchema);
const expectedFor = new Map(
  dataset.cases.map((c) => [JSON.stringify(c.messages), c.expected.route] as const),
);

type Mode = "right" | "wrong-three" | "down" | "off-contract" | "http-500";
let mode: Mode = "right";
let simulateCalls = 0;

function simulated(route: string) {
  return {
    sensitivity: "none",
    detector: "ok",
    entities: [],
    ruleId: "default",
    taskType: "chat",
    size: "short",
    decision: "route",
    privacyAction: "allow",
    chain: [{ id: route, provider: "ollama", model: "m", residency: "local" }],
    allowedResidencies: ["local", "eu", "us", "global"],
  };
}

const server = setupServer(
  http.get(`${GATEWAY}/health`, () =>
    HttpResponse.json({ status: "ok", version: "9.9.9", uptimeMs: 1 }),
  ),
  http.post(`${GATEWAY}/v1/simulate`, async ({ request }) => {
    simulateCalls += 1;
    if (mode === "down") return HttpResponse.error();
    if (mode === "http-500") return HttpResponse.json({}, { status: 500 });
    if (mode === "off-contract") return HttpResponse.json({ chain: "nope" });
    const body = (await request.json()) as { messages: unknown };
    const key = JSON.stringify(body.messages);
    const route = expectedFor.get(key) ?? "unknown";
    const index = dataset.cases.findIndex((c) => JSON.stringify(c.messages) === key);
    return HttpResponse.json(simulated(mode === "wrong-three" && index < 3 ? "nowhere" : route));
  }),
);

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  server.resetHandlers();
  mode = "right";
  simulateCalls = 0;
});
afterAll(() => server.close());

const ONLY_ROUTING = ["--only", "routing"];
const ENV = { TAMIZ_EVAL_GATEWAY_URL: GATEWAY, TAMIZ_EVAL_API_KEY: "tmz_test" };

async function run(argv: string[] = [], env: Record<string, string> = ENV) {
  const dir = await mkdtemp(join(tmpdir(), "tamiz-evals-report-"));
  const lines: string[] = [];
  const code = await main(["--report-dir", dir, ...argv], env, {
    out: (line) => lines.push(line),
    fetch: globalThis.fetch,
    now: () => new Date("2026-10-31T09:00:00.000Z"),
  });
  const json = await readFile(join(dir, "evals.json"), "utf8").catch(() => "");
  const markdown = await readFile(join(dir, "evals.md"), "utf8").catch(() => "");
  return {
    code,
    console: lines.join("\n"),
    json,
    markdown,
    report: json === "" ? undefined : EvalReportSchema.parse(JSON.parse(json)),
  };
}

describe("evals CLI", () => {
  it("US1-1, US4-1: every case on its route → exit 0, the report says pass", async () => {
    const { code, report, console } = await run(ONLY_ROUTING);
    expect(code).toBe(0);
    expect(simulateCalls).toBe(dataset.cases.length);
    expect(report?.status).toBe("pass");
    const routing = report?.evals.find((e) => e.id === "routing");
    expect(routing?.status).toBe("pass");
    expect(routing?.metrics[0]).toMatchObject({ name: "route_accuracy", value: 1, pass: true });
    expect(report?.run.datasets).toEqual([
      { name: "routing", version: 1, cases: dataset.cases.length },
    ]);
    expect(report?.run.policy).toEqual({ id: "default", version: 3 });
    expect(report?.run.services).toEqual({ gateway: "9.9.9" });
    expect(console).toContain("✓ routing");
  });

  it("US1-2, US4-2: three wrong routes → below 95 %, exit 1, the cases listed", async () => {
    mode = "wrong-three";
    const { code, report, markdown } = await run(ONLY_ROUTING);
    expect(code).toBe(1);
    expect(report?.status).toBe("fail");
    const routing = report?.evals.find((e) => e.id === "routing");
    expect(routing?.failingCount).toBe(3);
    expect(routing?.failing[0]).toMatchObject({
      id: dataset.cases[0]?.id,
      reason: "unexpected route",
      expected: { route: dataset.cases[0]?.expected.route },
      actual: { route: "nowhere", rule: "default", sensitivity: "none" },
    });
    expect(markdown).toContain(`\`${dataset.cases[0]?.id}\``);
  });

  it.each([
    ["unreachable", "down", "unavailable"],
    ["answering 500", "http-500", "http_500"],
    ["off its contract", "off-contract", "contract"],
  ] as const)("US1-3: a gateway %s → exit 2, the service named", async (_name, m, type) => {
    mode = m;
    const { code, report, console } = await run(ONLY_ROUTING);
    expect(code).toBe(2);
    expect(report?.status).toBe("error");
    expect(report?.evals.find((e) => e.id === "routing")?.error).toEqual({
      type,
      service: "gateway",
    });
    expect(console).toContain(`gateway ${type}`);
  });

  it("US1-5: without the gateway configured the eval is skipped and the run has nothing → exit 2", async () => {
    const { code, report, console } = await run([], {});
    expect(code).toBe(2);
    expect(report?.evals.find((e) => e.id === "routing")).toMatchObject({
      status: "skipped",
      skipReason: "missing TAMIZ_EVAL_GATEWAY_URL, TAMIZ_EVAL_API_KEY",
    });
    expect(console).toContain("no eval ran");
  });

  it("US1-5: --only names what runs; a selected eval without config is an error", async () => {
    expect((await run(["--only", "routing"])).code).toBe(0);
    const unconfigured = await run(["--only", "routing"], {});
    expect(unconfigured.code).toBe(2);
    expect(unconfigured.report?.evals.find((e) => e.id === "routing")?.error).toEqual({
      type: "config_missing",
    });
  });

  it.each([
    [["--only", "vibes"], "unknown evals: vibes"],
    [["--only", "quality"], "not implemented yet: quality"],
    [["--bogus"], "Unknown option"],
  ])("%j → exit 2 before running", async (argv, message) => {
    const { code, console } = await run(argv);
    expect(code).toBe(2);
    expect(console).toContain(message);
    expect(simulateCalls).toBe(0);
  });

  it("an invalid configuration value → exit 2, naming the variable", async () => {
    const { code, console } = await run([], { ...ENV, TAMIZ_EVAL_GATEWAY_URL: "ftp://x" });
    expect(code).toBe(2);
    expect(console).toContain("TAMIZ_EVAL_GATEWAY_URL");
  });

  it("FR-005: no dataset text reaches the console, the JSON or the Markdown", async () => {
    mode = "wrong-three";
    const { console, json, markdown } = await run(ONLY_ROUTING);
    const written = `${console}\n${json}\n${markdown}`;
    for (const c of dataset.cases) {
      for (const message of c.messages) {
        // Short shared words aside, every message's text is absent.
        expect(written).not.toContain(message.content);
      }
    }
  });
});

describe("runEvals", () => {
  it("a gated metric the eval did not produce is an error, never a silent pass", async () => {
    const { register, runEvals } = await import("../src/runner.js");
    const { routingEval } = await import("../src/evals/routing.js");
    const silent = register({ ...routingEval, summarize: () => ({ metrics: [], failing: [] }) });
    const { report, diagnostics } = await runEvals({
      evals: [silent],
      context: {
        config: {
          TAMIZ_EVAL_GATEWAY_URL: GATEWAY,
          TAMIZ_EVAL_API_KEY: "k",
          TAMIZ_EVAL_FRONTIER: "off",
          TAMIZ_EVAL_CONCURRENCY: 2,
        },
        fetch: globalThis.fetch,
      },
      datasetsDir: fileURLToPath(new URL("../datasets/", import.meta.url)),
      repoRoot: fileURLToPath(new URL("../../../", import.meta.url)),
      now: () => new Date(),
    });
    expect(report.status).toBe("error");
    expect(report.evals[0]?.error).toEqual({ type: "metric_missing" });
    expect(diagnostics.join("\n")).toContain("route_accuracy");
  });
});
