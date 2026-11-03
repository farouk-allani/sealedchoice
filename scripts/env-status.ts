#!/usr/bin/env tsx
// Prints which `.env` keys are set, by name. No value is ever read out.
//
//   pnpm env-status [--network testnet|mainnet]
import { EnvError, parseNetworkArgs } from "./lib/env.ts";
import { formatEnvStatus, readEnvStatus } from "./lib/env-status.ts";

function main(): void {
  const { network } = parseNetworkArgs(process.argv.slice(2));
  const status = readEnvStatus(network);
  console.log(formatEnvStatus(status));
  if (!status.fileExists || status.keys.some((k) => k.state === "invalid") || status.problems.length > 0) {
    process.exitCode = 1;
  }
}

try {
  main();
} catch (error) {
  if (error instanceof EnvError) {
    console.error(error.message);
    process.exitCode = 1;
  } else {
    throw error;
  }
}
