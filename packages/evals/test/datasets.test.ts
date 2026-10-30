import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  DatasetError,
  DetectionCaseSchema,
  LeakCaseSchema,
  loadDataset,
  QualityCaseSchema,
  RoutingCaseSchema,
} from "../src/datasets.js";

// Spec 007 US1-4, FR-002 (tasks.md T001).

const DATASETS = new URL("../datasets/", import.meta.url);
const header = (dataset: string) =>
  JSON.stringify({ dataset, version: 1, synthetic: true, language: ["es"], note: "Synthetic." });

async function file(lines: ReadonlyArray<string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "tamiz-evals-"));
  const path = join(dir, "toy.v1.jsonl");
  await writeFile(path, `${lines.join("\n")}\n`, "utf8");
  return path;
}

async function failure(promise: Promise<unknown>): Promise<DatasetError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof DatasetError) return error;
    throw error;
  }
  throw new Error("expected a DatasetError");
}

const leakCase = (id: string, content: string, start: number, end: number) =>
  JSON.stringify({
    id,
    tags: ["clinic"],
    messages: [{ role: "user", content }],
    values: [{ kind: "DNI", messageIndex: 0, start, end }],
  });

describe("datasets", () => {
  it("the shipped routing dataset loads, with its policy in the header", async () => {
    const dataset = await loadDataset(
      fileURLToPath(new URL("routing.v1.jsonl", DATASETS)),
      "routing",
      RoutingCaseSchema,
    );
    expect(dataset.cases.length).toBeGreaterThanOrEqual(40);
    expect(dataset.header.policy).toBe("apps/gateway/policies/default.yaml");
  });

  it("each dataset kind has a case schema", async () => {
    const leak = await loadDataset(
      await file([header("pii-leak-es"), leakCase("pii-leak-0001", "DNI 12345678Z.", 4, 13)]),
      "pii-leak-es",
      LeakCaseSchema,
    );
    expect(leak.cases[0]?.values[0]?.kind).toBe("DNI");
    const detection = await loadDataset(
      await file([
        header("pii-detection-es"),
        JSON.stringify({
          id: "pii-detection-0001",
          tags: [],
          text: "IBAN es9121000418450200051332",
          spans: [{ kind: "IBAN", start: 5, end: 29 }],
        }),
      ]),
      "pii-detection-es",
      DetectionCaseSchema,
    );
    expect(detection.cases).toHaveLength(1);
    const quality = await loadDataset(
      await file([
        header("quality-es"),
        JSON.stringify({
          id: "quality-001",
          taskType: "summarize",
          language: "es",
          messages: [{ role: "user", content: "Resume: el informe está listo." }],
          reference: "El informe está terminado.",
        }),
      ]),
      "quality-es",
      QualityCaseSchema,
    );
    expect(quality.cases).toHaveLength(1);
  });

  it.each([
    ["not JSON", ["{"], 1, "header"],
    ["a header without synthetic: true", [header("x").replace("true", "false")], 1, "synthetic"],
    ["another dataset's header", [header("other")], 1, 'dataset must be "pii-leak-es"'],
  ])("US1-4: %s stops at line %i", async (_name, lines, line, problem) => {
    const error = await failure(
      loadDataset(await file(lines.map((l) => l)), "pii-leak-es", LeakCaseSchema),
    );
    expect(error.line).toBe(line);
    if (problem !== "header") expect(error.problem).toContain(problem);
  });

  it("US1-4: an invalid case names the file and the line, not the content", async () => {
    const secret = "Juana Calvo Ortiz";
    const path = await file([
      header("pii-leak-es"),
      leakCase("pii-leak-0001", "DNI 12345678Z.", 4, 13),
      JSON.stringify({
        id: "pii-leak-0002",
        tags: [],
        messages: [{ role: "user", content: secret }],
      }),
    ]);
    const error = await failure(loadDataset(path, "pii-leak-es", LeakCaseSchema));
    expect(error.file).toBe("toy.v1.jsonl");
    expect(error.line).toBe(3);
    expect(error.message).toContain("toy.v1.jsonl:3");
    expect(error.message).not.toContain(secret);
  });

  it.each([
    [
      "a duplicate id",
      [
        leakCase("pii-leak-0001", "DNI 12345678Z.", 4, 13),
        leakCase("pii-leak-0001", "DNI 12345678Z.", 4, 13),
      ],
      "duplicate id",
    ],
    ["offsets past the message", [leakCase("pii-leak-0001", "DNI 12345678Z.", 4, 40)], "offsets"],
    ["an empty span", [leakCase("pii-leak-0001", "DNI 12345678Z.", 4, 4)], "offsets"],
  ])("US1-4: %s is rejected", async (_name, cases, problem) => {
    const error = await failure(
      loadDataset(await file([header("pii-leak-es"), ...cases]), "pii-leak-es", LeakCaseSchema),
    );
    expect(error.problem).toContain(problem);
  });

  it("a dataset with no cases is rejected", async () => {
    const error = await failure(
      loadDataset(await file([header("pii-leak-es")]), "pii-leak-es", LeakCaseSchema),
    );
    expect(error.problem).toBe("no cases");
  });
});
