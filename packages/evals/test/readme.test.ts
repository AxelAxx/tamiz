import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { EvalReportSchema } from "@tamiz/contracts";
import { describe, expect, it } from "vitest";
import { updateReadme } from "../src/readme-cli.js";
import { END, renderTable, replaceTable, START } from "../src/report/readme.js";

// Spec 007 US6-4, FR-015 (tasks.md T028).

const EXAMPLE = fileURLToPath(
  new URL("../../../specs/007-evals-gate/contracts/report.example.json", import.meta.url),
);
const README = `# Tamiz\n\nIntro.\n\n${START}\nold table\n${END}\n\nAfter.\n`;

async function report() {
  return EvalReportSchema.parse(JSON.parse(await readFile(EXAMPLE, "utf8")));
}

describe("README table", () => {
  it("one row per gated metric, the story metrics, and the run's provenance", async () => {
    const table = renderTable(await report());
    expect(table).toContain("overall **fail**");
    expect(table).toContain("| PII leak | `leak_rate.DNI` | 0.00 % | = 0.00 % | ✓ pass |");
    expect(table).toContain("| Routing | `route_accuracy` | 93.18 % | ≥ 95.00 % | ✗ fail |");
    expect(table).toContain("| Cost | `saving` | 99.12 % | reported | reported |");
    expect(table).not.toContain("leak_rate.LOCATION");
    expect(table).toContain("Models: answer `qwen2.5:1.5b`, judge `qwen2.5:3b`.");
  });

  it("US6-4: the text between the markers is replaced, the rest kept", async () => {
    const updated = replaceTable(README, "NEW");
    expect(updated).toBe(`# Tamiz\n\nIntro.\n\n${START}\nNEW\n${END}\n\nAfter.\n`);
    expect(replaceTable(updated, "NEWER")).toContain(`${START}\nNEWER\n${END}`);
  });

  it.each([
    ["missing markers", "# Tamiz\n"],
    ["a duplicated start", `${START}\n${START}\n${END}\n`],
    ["reversed markers", `${END}\nx\n${START}\n`],
  ])("%s → an error", (_name, readme) => {
    expect(() => replaceTable(readme, "x")).toThrow();
  });

  it("the command rewrites the README from a report, or exits 2", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tamiz-readme-"));
    const readme = join(dir, "README.md");
    await writeFile(readme, README, "utf8");
    const lines: string[] = [];
    expect(
      await updateReadme(["--report", EXAMPLE, "--readme", readme], (l) => lines.push(l)),
    ).toBe(0);
    expect(await readFile(readme, "utf8")).toContain("`route_accuracy`");
    await writeFile(readme, "# no markers\n", "utf8");
    expect(
      await updateReadme(["--report", EXAMPLE, "--readme", readme], (l) => lines.push(l)),
    ).toBe(2);
    expect(lines.at(-1)).toContain("expected one");
  });
});
