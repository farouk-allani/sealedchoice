// Public verification CLI: `pnpm verify --tender <id> [--network testnet|mainnet]`.
// Placeholder until T10, which runs the checks from packages/verify and exits non-zero on any FAIL.
import { BRAND } from "@tender/shared";
import { EnvError, loadEnv } from "./lib/env.ts";

function main(): number {
  const { cli } = loadEnv(process.argv.slice(2));
  console.error(`${BRAND.name} verify (${cli.network}): not implemented yet.`);
  return 2;
}

try {
  process.exitCode = main();
} catch (e) {
  if (e instanceof EnvError) {
    console.error(`verify: ${e.message}`);
    process.exitCode = 1;
  } else {
    throw e;
  }
}
