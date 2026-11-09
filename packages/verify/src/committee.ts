/**
 * Opening the committee report, and the award rules the contract will enforce.
 *
 * The report is encrypted once under a fresh key, and that key is ECIES-wrapped to each member
 * separately (D-024), so a committee of five stores one body rather than five copies of a 700 KB
 * document. A member unwraps their own copy of the key, opens the body and gets every bid's
 * debrief plus every decrypted proposal.
 *
 * `deviationOf` is here rather than in the page because the contract decides the same question in
 * `propose_award`, and a form that disagreed with it would let a member write a rationale the
 * contract then rejects, or omit one it then demands. Both are ported from the same rule.
 */
import { debriefSchema, evidenceBundleSchema } from "@tender/shared";
import type { Debrief } from "@tender/shared";
import {
  aesGcmDecrypt,
  bytesToHex,
  eciesDecrypt,
  fromBase64,
  publicKeyCompressed,
  sha256Hex,
} from "@tender/crypto";
import { FLAG } from "./scoring.ts";
import type { Evidence } from "./evidence.ts";
import { requireBundleCommitment } from "./bundle-commitment.ts";

export class CommitteeError extends Error {
  override name = "CommitteeError";
}

/** The contract's `MIN_DEVIATION_RATIONALE_CHARS`. Counted in code points, as Rust counts chars. */
export const MIN_DEVIATION_RATIONALE_CHARS = 20;

/** One bid as the committee sees it: its debrief, plus the proposal that produced it. */
export interface CommitteeBid {
  bidIndex: number;
  bidder: string;
  debrief: Debrief;
  /** The decrypted proposal, absent when the bid itself did not decrypt. */
  proposal: Record<string, unknown> | null;
}

export interface CommitteeReport {
  tenderId: string;
  status: "ok" | "needs_committee" | "no_eligible_bids";
  /** `[bid_index, total_bp, flags]` in rank order, as the accepted result stores it. */
  ranking: readonly (readonly number[])[];
  lowestEligiblePriceMinor: string | null;
  bids: CommitteeBid[];
  /** The bid the ranking puts first among eligible, non-lapsed entries, or null if there is none. */
  recommended: number | null;
}

export interface OpenCommitteeOptions {
  evidence: Evidence;
  /** The committee reader key, derived from the member's wallet signature. */
  secretKey: Uint8Array;
  /** Bid indices already lapsed, from the award on chain. They change what counts as a deviation. */
  lapsed?: readonly number[];
}

/**
 * Unwrap the member's copy of the body key, open the report and check it against the hash the
 * bundle published. Async because AES-GCM goes through `crypto.subtle`.
 */
export async function openCommitteeReport(o: OpenCommitteeOptions): Promise<CommitteeReport> {
  const e = o.evidence;
  if (e.bundle === null) {
    throw new CommitteeError("the evidence bundle for this tender could not be fetched");
  }
  requireBundleCommitment(e.bundle.bytes, e.resultText, CommitteeError);
  let bundle: ReturnType<typeof evidenceBundleSchema.parse>;
  try {
    bundle = evidenceBundleSchema.parse(JSON.parse(new TextDecoder().decode(e.bundle.bytes)));
  } catch (err) {
    throw new CommitteeError(`the bundle did not parse: ${String(err).slice(0, 140)}`);
  }

  const report = bundle.committee_report;
  const myPubkey = bytesToHex(publicKeyCompressed(o.secretKey));
  const entry = report.keys.find((k) => k.recipient_pubkey === myPubkey);
  if (entry === undefined) {
    throw new CommitteeError(
      "no key in this report is addressed to your committee key. A reader key is bound to the account that " +
        "signed, so this usually means the wallet signed with an account that is not on this committee",
    );
  }
  if (entry.ecies_b64 === "") {
    throw new CommitteeError(`the report was not encrypted for you: ${entry.error ?? "no envelope was written"}`);
  }

  let bodyKey: Uint8Array;
  try {
    bodyKey = eciesDecrypt(o.secretKey, fromBase64(entry.ecies_b64));
  } catch {
    throw new CommitteeError("the envelope addressed to your key did not decrypt under it");
  }
  const plaintext = await aesGcmDecrypt(bodyKey, fromBase64(report.body_b64));
  bodyKey.fill(0);
  if (sha256Hex(plaintext) !== report.plaintext_sha256) {
    throw new CommitteeError("the report opened, but its bytes do not hash to the value the bundle published");
  }

  let parsed: {
    tender_id: string;
    status: CommitteeReport["status"];
    rk: number[][];
    lowest_eligible_price_minor?: string | null;
    bids: { bid_index: number; proposal_b64?: string }[];
  };
  try {
    parsed = JSON.parse(new TextDecoder().decode(plaintext)) as typeof parsed;
  } catch (err) {
    throw new CommitteeError(`the decrypted report is not JSON: ${String(err).slice(0, 140)}`);
  }

  const bidderOf = frozenBidders(e);
  const bids: CommitteeBid[] = parsed.bids.map((raw) => {
    const debrief = debriefSchema.parse(raw);
    let proposal: Record<string, unknown> | null = null;
    if (raw.proposal_b64 !== undefined && raw.proposal_b64 !== "") {
      try {
        proposal = JSON.parse(new TextDecoder().decode(fromBase64(raw.proposal_b64))) as Record<string, unknown>;
      } catch {
        proposal = null;
      }
    }
    return {
      bidIndex: debrief.bid_index,
      bidder: bidderOf[debrief.bid_index] ?? `bid ${debrief.bid_index}`,
      debrief,
      proposal,
    };
  });

  return {
    tenderId: parsed.tender_id,
    status: parsed.status,
    ranking: parsed.rk,
    lowestEligiblePriceMinor: parsed.lowest_eligible_price_minor ?? null,
    bids,
    recommended: recommendedOf(parsed.rk, o.lapsed ?? []),
  };
}

/** Frozen index to account id, which is what `bid_index` indexes (D-033). */
function frozenBidders(e: Evidence): Record<number, string> {
  const out: Record<number, string> = {};
  if (e.frozen === null) return out;
  const bySlot = new Map(e.bids.map((b) => [b.slot, b]));
  e.frozen.slots.forEach((slot, i) => {
    const bid = bySlot.get(slot);
    if (bid !== undefined) out[i] = bid.bidder;
  });
  return out;
}

/**
 * The bid `propose_award` treats as the natural winner: the first entry of the stored ranking that
 * is eligible and has not lapsed. After a lapse the next bid is the natural winner, so awarding it
 * is not a deviation.
 */
export function recommendedOf(
  ranking: readonly (readonly number[])[],
  lapsed: readonly number[],
): number | null {
  for (const entry of ranking) {
    const index = entry[0];
    const flags = entry[2];
    if (index === undefined || flags === undefined) continue;
    if ((flags & FLAG.INELIGIBLE) !== 0) continue;
    if (lapsed.includes(index)) continue;
    return index;
  }
  return null;
}

export interface AwardIntent {
  bidIndex: number;
  /** Minor units, as the contract takes them. */
  amountMinor: bigint;
  rationale: string;
}

export interface AwardCheck {
  /** True when the contract will record this as a deviation and demand a rationale. */
  deviation: boolean;
  /** Reasons the contract would refuse this outright, with its error code. */
  errors: string[];
}

/**
 * What `propose_award` will do with this intent, decided by the same rules the contract uses, so
 * the form never asks for a rationale the contract does not want, nor omits one it does.
 */
export function checkAward(
  intent: AwardIntent,
  o: {
    ranking: readonly (readonly number[])[];
    budgetCapMinor: bigint;
    lapsed?: readonly number[];
  },
): AwardCheck {
  const lapsed = o.lapsed ?? [];
  const errors: string[] = [];
  const entry = o.ranking.find((r) => r[0] === intent.bidIndex);
  if (entry === undefined) errors.push("E_NO_SUCH_BID: that bid is not in the accepted result");
  else if (((entry[2] ?? 0) & FLAG.INELIGIBLE) !== 0) {
    errors.push("E_BID_INELIGIBLE: code refused this bid, and the contract will not award it whatever the committee says");
  }
  if (lapsed.includes(intent.bidIndex)) {
    errors.push("E_BID_LAPSED: this bid was awarded before and the winner did not accept in time");
  }
  if (intent.amountMinor <= 0n) errors.push("E_BAD_AMOUNT: the amount must be above zero");
  else if (intent.amountMinor > o.budgetCapMinor) {
    errors.push("E_BAD_AMOUNT: the amount is above the budget cap the tender escrowed");
  }

  const deviation = recommendedOf(o.ranking, lapsed) !== intent.bidIndex;
  if (deviation && [...intent.rationale].length < MIN_DEVIATION_RATIONALE_CHARS) {
    errors.push(
      `E_RATIONALE_REQUIRED: awarding anything but the top eligible bid needs a rationale of at least ${MIN_DEVIATION_RATIONALE_CHARS} characters`,
    );
  }
  return { deviation, errors };
}
