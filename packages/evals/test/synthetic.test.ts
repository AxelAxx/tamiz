import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DetectionCaseSchema, LeakCaseSchema, loadDataset } from "../src/datasets.js";
import { generateDatasets } from "../src/generate-datasets.js";
import { GENERATED } from "../src/synthetic/generate.js";
import {
  cifControl,
  dniLetter,
  ibanValid,
  identifiers,
  luhnValid,
  nssControl,
} from "../src/synthetic/identifiers.js";
import { CITIES, FIRST_NAMES, SURNAMES } from "../src/synthetic/names.js";
import { seeded } from "../src/synthetic/random.js";

// Spec 007 FR-009, research R-05 (tasks.md T012).

const DATASETS = fileURLToPath(new URL("../datasets/", import.meta.url));
const CORPUS = fileURLToPath(
  new URL("../../../services/privacy/tests/corpus/pii-es.v1.jsonl", import.meta.url),
);
const GATED = ["DNI", "NIE", "NSS", "IBAN", "CREDIT_CARD", "PERSON", "EMAIL", "PHONE"];

describe("seeded random", () => {
  it("the same seed gives the same sequence; another seed does not", () => {
    const a = seeded(7);
    const b = seeded(7);
    const c = seeded(8);
    const take = (r: ReturnType<typeof seeded>) => Array.from({ length: 20 }, () => r.next());
    const first = take(a);
    expect(take(b)).toEqual(first);
    expect(take(c)).not.toEqual(first);
    expect(first.every((x) => x >= 0 && x < 1)).toBe(true);
  });
});

describe("identifiers carry valid control characters", () => {
  const id = identifiers(seeded(42));
  const many = <T>(fn: () => T) => Array.from({ length: 300 }, fn);
  const alnum = (s: string) => s.replace(/[^0-9a-z]/gi, "").toUpperCase();

  it("DNI and NIE letters", () => {
    for (const dni of many(id.dni)) {
      const v = alnum(dni);
      expect(v.slice(-1)).toBe(dniLetter(Number(v.slice(0, 8))));
    }
    for (const nie of many(id.nie)) {
      const v = alnum(nie);
      const n = "XYZ".indexOf(v[0] ?? "") * 10_000_000 + Number(v.slice(1, 8));
      expect(v.slice(-1)).toBe(dniLetter(n));
    }
  });

  it("CIF, IBAN, NSS and card checks", () => {
    for (const cif of many(id.cif)) {
      const v = alnum(cif);
      const control = cifControl(v.slice(1, 8));
      expect([String(control), "JABCDEFGHI"[control]]).toContain(v.slice(-1));
    }
    for (const iban of many(id.iban)) expect(ibanValid(iban)).toBe(true);
    for (const nss of many(id.nss)) {
      const v = alnum(nss);
      expect(Number(v.slice(10))).toBe(nssControl(Number(v.slice(0, 2)), Number(v.slice(2, 10))));
    }
    for (const card of many(id.card)) expect(luhnValid(alnum(card))).toBe(true);
  });

  it("formats vary: separators and lower-case letters appear", () => {
    const dnis = many(id.dni).join(" ");
    expect(dnis).toMatch(/\d{8}[a-z]/);
    expect(dnis).toMatch(/\d{2}\.\d{3}\.\d{3}-/);
    expect(many(id.iban).join(" ")).toMatch(/es\d{22}/);
  });
});

describe("held-out names", () => {
  it("no name token or city of the generator appears in the privacy service's corpus", async () => {
    const corpus = (await readFile(CORPUS, "utf8")).split(/\r?\n/).slice(1).filter(Boolean);
    const tokens = new Set<string>();
    const places = new Set<string>();
    for (const line of corpus) {
      const c = JSON.parse(line) as {
        text: string;
        spans: { kind: string; start: number; end: number }[];
      };
      for (const s of c.spans) {
        const value = c.text.slice(s.start, s.end);
        if (s.kind === "PERSON") for (const t of value.split(" ")) tokens.add(t);
        if (s.kind === "LOCATION") places.add(value);
      }
    }
    expect([...FIRST_NAMES, ...SURNAMES].filter((n) => tokens.has(n))).toEqual([]);
    expect(CITIES.filter((c) => places.has(c))).toEqual([]);
  });
});

describe("generated datasets", () => {
  it("the committed files are exactly what the generator produces (--check)", async () => {
    expect(await generateDatasets(true, DATASETS)).toEqual([]);
  });

  it("--check reports a changed file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tamiz-gen-"));
    expect(await generateDatasets(false, dir)).toEqual([]);
    const file = join(dir, "pii-leak-es.v1.jsonl");
    await writeFile(file, `${await readFile(file, "utf8")}\n`, "utf8");
    expect(await generateDatasets(true, dir)).toEqual(["pii-leak-es.v1.jsonl"]);
  });

  it("FR-009: sizes and coverage of the gated kinds", async () => {
    const leak = await loadDataset(
      join(DATASETS, "pii-leak-es.v1.jsonl"),
      "pii-leak-es",
      LeakCaseSchema,
    );
    const detection = await loadDataset(
      join(DATASETS, "pii-detection-es.v1.jsonl"),
      "pii-detection-es",
      DetectionCaseSchema,
    );
    expect(leak.cases.length).toBeGreaterThanOrEqual(150);
    const leakKinds = leak.cases.flatMap((c) => c.values.map((v) => v.kind));
    const detectionKinds = detection.cases.flatMap((c) => c.spans.map((s) => s.kind));
    expect(detectionKinds.length).toBeGreaterThanOrEqual(150);
    for (const kind of GATED) {
      expect(leakKinds.filter((k) => k === kind).length).toBeGreaterThanOrEqual(10);
      expect(detectionKinds.filter((k) => k === kind).length).toBeGreaterThanOrEqual(10);
    }
    expect(leak.cases.some((c) => c.messages.length > 1)).toBe(true);
    expect(detection.cases.some((c) => c.tags.includes("negative") && c.spans.length === 0)).toBe(
      true,
    );
    expect(leak.header.synthetic).toBe(true);
    expect(Object.keys(GENERATED)).toEqual(["pii-leak-es.v1.jsonl", "pii-detection-es.v1.jsonl"]);
  });
});
