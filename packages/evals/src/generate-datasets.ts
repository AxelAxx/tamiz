#!/usr/bin/env node
/**
 * `pnpm --filter @tamiz/evals generate:datasets [-- --check]` (spec 007 research R-05).
 *
 * Writes the generated datasets, or with `--check` fails (exit 1) when a committed file
 * differs from what the generator produces now. CI runs the check.
 */
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { GENERATED } from "./synthetic/generate.js";

const DATASETS = fileURLToPath(new URL("../datasets/", import.meta.url));

export async function generateDatasets(check: boolean, dir = DATASETS): Promise<string[]> {
  const stale: string[] = [];
  for (const [file, generate] of Object.entries(GENERATED)) {
    const path = resolve(dir, file);
    const content = generate();
    if (check) {
      const committed = await readFile(path, "utf8").catch(() => "");
      if (committed.replace(/\r\n/g, "\n") !== content) stale.push(file);
    } else {
      await writeFile(path, content, "utf8");
    }
  }
  return stale;
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const check = process.argv.includes("--check");
  generateDatasets(check).then(
    (stale) => {
      for (const file of stale) process.stdout.write(`stale: ${file} (run generate:datasets)\n`);
      if (!check) process.stdout.write(`written: ${Object.keys(GENERATED).join(", ")}\n`);
      process.exitCode = stale.length > 0 ? 1 : 0;
    },
    () => {
      process.stdout.write("generation failed\n");
      process.exitCode = 2;
    },
  );
}
