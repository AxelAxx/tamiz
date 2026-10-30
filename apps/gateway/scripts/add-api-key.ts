/**
 * Creates an API key in the database and prints it once (spec 006 FR-006, research R-06).
 * Only its SHA-256 hash is stored; `--admin` gives it access to `/v1/admin/*`.
 *
 *   DATABASE_URL=postgres://… pnpm --filter @tamiz/gateway api-key:add <clientId> [--admin]
 */
import { generateApiKey, isValidClientId } from "../src/infrastructure/auth/api-keys.js";
import { createPostgresApiKeyRepository } from "../src/infrastructure/persistence/api-key-repository.js";
import { connectDatabase } from "../src/infrastructure/persistence/db.js";

const args = process.argv.slice(2);
const clientId = args.find((arg) => !arg.startsWith("--")) ?? "";
const role = args.includes("--admin") ? "admin" : "client";
const url = process.env["DATABASE_URL"];

if (!isValidClientId(clientId) || url === undefined || url === "") {
  process.stderr.write("usage: DATABASE_URL=… api-key:add <clientId> [--admin]\n");
  process.exit(1);
}
const database = connectDatabase(url, { max: 1 });
try {
  const { key, keyHash } = generateApiKey();
  await createPostgresApiKeyRepository(database.db).insert({ clientId, keyHash, role });
  process.stdout.write(`key: ${key}\nrole: ${role}\n`);
} finally {
  await database.close();
}
