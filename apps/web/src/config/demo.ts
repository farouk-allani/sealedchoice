// The one place the app looks up which chain it is on, which contracts it talks to and which
// tenders the demo shows (docs/08-frontend.md). Components import from here, never from an
// env var directly and never with an id written inline.
import { CHAIN, DEMO_TENDER } from "./evidence.ts";
import { NETWORK } from "./network.ts";

export { NETWORK };

/** Tender contract the app reads and writes. */
export const CONTRACT_ID: string = CHAIN.tenderContract;

/** NEP-141 token the escrow and the payout are denominated in. */
export const TOKEN_ID: string = CHAIN.tokenContract;

/** Decimals and symbol of `TOKEN_ID`, for display only. Amounts stay bigint everywhere else. */
export const TOKEN_DECIMALS: number = DEMO_TENDER.tokenDecimals;
export const TOKEN_SYMBOL: string = DEMO_TENDER.tokenSymbol;

/**
 * The tender the landing page and the demo link to. A reader with no wallet can follow this one
 * end to end: created, sealed, closed, evaluated, awarded, paid.
 */
export const FEATURED_TENDER_ID: number = DEMO_TENDER.id;

/** Tenders that exist on the deployed contract today, newest first (T07 and T08 runs). */
export const DEMO_TENDER_IDS: readonly number[] = [3, 2, 1];

/**
 * Public RPC per network, overridable for a local or paid endpoint. `NEXT_PUBLIC_` because the
 * browser makes the view calls itself; an RPC URL is not a secret (.claude/rules/web.md keeps
 * secrets server-side).
 */
const DEFAULT_RPC: Record<"testnet" | "mainnet", string> = {
  testnet: "https://rpc.testnet.near.org",
  mainnet: "https://rpc.mainnet.near.org",
};

export const RPC_URL: string = process.env.NEXT_PUBLIC_NEAR_RPC_URL ?? DEFAULT_RPC[NETWORK];
