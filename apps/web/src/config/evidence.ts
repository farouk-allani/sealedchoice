// Every number and hash the landing page shows comes from here, and every value here was
// measured on testnet. See PROGRESS.md (final demo 1, 2026-11-10) and D-038.
//
// Rule for this file: if a value is not on chain or in a recorded run, it does not go on the
// page. No rounded-up numbers, no "up to", no placeholders that survive into a commit.

import { NETWORK } from "./network.ts";

const EXPLORER: Record<"testnet" | "mainnet", string> = {
  testnet: "https://testnet.nearblocks.io",
  mainnet: "https://nearblocks.io",
};

/** Contract used for the three earlier model-variance measurements. */
export const EARLIER_CONTRACT_ID = "tenders.sealedchoice.testnet";

export const explorerTx = (hash: string): string => `${EXPLORER[NETWORK]}/txns/${hash}`;
export const explorerAccount = (id: string): string => `${EXPLORER[NETWORK]}/address/${id}`;
export const outlayerRequest = (id: number): string =>
  `https://outlayer.ai/requests/${id}`;

/** Shorten a hash for display. The full value stays available for copy buttons. */
export const short = (hash: string, head = 8, tail = 5): string =>
  hash.length <= head + tail + 1 ? hash : `${hash.slice(0, head)}…${hash.slice(-tail)}`;

export const CHAIN = {
  network: NETWORK,
  tenderContract: "tenders-v1.sealedchoice.testnet",
  tokenContract: "usdc.sealedchoice.testnet",
  /** Deployed code hash of the frozen T14 contract. */
  codeHash: "3HNnjqgBrxMXhJnmBk2vxHax2iFDrFzp94vVAdXEtGuU",
  /**
   * sha256 of the frozen evaluator WASM pinned on the contract (D-038). The full value,
   * with `short()` doing the eliding at render time.
   */
  evaluatorBuild: "737b91e724b25facefce9d9e53655bd18e3a4070c857af54f88f0e7b5f18d470",
  /**
   * Where bundles are read from. The deployed app serves `/api/bundles/<sha256>` itself, so
   * in production this is its own origin. Overridable because a verifier page running
   * somewhere else, or a local dev server, needs to point at a store that has the bytes;
   * the bundle is content-addressed and check 6 hashes what arrives, so where it came from
   * changes nothing about whether it is the right bundle.
   */
  bundleStore: process.env.NEXT_PUBLIC_BUNDLE_STORE_URL ?? "https://sealedchoice-lab.vercel.app",
} as const;

/**
 * Final tender 1: created → sealed → closed → evaluated → awarded → paid.
 * Token amounts are raw units; tUSDC has 6 decimals.
 */
export const DEMO_TENDER = {
  id: 1,
  bids: 3,
  /** Attempt the single accepted evaluation landed on (max 3 allowed, I12). */
  attempt: 2,
  outlayerRequest: 15517,
  /** On-chain result size in bytes. */
  resultBytes: 309,
  /** Wall-clock time of the evaluation inside the TEE, of a 180 s ceiling. */
  evalMs: 35_095,
  /** Model calls, all signed provider_tee. */
  modelCalls: 6,
  /** Public verifier checks, including hashing the frozen artifact. */
  evidenceChecks: 10,
  /** Total gas across create + fund + three bids + close + retry, in TGas. */
  tgas: 81.839828442001,
  proposeAwardTx: "F6GLGTEr578fMvXyaCVp6HXxTFncAWiETisudZC1cxMN",
  acceptAwardTx: "8ZMMLktGoLx3zAiR3GSCYazdMutHYbFvueWc2zEqwPnG",
  paidToVendor: 12_000_000_000n,
  paidToBuyer: 3_000_000_000n,
  tokenDecimals: 6,
  tokenSymbol: "tUSDC",
} as const;

/**
 * Totals in basis points from final tender 1's accepted attempt 2.
 */
export const DEMO_RANKING = [
  {
    rank: 1,
    label: "Bid A",
    note: "Four-phase methodology, priced mid-range",
    totalBp: 8_666,
    flagged: false,
    outcome: "awarded",
  },
  {
    rank: 2,
    label: "Bid C",
    note: "Bid text instructs the scorer to give it full marks",
    totalBp: 5_200,
    flagged: true,
    flags: ["INJECTION_SUSPECTED"],
    outcome: "flagged",
  },
  {
    rank: 3,
    label: "Bid B",
    note: "Thin methodology, cheapest price",
    totalBp: 4_755,
    flagged: false,
    outcome: "ranked",
  },
] as const;

/** Earlier full runs, kept because they are what makes the reproducibility claim honest. */
export const PRIOR_RUNS = [
  { tender: 1, request: 9603, closeTx: "9Af6tpbs7z5bU9ud4tGquU14xoZ3eAGpCbmQ1dVDWp2D", scores: [8_166, 4_755, 5_200] },
  { tender: 2, request: 9605, closeTx: "5TiwaRbQQEqXWZZYMYs9L2QWWmknhiFBycBa29RNVA4J", scores: [8_666, 4_755, 5_200] },
  { tender: 3, request: null, closeTx: null, scores: [8_666, 4_755, 4_500] },
] as const;

/** Basis points → a human string. Integers only, never a float (CLAUDE.md). */
export const bpToString = (bp: number): string => {
  const whole = Math.trunc(bp / 100);
  const frac = Math.abs(bp % 100);
  return `${whole}.${String(frac).padStart(2, "0")}`;
};

/** Raw token units → a human string, by integer arithmetic. */
export const tokensToString = (raw: bigint, decimals: number): string => {
  const unit = 10n ** BigInt(decimals);
  const whole = raw / unit;
  return whole.toLocaleString("en-US");
};
