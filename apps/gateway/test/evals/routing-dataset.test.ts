import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { classifyTask } from "../../src/application/use-cases/classify-task.js";
import { MESSAGE_ROLES } from "../../src/domain/model/inference-request.js";
import { CLEAN_INSPECTION } from "../../src/domain/model/sensitivity.js";
import { TASK_SIZES, TASK_TYPES } from "../../src/domain/model/task-classifier.js";
import { clientIdUnchecked, requestIdUnchecked } from "../../src/domain/model/units.js";
import { loadPolicyFile } from "../../src/infrastructure/policy/file-policy-loader.js";
import { decideRoute } from "../domain/helpers/policies.js";

// Spec 002 US8, FR-036 … FR-038, SC-001 (tasks.md T072): the routing gate. Classifier and
// `decide` only, over the shipped default policy: no adapter, no MSW, no network. At
// least 95 % of cases must reach their expected route; task-type accuracy is reported.

const REPO_ROOT = resolve(import.meta.dirname, "../../../..");
const DATASET = resolve(REPO_ROOT, "packages/evals/datasets/routing.v1.jsonl");
const ROUTE_THRESHOLD = 0.95;
const MIN_CASES = 40;

const HeaderSchema = z.strictObject({
  dataset: z.literal("routing"),
  version: z.literal(1),
  policy: z.string().min(1),
  synthetic: z.literal(true),
  language: z.array(z.enum(["es", "en"])).min(2),
  note: z.string().min(1),
});

const CaseSchema = z.strictObject({
  id: z.string().regex(/^routing-\d{3}$/),
  messages: z.array(z.strictObject({ role: z.enum(MESSAGE_ROLES), content: z.string() })).min(1),
  model: z.string().min(1).optional(),
  expected: z.strictObject({
    taskType: z.enum(TASK_TYPES),
    size: z.enum(TASK_SIZES),
    route: z.string().min(1),
  }),
});

type Case = z.infer<typeof CaseSchema>;

const lines = readFileSync(DATASET, "utf8")
  .split("\n")
  .filter((line) => line.trim() !== "");
const header = HeaderSchema.parse(JSON.parse(lines[0] ?? "null"));
const cases: Case[] = lines.slice(1).map((line, index) => {
  const parsed = CaseSchema.safeParse(JSON.parse(line));
  if (!parsed.success) throw new Error(`case on line ${index + 2}: ${parsed.error.message}`);
  return parsed.data;
});

describe("routing dataset v1 (US8-3, FR-036, FR-038)", () => {
  it("declares its version and policy, and is synthetic", () => {
    expect(header).toMatchObject({ dataset: "routing", version: 1, synthetic: true });
    expect(header.policy).toBe("apps/gateway/policies/default.yaml");
  });

  it("has at least 40 cases with unique ids, covering every task type and size", () => {
    expect(cases.length).toBeGreaterThanOrEqual(MIN_CASES);
    expect(new Set(cases.map((c) => c.id)).size).toBe(cases.length);
    expect(new Set(cases.map((c) => c.expected.taskType))).toEqual(new Set(TASK_TYPES));
    expect(new Set(cases.map((c) => c.expected.size))).toEqual(new Set(TASK_SIZES));
  });
});

describe("routing gate (US8-1, US8-2, US8-4, FR-037)", () => {
  it(`routes at least ${ROUTE_THRESHOLD * 100} % of cases to their expected target`, async () => {
    const loaded = await loadPolicyFile(resolve(REPO_ROOT, header.policy));
    if (!loaded.ok) throw new Error(`policy ${header.policy} must load`);
    const policy = loaded.value;

    const results = cases.map((c) => {
      const classified = classifyTask(
        {
          requestId: requestIdUnchecked(c.id),
          clientId: clientIdUnchecked("routing-eval"),
          requestedModel: c.model ?? "tamiz-auto",
          messages: c.messages,
        },
        CLEAN_INSPECTION,
      );
      const decision = decideRoute(policy, classified);
      return {
        id: c.id,
        expectedRoute: c.expected.route,
        actualRoute: decision.chain[0]?.id ?? "(none)",
        expectedType: c.expected.taskType,
        actualType: classified.taskType,
        expectedSize: c.expected.size,
        actualSize: classified.size,
      };
    });

    const routeMatches = results.filter((r) => r.actualRoute === r.expectedRoute).length;
    const typeMatches = results.filter((r) => r.actualType === r.expectedType).length;
    const sizeMatches = results.filter((r) => r.actualSize === r.expectedSize).length;
    const mismatches = results.filter(
      (r) =>
        r.actualRoute !== r.expectedRoute ||
        r.actualType !== r.expectedType ||
        r.actualSize !== r.expectedSize,
    );
    const percent = (n: number) =>
      `${((n / results.length) * 100).toFixed(1)} % (${n}/${results.length})`;

    const report = [
      mismatches.length === 0
        ? "mismatches: none"
        : [
            "mismatches:",
            "id | route expected → actual | type expected → actual | size expected → actual",
            ...mismatches.map(
              (r) =>
                `${r.id} | ${r.expectedRoute} → ${r.actualRoute} | ${r.expectedType} → ${r.actualType} | ${r.expectedSize} → ${r.actualSize}`,
            ),
          ].join("\n"),
      `route accuracy: ${percent(routeMatches)}`,
      `task-type accuracy: ${percent(typeMatches)}`,
      `size accuracy: ${percent(sizeMatches)}`,
    ].join("\n");
    console.log(report);

    expect(routeMatches / results.length, report).toBeGreaterThanOrEqual(ROUTE_THRESHOLD);
  });
});
