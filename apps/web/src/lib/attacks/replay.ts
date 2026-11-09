import { z } from "zod";
import { compactResultSchema, FLAGS, type AttackRecord } from "@tender/shared";
import { CONTRACT_ID, NETWORK } from "../../config/demo.ts";
import { ATTACKS } from "../../config/attacks.ts";
import { viewCall } from "../near/rpc.ts";
import type { FunctionCallAction } from "../wallet/wallet-provider.tsx";

const tenderSchema = z.object({ status: z.string(), deadline_ns: z.string(), bond: z.string(),
  committee: z.array(z.object({ account: z.string() })) });
const bidsSchema = z.array(z.object({ slot: z.number().int(), bidder: z.string(), withdrawn: z.boolean(), debrief_pubkey: z.string() }));

/** Verify prerequisites before opening a wallet, so another refusal is never mislabelled. */
export async function prepareAttackReplay(record: AttackRecord, tenderId: number, account: string): Promise<FunctionCallAction> {
  if (NETWORK !== ATTACKS.network || CONTRACT_ID !== ATTACKS.contract_id) throw new Error("Select the recorded testnet deployment to run these attempts.");
  if (!Number.isSafeInteger(tenderId) || tenderId < 0) throw new Error("Enter a tender number.");
  if (!record.method || [1, 11].includes(record.id)) throw new Error("Use the recorded execution evidence for this attempt.");
  if (account === CONTRACT_ID) throw new Error("Use an ordinary testnet account for these attempts.");
  const args: Record<string, unknown> = { tender_id: tenderId };
  let deposit = "0";
  const read = <T>(method: string, schema: z.ZodType<T>, extra = {}) => viewCall({
    contractId: CONTRACT_ID, method, schema, args: { ...args, ...extra },
  });
  const tender = await read("get_tender", tenderSchema);
  const member = tender.committee.some((c) => c.account === account);
  if ([4, 5].includes(record.id)) {
    if (tender.status !== "Open" || BigInt(tender.deadline_ns) <= BigInt(Date.now()) * 1_000_000n) {
      throw new Error("This attempt needs an open tender before its deadline. Choose an open tender above.");
    }
  }
  if (record.id === 5) {
    const bids = await read("get_bids", bidsSchema);
    if (bids.some((b) => b.bidder === account && !b.withdrawn)) throw new Error("Use an account that has no active bid in this tender.");
    if (bids.filter((b) => !b.withdrawn).length >= 5) throw new Error("This tender has no free bid slot.");
    const source = bids.find((b) => !b.withdrawn);
    if (!source) throw new Error("This tender needs a submitted bid to copy.");
    args.ciphertext_b64 = await read("get_bid_ciphertext", z.string(), { slot: source.slot });
    args.debrief_pubkey = source.debrief_pubkey;
    deposit = String(BigInt(tender.bond) + 100_000_000_000_000_000_000_000n);
  }
  if (record.id === 6) args.attempt = 1;
  if (record.id === 7 && !["Evaluated", "Awarded", "PayingOut", "Paid", "ClosedNoAward"].includes(tender.status)) {
    throw new Error("This attempt needs a tender with an accepted evaluation.");
  }
  if (record.id === 8) {
    if (member) throw new Error("Use an account outside this tender's committee.");
    Object.assign(args, { bid_index: 0, amount: "1", rationale: "" });
  }
  if (record.id === 9) {
    if (!member) throw new Error("This attempt must be signed by a committee member.");
    if (tender.status !== "Evaluated") throw new Error("This attempt needs an evaluated tender awaiting an award.");
    const result = compactResultSchema.parse(JSON.parse(await read("get_result", z.string())));
    const eligible = result.rk.filter((row) => !(row[2] & FLAGS.INELIGIBLE.value));
    const award = await read("get_award", z.object({ lapsed: z.array(z.number()) }).nullable());
    const choices = eligible.filter((row) => !award?.lapsed.includes(row[0]));
    if (choices.length < 2) throw new Error("This attempt needs two eligible bids that have not lapsed.");
    Object.assign(args, { bid_index: choices[1]?.[0], amount: "1", rationale: "" });
  }
  if (record.id === 10) {
    if (tender.status !== "Awarded") throw new Error("This attempt needs an award awaiting the winner's acceptance.");
    const award = await read("get_award", z.object({ bid_index: z.number(), accept_by_ns: z.string() }));
    if (BigInt(award.accept_by_ns) <= BigInt(Date.now()) * 1_000_000n) throw new Error("This award's acceptance window has passed.");
    const frozen = await read("get_frozen", z.object({ slots: z.array(z.number()) }));
    const bids = await read("get_bids", bidsSchema);
    if (bids.find((b) => b.slot === frozen.slots[award.bid_index])?.bidder === account) {
      throw new Error("Use an account other than the awarded bidder.");
    }
    args.payout = { Near: { account } };
  }
  return { methodName: record.method, args, gas: "100000000000000", deposit };
}
