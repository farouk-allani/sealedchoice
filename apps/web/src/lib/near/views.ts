// Typed reads of the tender contract. Every page that shows chain state goes through here, so
// there is one place where a view's name, arguments and shape are written down.
import { z } from "zod";
import { CONTRACT_ID } from "../../config/demo.ts";
import { viewCall } from "./rpc.ts";
import {
  awardSchema,
  bidViewSchema,
  configViewSchema,
  evaluatorRefSchema,
  frozenSchema,
  attemptSchema,
  tenderSchema,
} from "./schemas.ts";
import type { Attempt, Award, BidView, ConfigView, EvaluatorRef, Frozen, Tender } from "./schemas.ts";

interface ReadOptions {
  contractId?: string;
  finality?: "optimistic" | "final";
  signal?: AbortSignal;
}

const base = (o: ReadOptions = {}) => ({
  contractId: o.contractId ?? CONTRACT_ID,
  finality: o.finality,
  signal: o.signal,
});

export function getConfig(o?: ReadOptions): Promise<ConfigView> {
  return viewCall({ ...base(o), method: "get_config", schema: configViewSchema });
}

export function getEvaluators(o?: ReadOptions): Promise<EvaluatorRef[]> {
  return viewCall({ ...base(o), method: "get_evaluators", schema: z.array(evaluatorRefSchema) });
}

export function getTender(tenderId: number, o?: ReadOptions): Promise<Tender | null> {
  return viewCall({
    ...base(o),
    method: "get_tender",
    args: { tender_id: tenderId },
    schema: tenderSchema.nullable(),
  });
}

/** Tenders with id >= `from` (default 1), at most `limit` (contract caps it at 50). */
export function listTenders(
  params: { from?: number; limit?: number } = {},
  o?: ReadOptions,
): Promise<Tender[]> {
  return viewCall({
    ...base(o),
    method: "list_tenders",
    args: { from: params.from ?? null, limit: params.limit ?? null },
    schema: z.array(tenderSchema),
  });
}

/** Every slot ever used, withdrawn ones included, without ciphertexts. */
export function getBids(tenderId: number, o?: ReadOptions): Promise<BidView[]> {
  return viewCall({
    ...base(o),
    method: "get_bids",
    args: { tender_id: tenderId },
    schema: z.array(bidViewSchema),
  });
}

/** Base64 (standard, padded) ciphertext of one slot. */
export function getBidCiphertext(
  tenderId: number,
  slot: number,
  o?: ReadOptions,
): Promise<string | null> {
  return viewCall({
    ...base(o),
    method: "get_bid_ciphertext",
    args: { tender_id: tenderId, slot },
    schema: z.string().nullable(),
  });
}

export function getFrozen(tenderId: number, o?: ReadOptions): Promise<Frozen | null> {
  return viewCall({
    ...base(o),
    method: "get_frozen",
    args: { tender_id: tenderId },
    schema: frozenSchema.nullable(),
  });
}

export function getAttempts(tenderId: number, o?: ReadOptions): Promise<Attempt[]> {
  return viewCall({
    ...base(o),
    method: "get_attempts",
    args: { tender_id: tenderId },
    schema: z.array(attemptSchema),
  });
}

/**
 * The accepted compact result, verbatim. Kept as the exact string the contract stored, because
 * its sha256 is what a verifier checks: parse it, never re-serialise it.
 */
export function getResult(tenderId: number, o?: ReadOptions): Promise<string | null> {
  return viewCall({
    ...base(o),
    method: "get_result",
    args: { tender_id: tenderId },
    schema: z.string().nullable(),
  });
}

export function getAward(tenderId: number, o?: ReadOptions): Promise<Award | null> {
  return viewCall({
    ...base(o),
    method: "get_award",
    args: { tender_id: tenderId },
    schema: awardSchema.nullable(),
  });
}

/** A bidder's withdrawable balance on a tender, in yoctoNEAR as a decimal string. */
export function getBalance(
  tenderId: number,
  accountId: string,
  o?: ReadOptions,
): Promise<string> {
  return viewCall({
    ...base(o),
    method: "get_balance",
    args: { tender_id: tenderId, account_id: accountId },
    schema: z.string(),
  });
}

/** Whether this ciphertext hash was already submitted to this tender (I13). */
export function isCiphertextUsed(
  tenderId: number,
  ciphertextSha256: string,
  o?: ReadOptions,
): Promise<boolean> {
  return viewCall({
    ...base(o),
    method: "is_ciphertext_used",
    args: { tender_id: tenderId, ciphertext_sha256: ciphertextSha256 },
    schema: z.boolean(),
  });
}

/** Everything one tender page needs, in one round of parallel reads. */
export interface TenderDetail {
  tender: Tender;
  bids: BidView[];
  result: string | null;
}

export async function getTenderDetail(
  tenderId: number,
  o?: ReadOptions,
): Promise<TenderDetail | null> {
  const [tender, bids, result] = await Promise.all([
    getTender(tenderId, o),
    getBids(tenderId, o),
    getResult(tenderId, o),
  ]);
  if (!tender) return null;
  return { tender, bids, result };
}
