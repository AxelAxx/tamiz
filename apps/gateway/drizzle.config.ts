/**
 * Drizzle Kit configuration (spec 006 research R-04): generates SQL migrations from
 * `src/infrastructure/persistence/schema.ts` into `drizzle/`, which are committed and
 * applied at boot by `runMigrations`. `db:migrate` applies them by hand with DATABASE_URL.
 */
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/infrastructure/persistence/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: process.env["DATABASE_URL"] ?? "postgres://localhost:5432/tamiz" },
});
