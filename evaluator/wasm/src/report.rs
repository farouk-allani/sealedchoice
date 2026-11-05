//! What one evaluation publishes besides the compact result (docs/06-evidence-and-verification.md):
//! - per bid, a debrief (debrief.schema.json) encrypted to the bid's `debrief_pubkey`;
//! - one committee report: every bid's debrief plus its decrypted proposal. Its body is encrypted
//!   once, with AES-256-GCM under a fresh key, and each committee member gets an ECIES envelope
//!   holding only that 32-byte key (D-024). So the report's size does not grow with the
//!   committee;
//! - the public bundle (evidence-bundle.schema.json): no plaintext, no prices, no other bidder's
//!   criterion scores. `bundle_hash = sha256(JCS(bundle))`.
//!
//! Proposals go into the committee report as base64 of the decrypted bytes, never as embedded JSON:
//! a bidder controls those bytes, and a float or non-ASCII key inside them would make JCS refuse
//! and fail the whole run.

use crate::error::RunError;
use crate::input::EvaluateInput;
use crate::services::{ModelFailure, ModelReply, ServiceError};
use aes_gcm::aead::Aead;
use aes_gcm::{Aes256Gcm, KeyInit, Nonce};
use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use evaluator_core::merkle::{Hash, hex, sha256};
use evaluator_core::{Evaluation, jcs};
use serde_json::{Map, Value, json};
use zeroize::Zeroizing;

/// Name of the committee report's body cipher in the bundle.
pub const REPORT_CIPHER: &str = "aes-256-gcm";
/// AES-GCM nonce length of the committee report body (the WebCrypto default).
pub const REPORT_NONCE_BYTES: usize = 12;

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
    pub outcome: Result<ModelReply, ModelFailure>,
    pub signature: Result<Value, ServiceError>,
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
            outcome: Ok(reply),
            signature,
        }
    }

    pub fn failed(bid_index: usize, model: &str, failure: ModelFailure) -> Self {
        CallRecord {
            bid_index,
            model: model.to_string(),
            outcome: Err(failure),
            signature: Err(ServiceError("no answer")),
        }
    }

    fn chat_id(&self) -> &str {
        self.outcome.as_ref().map_or("", |r| r.chat_id.as_str())
    }

    fn bytes(&self) -> (&[u8], &[u8]) {
        match &self.outcome {
            Ok(r) => (&r.request, &r.response),
            Err(f) => (&f.request, &f.response),
        }
    }

    /// Public entry (evidence-bundle.schema.json `model_calls`): hashes, never the bytes. A failed
    /// call keeps its attempts and the hashes of what was exchanged, plus `error` (and
    /// `http_status`); a missing signature leaves its fields empty and says so in `error`.
    fn public(&self) -> Value {
        let empty_signature =
            json!({"text": "", "signature": "", "signing_address": "", "signing_algo": ""});
        let (request, response) = self.bytes();
        let attempts = match &self.outcome {
            Ok(r) => r.attempts,
            Err(f) => f.attempts,
        };
        let mut entry = json!({
            "bid_index": self.bid_index,
            "model": self.model,
            "chat_id": self.chat_id(),
            "attempts": attempts,
            "request_sha256": hex(&sha256(request)),
            "response_sha256": hex(&sha256(response)),
            "signature": self.signature.as_ref().map_or(empty_signature, Clone::clone),
        });
        if let Some(o) = entry.as_object_mut() {
            match (&self.outcome, &self.signature) {
                (Err(f), _) => {
                    o.insert("error".into(), Value::String(format!("call: {}", f.reason)));
                    if let Some(s) = f.http_status {
                        o.insert("http_status".into(), json!(s));
                    }
                }
                (Ok(_), Err(e)) => {
                    o.insert("error".into(), Value::String(format!("signature: {}", e.0)));
                }
                (Ok(_), Ok(_)) => {}
            }
        }
        entry
    }

    /// Private entry (debrief `raw_calls`): the exact bytes, failed calls included.
    fn raw(&self) -> Value {
        let (request, response) = self.bytes();
        json!({
            "model": self.model,
            "chat_id": self.chat_id(),
            "request_b64": STANDARD.encode(request),
            "response_b64": STANDARD.encode(response),
        })
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

/// ECIES envelope to a compressed secp256k1 public key (hex), eciesjs/eciespy format, added to
/// `fields`. The contract checks only the key's format, so a key off the curve can reach us: that
/// envelope is written empty with `"error":"E_READER_KEY"` instead of failing the run, so neither
/// a bidder nor the buyer can make every attempt fail with a bad reader key.
fn envelope(fields: Value, pubkey_hex: &str, plaintext: &[u8]) -> Value {
    let sealed = decode_hex(pubkey_hex).and_then(|pk| ecies::encrypt(&pk, plaintext).ok());
    let mut entry = fields;
    if let Some(o) = entry.as_object_mut() {
        o.insert(
            "recipient_pubkey".into(),
            Value::String(pubkey_hex.to_string()),
        );
        o.insert(
            "plaintext_sha256".into(),
            Value::String(hex(&sha256(plaintext))),
        );
        match sealed {
            Some(ct) => {
                o.insert("ecies_b64".into(), Value::String(STANDARD.encode(ct)));
            }
            None => {
                o.insert("ecies_b64".into(), Value::String(String::new()));
                o.insert("error".into(), Value::String("E_READER_KEY".into()));
            }
        }
    }
    entry
}

/// The committee report, encrypted once: `body_b64` = base64(nonce(12) || AES-256-GCM(key, nonce,
/// report, no AAD)), the ciphertext with its 16-byte tag appended (what WebCrypto's AES-GCM
/// produces). Each member's envelope holds only the 32-byte key, ECIES-encrypted to their reader
/// key; a bad reader key gets `E_READER_KEY` like a debrief does.
fn seal_report(c: &Context<'_>, report_plain: &[u8]) -> Result<Value, RunError> {
    let mut key = Zeroizing::new([0u8; 32]);
    let mut nonce = [0u8; REPORT_NONCE_BYTES];
    getrandom::getrandom(key.as_mut_slice())
        .and_then(|()| getrandom::getrandom(&mut nonce))
        .map_err(|_| RunError::Service("no randomness for the committee report"))?;
    let cipher = Aes256Gcm::new_from_slice(key.as_slice())
        .map_err(|_| RunError::Scoring("committee report key"))?;
    let nonce_arr =
        Nonce::try_from(&nonce[..]).map_err(|_| RunError::Scoring("committee report nonce"))?;
    let sealed = cipher
        .encrypt(&nonce_arr, report_plain)
        .map_err(|_| RunError::Scoring("committee report encryption"))?;
    let mut body = nonce.to_vec();
    body.extend_from_slice(&sealed);
    let keys: Vec<Value> = c
        .input
        .committee
        .iter()
        .map(|m| {
            let mut entry = envelope(json!({"member": m.account}), &m.pubkey, key.as_slice());
            // The envelope's plaintext is the key: never publish its hash.
            if let Some(o) = entry.as_object_mut() {
                o.remove("plaintext_sha256");
            }
            entry
        })
        .collect();
    Ok(json!({
        "cipher": REPORT_CIPHER,
        "body_b64": STANDARD.encode(body),
        "plaintext_sha256": hex(&sha256(report_plain)),
        "keys": keys,
    }))
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
            .map(CallRecord::raw)
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
        debriefs.push(envelope(
            json!({"bid_index": b.index}),
            &b.debrief_pubkey,
            &jcs(d)?,
        ));
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
    let committee_report = seal_report(c, &report_plain)?;

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
    // The tag the tender pinned, not this build's own: they must agree, and a verifier that
    // finds them different has found a mismatch worth seeing (D-029). `SOURCE_TAG` stays the
    // build's own identity and is compared in a test.
    evaluator.insert(
        "source_tag".into(),
        Value::String(c.input.evaluator.source_tag.clone()),
    );
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
