//! Pure scoring core of the evaluator. Spec: docs/04-evaluator.md; reference:
//! specs/reference/reference.py (function names kept where possible).
//!
//! No I/O, no clock, no randomness, no floats. Every public function is checked
//! against specs/test-vectors/*.json in `tests/vectors.rs`.

pub mod compact;
pub mod error;
pub mod jcs;
pub mod keys;
pub mod merkle;
pub mod run;
pub mod scoring;

pub use compact::{COMPACT_RESULT_MAX_BYTES, compact_result};
pub use error::EvalError;
pub use jcs::jcs;
pub use scoring::{BidInput, Evaluation, Rubric, Status, evaluate};

/// Basis points: 10000 = 100.00 %.
pub const BP: u64 = 10_000;
/// Qualitative scores are integers 0..=5.
pub const QUAL_MAX: u8 = 5;
/// Basis points per qualitative point.
pub const QUAL_BP_PER_POINT: u64 = BP / QUAL_MAX as u64;
/// Largest integer every implementation reads exactly (D-017).
pub const MAX_SAFE_INT: u64 = (1 << 53) - 1;

/// Flags bitmap (docs/04-evaluator.md stage 7).
pub mod flags {
    pub const INELIGIBLE: u32 = 1 << 0;
    pub const DECRYPT_FAILED: u32 = 1 << 1;
    pub const ACCOUNT_MISMATCH: u32 = 1 << 2;
    pub const INJECTION_SUSPECTED: u32 = 1 << 3;
    pub const DISAGREEMENT: u32 = 1 << 4;
    pub const EVIDENCE_MISSING: u32 = 1 << 5;
    pub const EVAL_INCOMPLETE: u32 = 1 << 6;
}
