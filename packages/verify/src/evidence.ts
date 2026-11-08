/**
 * The public evidence a verifier needs, and the shapes it arrives in.
 *
 * Everything here is fetched before any check runs, so `runChecks` is a pure function of this
 * object. That is what lets the CLI and the `/tenders/<id>/verify` page run the same code: one
 * fetches with Node's global fetch, the other with the browser's, and both hand over the same
 * `Evidence` (docs/06-evidence-and-verification.md).
 *
 * Contract views are validated here rather than trusted, as the packages rule requires. The
 * schemas are deliberately `.loose()`: a contract that grows a field must not break a verifier
 * that a judge is running from an older clone.
 */
import { z } from "zod";

/** Numbers the contract serialises as strings because they do not fit a JS number. */
const u64 = z.union([z.string(), z.number()]).transform((v) => BigInt(v));

const HASH64 = /^[0-9a-f]{64}$/;
export const hash64 = z
  .string()
  .regex(HASH64, "expected 64 lowercase hex characters");

export const evaluatorRefSchema = z
  .object({
    wasm_url: z.string(),
    wasm_sha256: hash64,
    build_target: z.string().nullish(),
    source_tag: z.string().nullish(),
  })
  .loose();

export const tenderViewSchema = z
  .object({
    id: z.union([z.string(), z.number()]),
    buyer: z.string(),
    rubric_json: z.string(),
    rubric_hash: hash64,
    /**
     * Optional: contracts deployed before D-035 do not store it, and the verifier must keep
     * reading those tenders. Check 2 falls back to the deadline bound when it is absent.
     */
    created_at_ns: u64.nullish(),
    deadline_ns: u64,
    status: z.string(),
    evaluator: evaluatorRefSchema,
    committee: z
      .array(z.object({ account: z.string(), report_pubkey: z.string() }).loose())
      .default([]),
    bid_slots: z.number().int().nonnegative().default(0),
    active_slots: z.array(z.number().int().nonnegative()).default([]),
    result_json: z.string().nullish(),
  })
  .loose();

export const bidViewSchema = z
  .object({
    slot: z.number().int().nonnegative(),
    bidder: z.string(),
    submitted_at_ns: u64,
    ciphertext_sha256: hash64,
    ciphertext_len: z.number().int().nonnegative(),
    withdrawn: z.boolean(),
  })
  .loose();

export const frozenViewSchema = z
  .object({
    slots: z.array(z.number().int().nonnegative()),
    leaves: z.array(hash64),
    root: hash64,
  })
  .loose();

export const attemptViewSchema = z
  .object({
    n: z.number().int().positive(),
    started_at_ns: u64,
    // `Accepted` | `Pending` | `{ Failed: { reason } }`
    outcome: z.union([z.string(), z.record(z.string(), z.unknown())]),
  })
  .loose();

export const configViewSchema = z
  .object({ min_deadline_delay_ns: u64 })
  .loose();

export type TenderView = z.infer<typeof tenderViewSchema>;
export type BidView = z.infer<typeof bidViewSchema>;
export type FrozenView = z.infer<typeof frozenViewSchema>;
export type AttemptView = z.infer<typeof attemptViewSchema>;

/** Where a check can send a reader to look at the raw thing for themselves. */
export interface CheckLink {
  label: string;
  href: string;
}

export interface CheckResult {
  /** 1..10, matching the numbered checklist in docs/06. */
  id: number;
  name: string;
  pass: boolean;
  /** One line a human can read, naming the values compared. */
  details: string;
  links: CheckLink[];
  /**
   * True when the check could not reach a verdict from the evidence given, rather than finding
   * something wrong. A skipped check never passes, so the CLI still exits non-zero, but the
   * wording says "could not check" instead of accusing the tender.
   */
  skipped?: boolean;
}

/** Everything the ten checks read. Fetched once, then nothing does IO. */
export interface Evidence {
  network: string;
  contractId: string;
  tenderId: number;
  /** From `get_config`: lets check 2 bound the creation time from below. */
  minDeadlineDelayNs: bigint;
  tender: TenderView;
  bids: BidView[];
  frozen: FrozenView | null;
  attempts: AttemptView[];
  /** `get_result`, the exact string the contract stored. */
  resultText: string | null;
  /** The bundle exactly as the store served it, plus the ETag it came with. */
  bundle: { bytes: Uint8Array; etag: string | null; url: string } | null;
  /** slot number to base64 ciphertext, from `get_bid_ciphertext`. */
  ciphertexts: Record<number, string>;
  /** The deployed contract's code hash (base58), from `view_account`. */
  codeHash: string | null;
  /** Explorer base, for links in the results. */
  explorerBase: string;
}
