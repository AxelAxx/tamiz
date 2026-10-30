/**
 * API keys in PostgreSQL (spec 006 FR-006, research R-06): hashes only, with a role and a
 * revocation time. Looked up by hash after the environment keys; a revoked key is refused.
 */
import { eq } from "drizzle-orm";
import type { ApiKeyRole } from "../auth/api-keys.js";
import type { Database } from "./db.js";
import { apiKeys } from "./schema.js";

export interface StoredApiKey {
  readonly clientId: string;
  readonly role: ApiKeyRole;
  readonly revoked: boolean;
}

export interface ApiKeyRepository {
  findByHash(keyHash: string): Promise<StoredApiKey | undefined>;
  insert(record: { clientId: string; keyHash: string; role: ApiKeyRole }): Promise<void>;
  revoke(keyHash: string, at: Date): Promise<void>;
}

export function createPostgresApiKeyRepository(db: Database): ApiKeyRepository {
  return {
    async findByHash(keyHash) {
      const [row] = await db.select().from(apiKeys).where(eq(apiKeys.keyHash, keyHash)).limit(1);
      if (row === undefined) return undefined;
      return { clientId: row.clientId, role: row.role, revoked: row.revokedAt !== null };
    },
    async insert(record) {
      await db.insert(apiKeys).values(record);
    },
    async revoke(keyHash, at) {
      await db.update(apiKeys).set({ revokedAt: at }).where(eq(apiKeys.keyHash, keyHash));
    },
  };
}
