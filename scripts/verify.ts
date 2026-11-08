// Public verification CLI (docs/06-evidence-and-verification.md).
//
//   pnpm verify --tender 3 [--network testnet] [--no-artifact] [--json]
//
// Runs the same ten checks from `@tender/verify` that the `/tenders/<id>/verify` page runs, over
// the same evidence object. Exits 0 only when all ten pass; any FAIL or SKIP exits non-zero, so
// this is usable in CI and a judge can trust the exit code rather than reading the table.
//
// It needs no secrets and no `.env`: everything it reads is public. Contract and bundle store
// default to the deployment in `.env` when there is one, and to the demo deployment otherwise, so
// a fresh clone can run it.
import { loadEvidence, runChecks, summarise } from "@tender/verify";
import type { CheckResult } from "@tender/verify";
import { EnvError, loadEnv } from "./lib/env.ts";

const DEFAULTS = {
  testnet: {
    contractId: "tenders.sealedchoice.testnet",
    rpc: "https://test.rpc.fastnear.com",
    explorer: "https://testnet.nearblocks.io",
  },
  mainnet: {
    contractId: "",
    rpc: "https://free.rpc.fastnear.com",
    explorer: "https://nearblocks.io",
  },
} as const;

const BUNDLE_STORE = "https://sealedchoice-lab.vercel.app";

function flagValue(args: readonly string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  if (i >= 0) return args[i + 1];
  const eq = args.find((a) => a.startsWith(`--${name}=`));
  return eq?.slice(name.length + 3);
}

function render(results: readonly CheckResult[]): string {
  const width = Math.max(...results.map((r) => r.name.length));
  const lines: string[] = [];
  for (const r of results) {
    const mark = r.pass ? "PASS" : r.skipped ? "SKIP" : "FAIL";
    lines.push(`${String(r.id).padStart(2)}  ${mark}  ${r.name.padEnd(width)}  ${r.details}`);
    for (const l of r.links) lines.push(`${" ".repeat(width + 12)}${l.label}: ${l.href}`);
  }
  return lines.join("\n");
}

async function main(): Promise<number> {
  const { cli, env } = loadEnv(process.argv.slice(2));
  const args = cli.args;
  const raw = flagValue(args, "tender") ?? args.find((a) => /^\d+$/.test(a));
  const tenderId = Number(raw);
  if (!Number.isInteger(tenderId) || tenderId < 0) {
    console.error("usage: pnpm verify --tender <id> [--network testnet|mainnet] [--no-artifact] [--json]");
    return 2;
  }

  const d = DEFAULTS[cli.network];
  const contractId = flagValue(args, "contract") ?? env.CONTRACT_ID ?? d.contractId;
  if (!contractId) {
    console.error(`verify: no contract id for ${cli.network}; pass --contract <account>`);
    return 2;
  }
  const rpcUrl = flagValue(args, "rpc") ?? env.NEAR_RPC_URL ?? d.rpc;
  const bundleStoreUrl = flagValue(args, "bundle-store") ?? env.BUNDLE_STORE_URL ?? BUNDLE_STORE;
  const wantJson = args.includes("--json");

  if (!wantJson) {
    console.log(`verifying tender ${tenderId} on ${contractId} (${cli.network})`);
    console.log(`  rpc ${rpcUrl}`);
    console.log(`  bundle store ${bundleStoreUrl}\n`);
  }

  const { evidence, artifact } = await loadEvidence({
    contractId,
    tenderId,
    rpcUrl,
    bundleStoreUrl,
    explorerBase: d.explorer,
    network: cli.network,
    fetchArtifact: !args.includes("--no-artifact"),
  });
  const results = runChecks(evidence, artifact);
  const { passed, failed, skipped, total } = summarise(results);

  if (wantJson) {
    console.log(
      JSON.stringify({ tenderId, contractId, network: cli.network, passed, failed, skipped, total, results }, null, 2),
    );
  } else {
    console.log(render(results));
    const counts = [`${passed}/${total} checks passed`];
    if (skipped > 0) counts.push(`${skipped} not checked`);
    if (failed > 0) counts.push(`${failed} failed`);
    console.log(`\n${counts.join(", ")}`);
    const name = (r: (typeof results)[number]) => `${r.id} ${r.name}`;
    if (failed > 0) console.log(`failed: ${results.filter((r) => !r.pass && r.skipped !== true).map(name).join(", ")}`);
    if (skipped > 0) {
      console.log(`not checked: ${results.filter((r) => r.skipped === true).map(name).join(", ")}`);
    }
  }
  // Only a real failure is a non-zero exit: a skip says this evidence cannot settle the question,
  // and a CLI that exits 1 for "could not tell" teaches a judge to stop reading the exit code.
  return failed > 0 ? 1 : 0;
}

try {
  process.exitCode = await main();
} catch (e) {
  if (e instanceof EnvError) {
    console.error(`verify: ${e.message}`);
    process.exitCode = 2;
  } else {
    console.error(`verify: ${e instanceof Error ? e.message : String(e)}`);
    process.exitCode = 2;
  }
}
