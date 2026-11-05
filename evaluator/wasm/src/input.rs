//! stdin JSON, exactly as the tender contract builds it (docs/04-evaluator.md §6, contract
//! `request_key` and `evaluate_input`). Unknown fields are refused: the contract is the only
//! author of this input.

use crate::error::RunError;
use serde::Deserialize;
use serde_json::Value;

pub enum Input {
    DerivePubkey(DerivePubkeyInput),
    Evaluate(EvaluateInput),
    /// T13 stubs: recognised, not implemented.
    Quote,
    PayoutStatus,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DerivePubkeyInput {
    pub action: String,
    pub contract_id: String,
    pub tender_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EvaluateInput {
    pub action: String,
    pub contract_id: String,
    pub tender_id: String,
    pub attempt: u8,
    pub rubric_json: String,
    pub bids_root: String,
    pub bids: Vec<InputBid>,
    pub committee: Vec<InputMember>,
    pub evaluator: InputEvaluator,
}

/// What the tender pinned at creation. The WASM cannot measure its own hash, so the bundle
/// records what the contract pinned and a verifier checks that against the attestation's
/// `executed_wasm_sha256` (docs/06 check 4, D-029). Self-reporting here is safe precisely
/// because the bundle is not the authority on what ran.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct InputEvaluator {
    pub wasm_sha256: String,
    pub source_tag: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct InputBid {
    pub index: usize,
    pub bidder: String,
    /// Nanoseconds as a decimal string (the contract's U64).
    pub submitted_at_ns: String,
    pub ciphertext_b64: String,
    pub debrief_pubkey: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct InputMember {
    pub account: String,
    pub pubkey: String,
}

pub fn parse(stdin: &[u8]) -> Result<Input, RunError> {
    let v: Value =
        serde_json::from_slice(stdin).map_err(|_| RunError::Input("stdin is not JSON"))?;
    let action = v
        .get("action")
        .and_then(Value::as_str)
        .ok_or(RunError::Input("no action"))?;
    match action {
        "derive_pubkey" => serde_json::from_value(v)
            .map(Input::DerivePubkey)
            .map_err(|_| RunError::Input("bad derive_pubkey input")),
        "evaluate" => serde_json::from_value(v)
            .map(Input::Evaluate)
            .map_err(|_| RunError::Input("bad evaluate input")),
        "quote" => Ok(Input::Quote),
        "payout_status" => Ok(Input::PayoutStatus),
        _ => Err(RunError::Input("unknown action")),
    }
}
