// Every number and hash the landing page shows comes from here, and every value here was
// measured on testnet — see PROGRESS.md (log 2026-11-05) and docs/DECISIONS.md D-032.
//
// Rule for this file: if a value is not on chain or in a recorded run, it does not go on the
// page. No rounded-up numbers, no "up to", no placeholders that survive into a commit.

import { NETWORK } from "./network.ts";

const EXPLORER: Record<"testnet" | "mainnet", string> = {
  testnet: "https://testnet.nearblocks.io",
  mainnet: "https://nearblocks.io",
};

export const explorerTx = (hash: string): string => `${EXPLORER[NETWORK]}/txns/${hash}`;
export const explorerAccount = (id: string): string => `${EXPLORER[NETWORK]}/address/${id}`;
export const outlayerRequest = (id: number): string =>
  `https://outlayer.ai/requests/${id}`;

/** Shorten a hash for display. The full value stays available for copy buttons. */
export const short = (hash: string, head = 8, tail = 5): string =>
  hash.length <= head + tail + 1 ? hash : `${hash.slice(0, head)}…${hash.slice(-tail)}`;

export const CHAIN = {
  network: NETWORK,
  tenderContract: "tenders.sealedchoice.testnet",
  tokenContract: "usdc.sealedchoice.testnet",
  /** Deployed code hash of the tender contract (T07). */
  codeHash: "9ZrrKTELGfATeTqEmJcY4aFHH3vEuSrHZFrbR6v83iXD",
  /**
   * sha256 of the evaluator WASM pinned on the contract (D-030). The full value, not the
   * elided `b5e34a07…e0811fb6` the docs print — `short()` does the eliding at render time.
   */
  evaluatorBuild: "b5e34a07e647059ef89753b63aeea17bd1a7ccfae17db6ecc0a2190be0811fb6",
  bundleStore: "https://sealedchoice-lab.vercel.app",
} as const;

/**
 * Tender 3: the complete story, created → sealed → closed → evaluated → awarded → paid.
 * Token amounts are raw units; tUSDC has 6 decimals.
 */
export const DEMO_TENDER = {
  id: 3,
  bids: 3,
  /** Attempt the single accepted evaluation landed on (max 3 allowed, I12). */
  attempt: 1,
  /** On-chain result size in bytes. */
  resultBytes: 309,
  /** Wall-clock time of the evaluation inside the TEE, of a 180 s ceiling. */
  evalMs: 31_130,
  /** Model calls, all signed provider_tee. */
  modelCalls: 6,
  /** Evidence checks the e2e run makes against the tender's own evidence (D-032). */
  evidenceChecks: 14,
  /** Total gas across create + fund + three bids + close, in TGas. */
  tgas: 60.43,
  proposeAwardTx: "4d8fP5hpj8EB3wB1SwNzTW4Us6NAGPhiNvQsEQoTPVm2",
  acceptAwardTx: "13rz11MxHzyGtJCKmPVstZZfBQJjvGxHS2JExAnGRhNE",
  paidToVendor: 12_000_000_000n,
  paidToBuyer: 3_000_000_000n,
  tokenDecimals: 6,
  tokenSymbol: "tUSDC",
} as const;

/**
 * Totals in basis points from tender 3's accepted result. These are the real scores, including
 * the one that moved: on tender 3 the injection bid fell below the weak bid (D-032).
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
    label: "Bid B",
    note: "Thin methodology, cheapest price",
    totalBp: 4_755,
    flagged: false,
    outcome: "ranked",
  },
  {
    rank: 3,
    label: "Bid C",
    note: "Bid text instructs the scorer to give it full marks",
    totalBp: 4_500,
    flagged: true,
    flag: "INJECTION_SUSPECTED",
    outcome: "flagged",
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
