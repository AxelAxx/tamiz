import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Spec 001, US1 scenario 5: the root manifest is private, Apache-2.0 and pins Node 22.
const here = dirname(fileURLToPath(import.meta.url));
const rootManifestPath = resolve(here, "../../../package.json");

interface RootManifest {
  readonly private?: boolean;
  readonly license?: string;
  readonly engines?: { readonly node?: string };
  readonly packageManager?: string;
}

const manifest = JSON.parse(readFileSync(rootManifestPath, "utf8")) as RootManifest;

describe("root package manifest", () => {
  it("is private so the workspace root is never published", () => {
    expect(manifest.private).toBe(true);
  });

  it("declares the Apache-2.0 licence", () => {
    expect(manifest.license).toBe("Apache-2.0");
  });

  it("pins the Node 22 runtime range", () => {
    expect(manifest.engines?.node).toBe(">=22 <23");
  });

  it("pins pnpm through the packageManager field", () => {
    expect(manifest.packageManager).toMatch(/^pnpm@10\.\d+\.\d+$/);
  });
});
