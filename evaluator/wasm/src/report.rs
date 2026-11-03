//! What one evaluation publishes besides the compact result (docs/06-evidence-and-verification.md):
//! - per bid, a debrief (debrief.schema.json) encrypted to the bid's `debrief_pubkey`;
//! - one committee report, encrypted once per committee member: every bid's debrief plus its
//!   decrypted proposal;
//! - the public bundle (evidence-bundle.schema.json): no plaintext, no prices, no other bidder's
//!   criterion scores. `bundle_hash = sha256(JCS(bundle))`.
//!
//! Proposals go into the committee report as base64 of the decrypted bytes, never as embedded JSON:
//! a bidder controls those bytes, and a float or non-ASCII key inside them would make JCS refuse
//! and fail the whole run.

use crate::error::RunError;
use crate::input::EvaluateInput;
use crate::services::{ModelReply, ServiceError};
use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use evaluator_core::merkle::{Hash, hex, sha256};
use evaluator_core::{Evaluation, jcs};
use serde_json::{Map, Value, json};

/// Where the published source lives (docs/06 check 4). ⚠️ T14 fixes the public repository and
/// the release tag the reproducible build is made from.
pub const SOURCE_REPO: &str = "https://github.com/farouk-allani/sealedchoice";
pub const SOURCE_TAG: &str = concat!("evaluator-v", env!("CARGO_PKG_VERSION"));

/// One bid as the reports need it.
pub struct BidRecord {
    pub index: usize,
    pub bidder: String,
    pub leaf: Hash,
    pub ciphertext_sha256: Hash,
    pub debrief_pubkey: String,
    /// Decrypted bytes (None: did not decrypt). Only ever written inside committee envelopes.
    pub plaintext: Option<Vec<u8>>,
}

/// One model call, answered or failed.
pub struct CallRecord {
    pub bid_index: usize,
    pub model: String,
    pub reply: Option<ModelReply>,
    pub signature: Result<Value, ServiceError>,
    pub error: Option<&'static str>,
}

impl CallRecord {
    pub fn answered(
        bid_index: usize,
        model: &str,
        reply: ModelReply,
        signature: Result<Value, ServiceError>,
    ) -> Self {
        CallRecord {
            bid_index,
            model: model.to_string(),
            reply: Some(reply),
            signature,
            error: None,
        }
    }

    pub fn failed(bid_index: usize, model: &str, e: ServiceError) -> Self {
        CallRecord {
            bid_index,
            model: model.to_string(),
            reply: None,
            signature: Err(ServiceError("no call")),
            error: Some(e.0),
        }
    }

    /// Public entry (evidence-bundle.schema.json `model_calls`): hashes, never the bytes.
    fn public(&self) -> Value {
        let empty_signature =
            json!({"text": "", "signature": "", "signing_address": "", "signing_algo": ""});
        let mut entry = match &self.reply {
            Some(r) => json!({
                "bid_index": self.bid_index,
                "model": self.model,
                "chat_id": r.chat_id,
                "attempts": r.attempts,
                "request_sha256": hex(&sha256(&r.request)),
                "response_sha256": hex(&sha256(&r.response)),
                "signature": self.signature.as_ref().map_or(empty_signature.clone(), Clone::clone),
            }),
            None => json!({
                "bid_index": self.bid_index,
                "model": self.model,
                "chat_id": "",
                "attempts": 0,
                "request_sha256": hex(&sha256(b"")),
                "response_sha256": hex(&sha256(b"")),
                "signature": empty_signature,
            }),
        };
        let error = match (&self.error, &self.signature) {
            (Some(e), _) => Some(format!("call: {e}")),
            (None, Err(e)) => Some(format!("signature: {}", e.0)),
            (None, Ok(_)) => None,
        };
        if let (Some(e), Some(o)) = (error, entry.as_object_mut()) {
            o.insert("error".into(), Value::String(e));
        }
        entry
    }

    /// Private entry (debrief `raw_calls`): the exact bytes.
    fn raw(&self) -> Option<Value> {
        let r = self.reply.as_ref()?;
        Some(json!({
            "model": self.model,
            "chat_id": r.chat_id,
            "request_b64": STANDARD.encode(&r.request),
            "response_b64": STANDARD.encode(&r.response),
        }))
    }
}

pub struct Context<'a> {
    pub input: &'a EvaluateInput,
    pub ev: &'a Evaluation,
    pub bids: &'a [BidRecord],
    pub calls: &'a [CallRecord],
    pub root: &'a Hash,
    pub rubric_hash: &'a Hash,
    pub prompt_hash: String,
    pub wasm_sha256: String,
    pub request_id: Value,
    pub block_height: Option<u64>,
    pub attestation: Value,
}

pub struct Built {
    /// The compact result without `bundle` (what `bundle.result` holds).
    pub result: Value,
    pub bundle_bytes: Vec<u8>,
    pub bundle_hash: Hash,
}

/// ECIES envelope to a compressed secp256k1 public key (hex): eciesjs/eciespy format.
fn envelope(pubkey_hex: &str, plaintext: &[u8]) -> Result<(String, String), RunError> {
    let pk = decode_hex(pubkey_hex).ok_or(RunError::Envelope("reader key is not hex"))?;
    let ct = ecies::encrypt(&pk, plaintext).map_err(|_| RunError::Envelope("encrypt"))?;
    Ok((STANDARD.encode(ct), hex(&sha256(plaintext))))
}

fn decode_hex(s: &str) -> Option<Vec<u8>> {
    if !s.len().is_multiple_of(2) {
        return None;
    }
    (0..s.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(s.get(i..i + 2)?, 16).ok())
        .collect()
}

pub fn build(c: &Context<'_>) -> Result<Built, RunError> {
    let n = c.bids.len();
    // Rank = 1-based position in the published ranking.
    let mut rank = vec![0usize; n];
    for (pos, &(index, _, _)) in c.ev.ranking.iter().enumerate() {
        if let Some(r) = rank.get_mut(index) {
            *r = pos + 1;
        }
    }
    let rk: Vec<[u64; 3]> =
        c.ev.ranking
            .iter()
            .map(|&(i, t, f)| [i as u64, t, u64::from(f)])
            .collect();
    let result = json!({
        "v": 1,
        "tid": c.input.tender_id,
        "root": hex(c.root),
        "rubric": hex(c.rubric_hash),
        "attempt": c.input.attempt,
        "status": c.ev.status.as_str(),
        "rk": rk,
    });

    // Debrief per bid, from the scoring core's own output.
    let mut debriefs_plain: Vec<Value> = Vec::with_capacity(n);
    for (b, r) in c.bids.iter().zip(&c.ev.bids) {
        let raw_calls: Vec<Value> = c
            .calls
            .iter()
            .filter(|k| k.bid_index == b.index)
            .filter_map(CallRecord::raw)
            .collect();
        debriefs_plain.push(json!({
            "v": 1,
            "tender_id": c.input.tender_id,
            "bid_index": b.index,
            "eligible": r.eligible,
            "ineligible_reasons": r.reasons,
            "flags": r.flags,
            "criteria": serde_json::to_value(&r.criteria).map_err(|_| RunError::Scoring("criteria"))?,
            "total_bp": r.total_bp,
            "rank": rank[b.index],
            "of": n,
            "raw_calls": raw_calls,
        }));
    }
    let mut debriefs = Vec::with_capacity(n);
    for (b, d) in c.bids.iter().zip(&debriefs_plain) {
        let (ecies_b64, plaintext_sha256) = envelope(&b.debrief_pubkey, &jcs(d)?)?;
        debriefs.push(json!({
            "bid_index": b.index,
            "recipient_pubkey": b.debrief_pubkey,
            "ecies_b64": ecies_b64,
            "plaintext_sha256": plaintext_sha256,
        }));
    }

    // Committee report: every debrief plus the decrypted proposal, encrypted per member.
    let report_bids: Vec<Value> = c
        .bids
        .iter()
        .zip(&debriefs_plain)
        .map(|(b, d)| {
            let mut entry = d.clone();
            if let (Some(o), Some(p)) = (entry.as_object_mut(), &b.plaintext) {
                o.insert("proposal_b64".into(), Value::String(STANDARD.encode(p)));
            }
            entry
        })
        .collect();
    let report_plain = jcs(&json!({
        "v": 1,
        "tender_id": c.input.tender_id,
        "status": c.ev.status.as_str(),
        "rk": result["rk"],
        "lowest_eligible_price_minor": c.ev.lowest_eligible_price_minor,
        "bids": report_bids,
    }))?;
    let mut committee_report = Vec::with_capacity(c.input.committee.len());
    for m in &c.input.committee {
        let (ecies_b64, plaintext_sha256) = envelope(&m.pubkey, &report_plain)?;
        committee_report.push(json!({
            "member": m.account,
            "recipient_pubkey": m.pubkey,
            "ecies_b64": ecies_b64,
            "plaintext_sha256": plaintext_sha256,
        }));
    }

    // Public bundle.
    let bids: Vec<Value> = c
        .bids
        .iter()
        .zip(&c.ev.bids)
        .map(|(b, r)| {
            json!({
                "index": b.index,
                "bidder": b.bidder,
                "leaf": hex(&b.leaf),
                "ciphertext_sha256": hex(&b.ciphertext_sha256),
                "eligible": r.eligible,
                "ineligible_reasons": r.reasons,
                "flags": r.flags,
                "total_bp": r.total_bp,
                "rank": rank[b.index],
            })
        })
        .collect();
    let mut evaluator = Map::new();
    evaluator.insert("wasm_sha256".into(), Value::String(c.wasm_sha256.clone()));
    evaluator.insert("source_repo".into(), Value::String(SOURCE_REPO.into()));
    evaluator.insert("source_tag".into(), Value::String(SOURCE_TAG.into()));
    evaluator.insert("outlayer_request_id".into(), c.request_id.clone());
    evaluator.insert("attempt".into(), json!(c.input.attempt));
    if let Some(h) = c.block_height {
        evaluator.insert("near_block_height".into(), json!(h));
    }
    let bundle = json!({
        "v": 1,
        "tender_id": c.input.tender_id,
        "contract_id": c.input.contract_id,
        "evaluator": evaluator,
        "rubric_hash": hex(c.rubric_hash),
        "prompt_hash": c.prompt_hash,
        "bids_root": hex(c.root),
        "bids": bids,
        "model_calls": c.calls.iter().map(CallRecord::public).collect::<Vec<_>>(),
        "attestation": c.attestation,
        "result": result,
        "debriefs": debriefs,
        "committee_report": committee_report,
    });
    let bundle_bytes = jcs(&bundle)?;
    let bundle_hash = sha256(&bundle_bytes);
    Ok(Built {
        result,
        bundle_bytes,
        bundle_hash,
    })
}
