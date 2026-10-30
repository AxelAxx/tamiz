import * as crypto from "node:crypto";
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  generateApiKey,
  hashApiKey,
  parseApiKeys,
  verifyApiKey,
} from "../../src/infrastructure/auth/api-keys.js";

vi.mock("node:crypto", { spy: true });

// Spec 002 US5-4, FR-029, FR-030, research R-10 (tasks.md T051): API keys are stored as
// SHA-256 hashes, parsed from TAMIZ_API_KEYS and compared in constant time.

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

describe("parseApiKeys (FR-030)", () => {
  it("parses comma-separated clientId:sha256 entries", () => {
    const result = parseApiKeys(`acme:${HASH_A}, beta:${HASH_B}`);

    expect(result).toEqual({
      ok: true,
      value: [
        { clientId: "acme", keyHash: HASH_A, role: "client" },
        { clientId: "beta", keyHash: HASH_B, role: "client" },
      ],
    });
  });

  it.each([
    ["no client id", `acme:${HASH_A},:${HASH_B}`],
    ["an invalid client id", `acme:${HASH_A},Beta_Corp:${HASH_B}`],
    ["a 63-character hash", `acme:${HASH_A},beta:${"b".repeat(63)}`],
    ["a hash that is not hex", `acme:${HASH_A},beta:${"z".repeat(64)}`],
    ["no separator", `acme:${HASH_A},beta${HASH_B}`],
  ])("rejects %s, naming the entry position and never its text (US5-4)", (_name, text) => {
    const result = parseApiKeys(text);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("configuration");
    expect(result.error.issues.map((issue) => issue.path)).toEqual(["TAMIZ_API_KEYS[1]"]);
    expect(JSON.stringify(result.error)).not.toContain(HASH_B.slice(0, 20));
    expect(JSON.stringify(result.error)).not.toContain("Beta_Corp");
  });

  it("rejects an empty value with 'at least one key'", () => {
    const result = parseApiKeys("  ");

    expect(!result.ok && result.error.issues).toEqual([
      { path: "TAMIZ_API_KEYS", message: "expected at least one key entry clientId:sha256hex" },
    ]);
  });
});

describe("hashApiKey, verifyApiKey, generateApiKey (FR-029)", () => {
  afterEach(() => {
    vi.mocked(crypto.timingSafeEqual).mockClear();
  });

  it("hashes with SHA-256 hex", () => {
    expect(hashApiKey("tmz_x")).toBe(createHash("sha256").update("tmz_x").digest("hex"));
  });

  it("returns the client id of the matching record and undefined otherwise", () => {
    const records = [
      { clientId: "acme", keyHash: hashApiKey("tmz_acme") },
      { clientId: "beta", keyHash: hashApiKey("tmz_beta") },
    ];

    expect(verifyApiKey("tmz_beta", records)).toBe("beta");
    expect(verifyApiKey("tmz_nope", records)).toBeUndefined();
  });

  it("compares against every record, whichever matches (constant time over the list)", () => {
    const records = [
      { clientId: "acme", keyHash: hashApiKey("tmz_acme") },
      { clientId: "beta", keyHash: hashApiKey("tmz_beta") },
      { clientId: "gamma", keyHash: hashApiKey("tmz_gamma") },
    ];

    verifyApiKey("tmz_acme", records);

    expect(crypto.timingSafeEqual).toHaveBeenCalledTimes(3);
  });

  it("verifies both keys of a client during rotation (edge case)", () => {
    const records = [
      { clientId: "acme", keyHash: hashApiKey("tmz_old") },
      { clientId: "acme", keyHash: hashApiKey("tmz_new") },
    ];

    expect(verifyApiKey("tmz_old", records)).toBe("acme");
    expect(verifyApiKey("tmz_new", records)).toBe("acme");
  });

  it("generates tmz_ plus 43 base64url characters and returns its hash", () => {
    const { key, keyHash } = generateApiKey();

    expect(key).toMatch(/^tmz_[A-Za-z0-9_-]{43}$/);
    expect(keyHash).toBe(hashApiKey(key));
    expect(generateApiKey().key).not.toBe(key);
  });
});
