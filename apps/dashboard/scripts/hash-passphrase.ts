/**
 * Prints the `TAMIZ_DASHBOARD_PASSPHRASE_HASH` value for an operator passphrase (spec 008
 * research R-03). The passphrase is read from standard input, never from an argument, so
 * it does not land in the shell history or the process list.
 *
 *   pnpm --filter @tamiz/dashboard hash-passphrase
 */
import { createInterface } from "node:readline/promises";
import { hashPassphrase } from "../src/lib/server/passphrase";

const input = createInterface({ input: process.stdin, output: process.stderr, terminal: false });
if (process.stdin.isTTY) process.stderr.write("Passphrase: ");
const passphrase = ((await input.question("")) ?? "").replace(/\r$/, "");
input.close();

if (passphrase.length < 12) {
  process.stderr.write("refused: use a passphrase of at least 12 characters\n");
  process.exit(1);
}
process.stdout.write(`TAMIZ_DASHBOARD_PASSPHRASE_HASH=${hashPassphrase(passphrase)}\n`);
