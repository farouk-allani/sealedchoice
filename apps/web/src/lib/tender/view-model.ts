// Chain data to what the components take. Nothing here invents a value: if the chain does not
// say it, the page does not show it (the rule apps/web/src/config/evidence.ts already follows).
import { compactResultSchema, decodeFlags, rubricSchema } from "@tender/shared";
import type { CompactResult, FlagName, Rubric } from "@tender/shared";
import type { RankingRow } from "../../components/app/ranking-table.tsx";
import type { Award, BidView, Tender } from "../near/schemas.ts";
import { shortAccount } from "./format.ts";

/**
 * The rubric as the contract stored it. The contract already refused anything the evaluator
 * would refuse (I14), so a parse failure here means the app and the chain disagree about the
 * schema, and the page says so rather than guessing.
 */
export function parseRubric(rubricJson: string): { rubric: Rubric | null; error: string | null } {
  let value: unknown;
  try {
    value = JSON.parse(rubricJson);
  } catch {
    return { rubric: null, error: "The stored rubric is not JSON." };
  }
  const parsed = rubricSchema.safeParse(value);
  if (!parsed.success) {
    return {
      rubric: null,
      error: `The stored rubric does not match the published schema (${parsed.error.issues[0]?.message ?? "?"}).`,
    };
  }
  return { rubric: parsed.data, error: null };
}

/** The accepted compact result. The raw string stays the source of truth for hashing. */
export function parseResult(resultJson: string | null): CompactResult | null {
  if (!resultJson) return null;
  try {
    const parsed = compactResultSchema.safeParse(JSON.parse(resultJson));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export interface RankedBid {
  /** Position in the ranking, 1-based. */
  rank: number;
  /** Index into the frozen bid set, which is what the result refers to. */
  bidIndex: number;
  bid: BidView | null;
  totalBp: number;
  flags: FlagName[];
  awarded: boolean;
}

/**
 * The ranking, joined to the bids it refers to.
 *
 * The result's `rk` entries are indexes into the **frozen** bid set, in rank order. Frozen slots
 * are the ones that were active at close, so the join goes through `frozen.slots`, not through
 * the slot number and not through the position in `get_bids`. A withdrawn bid leaves a gap in
 * the slots, and reading the two as the same list would attribute a score to the wrong bidder.
 */
export function rankedBids(
  result: CompactResult | null,
  bids: BidView[],
  frozenSlots: number[] | null,
  award: Award | null,
): RankedBid[] {
  if (!result) return [];
  const bySlot = new Map(bids.map((b) => [b.slot, b]));
  return result.rk.map(([bidIndex, totalBp, flagBits], position) => {
    const slot = frozenSlots?.[bidIndex];
    return {
      rank: position + 1,
      bidIndex,
      bid: slot === undefined ? null : (bySlot.get(slot) ?? null),
      totalBp,
      flags: decodeFlags(flagBits),
      awarded: award?.bid_index === bidIndex && award.approvals.length > 0,
    };
  });
}

/** Ranking rows for the table. The label names the bidder, because this page is public. */
export function rankingRows(ranked: RankedBid[]): RankingRow[] {
  return ranked.map((entry) => ({
    rank: entry.rank,
    label: entry.bid ? shortAccount(entry.bid.bidder) : `Bid ${entry.bidIndex + 1}`,
    note: entry.bid
      ? `Bid ${entry.bidIndex + 1}, slot ${entry.bid.slot}`
      : `Bid ${entry.bidIndex + 1}`,
    totalBp: entry.totalBp,
    outcome: entry.awarded ? "awarded" : entry.flags.length > 0 ? "flagged" : "ranked",
    flags: entry.flags,
  }));
}

/** Bids that count: everything submitted and not withdrawn. */
export function activeBids(tender: Tender, bids: BidView[]): BidView[] {
  const active = new Set(tender.active_slots);
  return bids.filter((b) => active.has(b.slot) && !b.withdrawn);
}

/** Whether this account already has a live bid on this tender. */
export function bidOf(bids: BidView[], accountId: string | null): BidView | null {
  if (!accountId) return null;
  return bids.find((b) => b.bidder === accountId && !b.withdrawn) ?? null;
}

/** The rubric's title, or a fallback that never pretends to be one. */
export function tenderTitle(rubric: Rubric | null, tenderId: number): string {
  return rubric?.title ?? `Tender ${tenderId}`;
}
