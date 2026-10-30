/**
 * Client API keys (spec 002 FR-029, FR-030, research R-10).
 *
 * Keys are `tmz_` + 32 random bytes in base64url; Tamiz only ever holds their SHA-256
 * hashes, from `TAMIZ_API_KEYS` (`clientId:sha256hex,…`). A fast hash is right for
 * high-entropy random keys. Verification compares the presented key's hash against every
 * record with `timingSafeEqual`, so the time taken does not depend on which one matches.
 *
 * Spec 006 (FR-006, FR-008, research R-06): keys have a role, `client` (`TAMIZ_API_KEYS`)
 * or `admin` (`TAMIZ_ADMIN_API_KEYS`), and with a database they are also looked up in the
 * `api_keys` table, where a revoked key is refused.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import {
  type ConfigurationError,
  configurationError,
  type ErrorIssue,
} from "../../domain/errors.js";
import { err, ok, type Result } from "../../domain/result.js";

export const API_KEY_ROLES = ["client", "admin"] as const;
export type ApiKeyRole = (typeof API_KEY_ROLES)[number];

export interface ApiKeyRecord {
  readonly clientId: string;
  /** SHA-256 of the key, 64 lower-case hex characters. */
  readonly keyHash: string;
  /** `client` when absent. */
  readonly role?: ApiKeyRole;
}

/** Who presented a valid key. */
export interface Principal {
  readonly clientId: string;
  readonly role: ApiKeyRole;
}

export const API_KEYS_VARIABLE = "TAMIZ_API_KEYS";
export const ADMIN_API_KEYS_VARIABLE = "TAMIZ_ADMIN_API_KEYS";

const CLIENT_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const HASH_PATTERN = /^[0-9a-f]{64}$/;

export function isValidClientId(value: string): boolean {
  return CLIENT_ID_PATTERN.test(value);
}

/** Parses `TAMIZ_API_KEYS`; an issue names the entry position, never the entry text. */
export function parseApiKeys(
  text: string,
  role: ApiKeyRole = "client",
  variable: string = API_KEYS_VARIABLE,
): Result<ReadonlyArray<ApiKeyRecord>, ConfigurationError> {
  if (text.trim() === "") {
    return err(
      configurationError("Invalid API key configuration", [
        { path: variable, message: "expected at least one key entry clientId:sha256hex" },
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
        path: `${variable}[${index}]`,
        message:
          "expected clientId:sha256hex (client id: lower-case letters, digits or '-'; hash: 64 hex characters)",
      });
      return;
    }
    records.push({ clientId, keyHash, role });
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

/** Like {@link verifyApiKey}, with the role of the matching record. */
export function verifyPrincipal(
  presented: string,
  records: ReadonlyArray<ApiKeyRecord>,
): Principal | undefined {
  const presentedHash = Buffer.from(hashApiKey(presented), "hex");
  let match: Principal | undefined;
  for (const record of records) {
    const equal = timingSafeEqual(presentedHash, Buffer.from(record.keyHash, "hex"));
    if (equal && match === undefined) {
      match = { clientId: record.clientId, role: record.role ?? "client" };
    }
  }
  return match;
}

/** The database side of authentication; structurally the API key repository. */
export interface StoredKeyLookup {
  findByHash(
    keyHash: string,
  ): Promise<{ clientId: string; role: ApiKeyRole; revoked: boolean } | undefined>;
}

/** Environment keys first (constant time), then the database when there is one. */
export function createAuthenticator(
  records: ReadonlyArray<ApiKeyRecord>,
  stored?: StoredKeyLookup,
): (key: string) => Promise<Principal | undefined> {
  return async (key) => {
    const fromEnvironment = verifyPrincipal(key, records);
    if (fromEnvironment !== undefined || stored === undefined) return fromEnvironment;
    const found = await stored.findByHash(hashApiKey(key));
    return found === undefined || found.revoked
      ? undefined
      : { clientId: found.clientId, role: found.role };
  };
}

export function generateApiKey(): { readonly key: string; readonly keyHash: string } {
  const key = `tmz_${randomBytes(32).toString("base64url")}`;
  return { key, keyHash: hashApiKey(key) };
}
