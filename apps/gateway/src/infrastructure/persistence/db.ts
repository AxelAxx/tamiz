/**
 * PostgreSQL connection and migrations (spec 006 FR-005, research R-04).
 *
 * One postgres.js pool per process, wrapped by Drizzle. `migrate` applies the committed
 * migrations under `apps/gateway/drizzle/` before the server listens; it is idempotent.
 * The connection string is never logged: errors are reported by their code only.
 */
import { fileURLToPath } from "node:url";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import * as schema from "./schema.js";

export type Database = PostgresJsDatabase<typeof schema>;

export interface DatabaseHandle {
  readonly db: Database;
  close(): Promise<void>;
}

export const MIGRATIONS_FOLDER = fileURLToPath(new URL("../../../drizzle", import.meta.url));

export function connectDatabase(url: string, options: { max?: number } = {}): DatabaseHandle {
  const client = postgres(url, { max: options.max ?? 10, onnotice: () => {} });
  const db = drizzle(client, { schema });
  return { db, close: () => client.end({ timeout: 5 }) };
}

export async function runMigrations(handle: DatabaseHandle): Promise<void> {
  await migrate(handle.db, { migrationsFolder: MIGRATIONS_FOLDER });
}
