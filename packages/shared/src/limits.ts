// Limits shared by the contract (docs/03-contract.md "Constants"), the evaluator
// (docs/04-evaluator.md) and the browser. Change them in the docs first.

/** Bids per tender (OutLayer input size and time budget; D-007). */
export const MAX_BIDS = 5;
/** Decoded ciphertext bytes accepted by `submit_bid`. */
export const MAX_CIPHERTEXT_BYTES = 4500;
/** ECIES overhead: ephemeral public key 65 + nonce 16 + tag 16. */
export const ECIES_OVERHEAD_BYTES = 97;
/** First run plus two retries (D-004). */
export const MAX_ATTEMPTS = 3;
export const MAX_RATIONALE_CHARS = 1000;
export const MIN_DEVIATION_RATIONALE_CHARS = 20;
/** OutLayer stdout limit for the compact result. */
export const COMPACT_RESULT_MAX_BYTES = 900;
/** Ranking entries a compact result may hold (compact-result.schema.json). */
export const COMPACT_RESULT_MAX_ENTRIES = 8;

/** UTF-8 byte limits of the bid's text fields (reference.py LIMITS). */
export const TEXT_LIMITS_BYTES = {
  methodology: 2000,
  track_record: 1200,
} as const;

/** Scores are basis points; 10000 = 100.00 %. */
export const BP = 10_000;
/** Qualitative scores are integers 0..5. */
export const QUAL_MAX = 5;

/** Largest evidence bundle the bundle store accepts (T06). ⚠️ Check against real bundles at T05/T07
 * (attestation reports dominate their size). */
export const MAX_BUNDLE_BYTES = 2 * 1024 * 1024;
