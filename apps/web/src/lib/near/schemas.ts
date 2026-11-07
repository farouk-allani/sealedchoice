// Runtime shapes of the tender contract's view methods (contracts/tender/src/views.rs and
// types.rs), validated at the boundary (.claude/rules/packages.md).
//
// Two rules this file follows:
//
// 1. Amounts and nanosecond timestamps arrive as decimal **strings** (`U64`, `U128`, `NearToken`
//    all serialise that way) and stay strings here. Nanoseconds and yoctoNEAR both exceed
//    Number.MAX_SAFE_INTEGER, so nothing in the app may turn one into a number. Use the `big`
//    helpers below, which return bigint.
// 2. Objects are **not** strict. An unknown field means the contract gained one; ignoring it
//    shows a slightly old page, while rejecting it shows no page at all.
import { z } from "zod";

/** A u128/u64/NearToken as the chain serialises it. */
const decimalString = z.string().regex(/^[0-9]{1,40}$/, "must be a decimal integer string");
const hex64 = z.string().regex(/^[0-9a-f]{64}$/, "must be 64 lowercase hex characters");
const compressedPubkey = z
  .string()
  .regex(/^0[23][0-9a-f]{64}$/, "must be a 33-byte compressed secp256k1 point in hex");
const accountId = z.string().min(2).max(64);

export const STATUSES = [
  "PendingKey",
  "AwaitingFunds",
  "Open",
  "Cancelled",
  "NoBids",
  "Evaluating",
  "Evaluated",
  "EvalFailed",
  "Failed",
  "Awarded",
  "PayingOut",
  "Paid",
  "ClosedNoAward",
] as const;

export const statusSchema = z.enum(STATUSES);
export type Status = z.infer<typeof statusSchema>;

export const evaluatorRefSchema = z.object({
  wasm_url: z.string(),
  wasm_sha256: hex64,
  build_target: z.string(),
  source_tag: z.string(),
});

export const secretsRefSchema = z.object({ profile: z.string(), account_id: accountId });

export const committeeMemberSchema = z.object({
  account: accountId,
  report_pubkey: compressedPubkey,
});

export const frozenSchema = z.object({
  slots: z.array(z.int().nonnegative()),
  leaves: z.array(hex64),
  root: hex64,
});

/** Unit variants serialise as a bare string, data variants as `{ Variant: { .. } }`. */
export const attemptOutcomeSchema = z.union([
  z.literal("Pending"),
  z.literal("Accepted"),
  z.object({ Failed: z.object({ reason: z.string() }) }),
]);

export const attemptSchema = z.object({
  n: z.int().min(1),
  started_at_ns: decimalString,
  outcome: attemptOutcomeSchema,
});

export const payoutTargetSchema = z.union([
  z.object({ Near: z.object({ account: accountId }) }),
  z.object({ Intents: z.object({ destination_asset: z.string(), recipient: z.string() }) }),
]);

export const payoutStateSchema = z.union([
  z.literal("None"),
  z.literal("Paid"),
  z.literal("PayoutRefunded"),
  z.object({ PayingOut: z.object({ deposit_address: z.string().nullable() }) }),
  z.object({ PayoutFailed: z.object({ reason: z.string() }) }),
]);

export const awardSchema = z.object({
  bid_index: z.int().nonnegative().nullable(),
  amount: decimalString,
  rationale: z.string(),
  deviation: z.boolean(),
  approvals: z.array(accountId),
  approved_at_ns: decimalString.nullable(),
  accept_by_ns: decimalString.nullable(),
  lapsed: z.array(z.int().nonnegative()),
  payout: payoutTargetSchema.nullable(),
  payout_state: payoutStateSchema,
});

export const tenderSchema = z.object({
  id: z.int().nonnegative(),
  buyer: accountId,
  rubric_json: z.string(),
  rubric_hash: hex64,
  currency_token: accountId,
  budget_cap: decimalString,
  approvals_required: z.int().min(1),
  acceptance_window_ns: decimalString,
  deadline_ns: decimalString,
  bond: decimalString,
  committee: z.array(committeeMemberSchema),
  evaluator: evaluatorRefSchema,
  tender_pubkey: compressedPubkey.nullable(),
  escrowed: decimalString,
  eval_fee_remaining: decimalString,
  exec_deposit: decimalString,
  status: statusSchema,
  bid_slots: z.int().nonnegative(),
  active_slots: z.array(z.int().nonnegative()),
  frozen: frozenSchema.nullable(),
  attempts: z.array(attemptSchema),
  result_json: z.string().nullable(),
  award: awardSchema.nullable(),
});

export const bidViewSchema = z.object({
  slot: z.int().nonnegative(),
  bidder: accountId,
  submitted_at_ns: decimalString,
  ciphertext_sha256: hex64,
  ciphertext_len: z.int().nonnegative(),
  debrief_pubkey: compressedPubkey,
  bond: decimalString,
  withdrawn: z.boolean(),
  bond_settled: z.boolean(),
});

export const bidReceiptSchema = z.object({
  slot: z.int().nonnegative(),
  ciphertext_sha256: hex64,
  submitted_at_ns: decimalString,
});

export const configViewSchema = z.object({
  owner: accountId,
  outlayer: accountId,
  secrets_ref: secretsRefSchema,
  min_deadline_delay_ns: decimalString,
  next_tender_id: z.int().nonnegative(),
});

export type EvaluatorRef = z.infer<typeof evaluatorRefSchema>;
export type CommitteeMember = z.infer<typeof committeeMemberSchema>;
export type Frozen = z.infer<typeof frozenSchema>;
export type Attempt = z.infer<typeof attemptSchema>;
export type AttemptOutcome = z.infer<typeof attemptOutcomeSchema>;
export type PayoutTarget = z.infer<typeof payoutTargetSchema>;
export type PayoutState = z.infer<typeof payoutStateSchema>;
export type Award = z.infer<typeof awardSchema>;
export type Tender = z.infer<typeof tenderSchema>;
export type BidView = z.infer<typeof bidViewSchema>;
export type BidReceipt = z.infer<typeof bidReceiptSchema>;
export type ConfigView = z.infer<typeof configViewSchema>;

/** Name of an attempt's outcome, for display and for `switch`. */
export function attemptOutcomeName(outcome: AttemptOutcome): "Pending" | "Accepted" | "Failed" {
  return typeof outcome === "string" ? outcome : "Failed";
}

/** Reason an attempt failed, or null if it did not. */
export function attemptFailureReason(outcome: AttemptOutcome): string | null {
  return typeof outcome === "string" ? null : outcome.Failed.reason;
}

export function payoutStateName(
  state: PayoutState,
): "None" | "PayingOut" | "Paid" | "PayoutFailed" | "PayoutRefunded" {
  if (typeof state === "string") return state;
  return "PayingOut" in state ? "PayingOut" : "PayoutFailed";
}

/** Statuses in which a tender still accepts bids. */
export function acceptsBids(tender: Pick<Tender, "status">): boolean {
  return tender.status === "Open";
}

/** A tender nobody can act on any more. */
export function isFinal(tender: Pick<Tender, "status">): boolean {
  return (
    tender.status === "Paid" ||
    tender.status === "Cancelled" ||
    tender.status === "NoBids" ||
    tender.status === "ClosedNoAward" ||
    tender.status === "Failed"
  );
}
