/**
 * Client API keys (spec 002 FR-029, FR-030, research R-10).
 *
 * Keys are `tmz_` + 32 random bytes in base64url; Tamiz only ever holds their SHA-256
 * hashes, from `TAMIZ_API_KEYS` (`clientId:sha256hex,…`). A fast hash is right for
 * high-entropy random keys. Verification compares the presented key's hash against every
 * record with `timingSafeEqual`, so the time taken does not depend on which one matches.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import {
  type ConfigurationError,
  configurationError,
  type ErrorIssue,
} from "../../domain/errors.js";
import { err, ok, type Result } from "../../domain/result.js";

export interface ApiKeyRecord {
  readonly clientId: string;
  /** SHA-256 of the key, 64 lower-case hex characters. */
  readonly keyHash: string;
}

export const API_KEYS_VARIABLE = "TAMIZ_API_KEYS";

const CLIENT_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const HASH_PATTERN = /^[0-9a-f]{64}$/;

export function isValidClientId(value: string): boolean {
  return CLIENT_ID_PATTERN.test(value);
}

/** Parses `TAMIZ_API_KEYS`; an issue names the entry position, never the entry text. */
export function parseApiKeys(
  text: string,
): Result<ReadonlyArray<ApiKeyRecord>, ConfigurationError> {
  if (text.trim() === "") {
    return err(
      configurationError("Invalid API key configuration", [
        { path: API_KEYS_VARIABLE, message: "expected at least one key entry clientId:sha256hex" },
      ]),
    );
  }
  const records: ApiKeyRecord[] = [];
  const issues: ErrorIssue[] = [];
  text.split(",").forEach((raw, index) => {
    const entry = raw.trim();
    const separator = entry.indexOf(":");
    const clientId = separator === -1 ? "" : entry.slice(0, separator);
    const keyHash = separator === -1 ? "" : entry.slice(separator + 1).toLowerCase();
    if (!isValidClientId(clientId) || !HASH_PATTERN.test(keyHash)) {
      issues.push({
        path: `${API_KEYS_VARIABLE}[${index}]`,
        message:
          "expected clientId:sha256hex (client id: lower-case letters, digits or '-'; hash: 64 hex characters)",
      });
      return;
    }
    records.push({ clientId, keyHash });
  });
  if (issues.length > 0) return err(configurationError("Invalid API key configuration", issues));
  return ok(records);
}

export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

/** The client id of the record whose hash matches, or `undefined`; scans every record. */
export function verifyApiKey(
  presented: string,
  records: ReadonlyArray<ApiKeyRecord>,
): string | undefined {
  const presentedHash = Buffer.from(hashApiKey(presented), "hex");
  let match: string | undefined;
  for (const record of records) {
    const equal = timingSafeEqual(presentedHash, Buffer.from(record.keyHash, "hex"));
    if (equal && match === undefined) match = record.clientId;
  }
  return match;
}

export function generateApiKey(): { readonly key: string; readonly keyHash: string } {
  const key = `tmz_${randomBytes(32).toString("base64url")}`;
  return { key, keyHash: hashApiKey(key) };
}
