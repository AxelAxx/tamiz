/**
 * Applies the committed migrations to `DATABASE_URL` (spec 006 research R-04). The gateway
 * also does this at boot; this script is for operators who migrate ahead of a deploy.
 *
 *   DATABASE_URL=postgres://… pnpm --filter @tamiz/gateway db:migrate
 */
import { connectDatabase, runMigrations } from "../src/infrastructure/persistence/db.js";

const url = process.env["DATABASE_URL"];
if (url === undefined || url === "") {
  process.stderr.write("DATABASE_URL is required\n");
  process.exit(1);
}
const database = connectDatabase(url, { max: 1 });
try {
  await runMigrations(database);
  process.stdout.write("migrations applied\n");
} finally {
  await database.close();
}
