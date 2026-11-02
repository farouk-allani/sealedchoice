//! Compact on-chain result (reference.py `compact_result`): what the evaluator prints on
//! stdout and the contract stores verbatim. JCS bytes, at most 900 (OutLayer stdout limit).

use crate::merkle::{Hash, hex};
use crate::scoring::Evaluation;
use crate::{EvalError, jcs};
use serde_json::json;

pub const COMPACT_RESULT_MAX_BYTES: usize = 900;

pub fn compact_result(
    tender_id: &str,
    bids_root: &Hash,
    rubric_hash: &Hash,
    bundle_hash: &Hash,
    attempt: u8,
    ev: &Evaluation,
) -> Result<Vec<u8>, EvalError> {
    let rk: Vec<[u64; 3]> = ev
        .ranking
        .iter()
        .map(|&(i, t, f)| [i as u64, t, u64::from(f)])
        .collect();
    let obj = json!({
        "v": 1,
        "tid": tender_id,
        "root": hex(bids_root),
        "rubric": hex(rubric_hash),
        "bundle": hex(bundle_hash),
        "attempt": attempt,
        "status": ev.status.as_str(),
        "rk": rk,
    });
    let out = jcs(&obj)?;
    if out.len() > COMPACT_RESULT_MAX_BYTES {
        return Err(EvalError::ResultTooLarge(out.len()));
    }
    Ok(out)
}
