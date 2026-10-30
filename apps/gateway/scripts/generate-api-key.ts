/**
 * Prints a new client API key once, and the `TAMIZ_API_KEYS` entry to configure
 * (spec 002 research R-10). Tamiz never stores the key itself.
 *
 *   pnpm --filter @tamiz/gateway generate-api-key <clientId>
 */
import { generateApiKey, isValidClientId } from "../src/infrastructure/auth/api-keys.js";

const clientId = process.argv[2] ?? "";

if (!isValidClientId(clientId)) {
  process.stderr.write(
    "usage: generate-api-key <clientId>  (1-64 lower-case letters, digits or '-', not starting with '-')\n",
  );
  process.exit(1);
}

const { key, keyHash } = generateApiKey();
process.stdout.write(`key: ${key}\n`);
process.stdout.write(`TAMIZ_API_KEYS entry: ${clientId}:${keyHash}\n`);
