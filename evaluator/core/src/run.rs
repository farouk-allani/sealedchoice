//! Per-run values derived from the frozen bid-set root (reference.py "evaluation run"); vectors in
//! specs/test-vectors/evaluation-run.json.

use crate::merkle::{Hash, hex, sha256};

/// Nonce of the attestation fetch: `sha256(bids_root || u32le(attempt))`, hex (D-024).
pub fn attestation_nonce(bids_root: &Hash, attempt: u32) -> String {
    let mut bytes = Vec::with_capacity(36);
    bytes.extend_from_slice(bids_root);
    bytes.extend_from_slice(&attempt.to_le_bytes());
    hex(&sha256(&bytes))
}

/// Boundary of a bid's proposal in the user prompt: first 16 hex characters of
/// `sha256(bids_root || u32le(bid_index))` (specs/scoring-prompt.md).
pub fn prompt_boundary(bids_root: &Hash, bid_index: u32) -> String {
    let mut bytes = Vec::with_capacity(36);
    bytes.extend_from_slice(bids_root);
    bytes.extend_from_slice(&bid_index.to_le_bytes());
    let mut h = hex(&sha256(&bytes));
    h.truncate(16);
    h
}
