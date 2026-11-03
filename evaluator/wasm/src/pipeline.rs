//! The two actions (tasks/T05-evaluator-wasm.md step 3, docs/04-evaluator.md §2).
//!
//! `evaluate` order: sender check, attempt range, rubric (canonical JCS, hash, usable), bids and
//! Merkle root, execution facts, tender key, decryption, eligibility, attestation, model calls
//! (eligible bids only, prices never in a prompt), scoring core, debriefs and committee report,
//! bundle, bundle store, compact result. Any refusal before the bundle is stored prints no result.

use crate::env_names;
use crate::error::RunError;
use crate::input::{DerivePubkeyInput, EvaluateInput};
use crate::prompt::{self, PromptRubric};
use crate::report::{self, BidRecord, CallRecord};
use crate::services::{Environment, ModelRequest, PutOutcome, Services};
use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use evaluator_core::keys::{SecretKey, tender_key};
use evaluator_core::merkle::{Hash, hex, merkle_leaf, merkle_root, parse_hash, sha256};
use evaluator_core::scoring::{BidInput, check_eligibility, parse_model_output};
use evaluator_core::{Rubric, compact_result, jcs};
use serde_json::{Value, json};
use std::collections::BTreeMap;
use zeroize::{Zeroize, Zeroizing};

/// Proposal fields a qualitative criterion may show a model. Price, delivery and identity never
/// reach a prompt, whatever the rubric says (docs/04 stage 4).
pub const PROMPT_FIELDS: [&str; 2] = ["methodology", "track_record"];

/// The caller of `request_execution` must be the tender contract named in the input.
fn check_sender(env: &dyn Environment, contract_id: &str) -> Result<(), RunError> {
    match env.var(env_names::SENDER_ID) {
        Some(sender) if sender == contract_id => Ok(()),
        _ => Err(RunError::SenderMismatch),
    }
}

/// The master secret: 64 hex characters (OutLayer hex32 secret). Kept in zeroized buffers.
fn master_secret(env: &dyn Environment) -> Result<Zeroizing<Vec<u8>>, RunError> {
    let text = Zeroizing::new(
        env.var(env_names::MASTER_SECRET)
            .ok_or(RunError::Env("master secret not set"))?,
    );
    let lower = Zeroizing::new(text.trim().to_ascii_lowercase());
    let mut bytes =
        parse_hash(&lower).ok_or(RunError::Env("master secret is not 64 hex characters"))?;
    let secret = Zeroizing::new(bytes.to_vec());
    bytes.zeroize();
    Ok(secret)
}

fn derive_tender_key(
    env: &dyn Environment,
    contract_id: &str,
    tender_id: &str,
) -> Result<SecretKey, RunError> {
    let secret = master_secret(env)?;
    tender_key(&secret, contract_id, tender_id).ok_or(RunError::Env("tender key derivation failed"))
}

/// `{"pk":"02…","tid":"<id>","v":1}` (JCS): the tender's public key, never the private one.
pub fn derive_pubkey(
    input: &DerivePubkeyInput,
    env: &dyn Environment,
) -> Result<Vec<u8>, RunError> {
    check_sender(env, &input.contract_id)?;
    let sk = derive_tender_key(env, &input.contract_id, &input.tender_id)?;
    let pk = sk
        .public_compressed()
        .ok_or(RunError::Env("tender key derivation failed"))?;
    Ok(jcs(
        &json!({"v": 1, "tid": input.tender_id, "pk": hex(&pk)}),
    )?)
}

/// Nonce for the attestation fetch: `sha256(bids_root || u32le(attempt))`, hex (D-024).
pub fn attestation_nonce(root: &Hash, attempt: u8) -> String {
    let mut bytes = root.to_vec();
    bytes.extend_from_slice(&u32::from(attempt).to_le_bytes());
    hex(&sha256(&bytes))
}

/// A decrypted plaintext as the scoring core reads it: JSON via `parse_model_output` (D-020),
/// `null` when the bytes are not UTF-8 JSON (then the bid is `bad_version`).
pub fn parse_plaintext(bytes: &[u8]) -> Value {
    std::str::from_utf8(bytes)
        .map(parse_model_output)
        .unwrap_or(Value::Null)
}

fn field_text(plaintext: Option<&Value>, field: &str) -> String {
    plaintext
        .and_then(|p| p.get(field))
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string()
}

pub fn evaluate(
    input: &EvaluateInput,
    env: &dyn Environment,
    svc: &Services<'_>,
) -> Result<Vec<u8>, RunError> {
    check_sender(env, &input.contract_id)?;
    if !(1..=3).contains(&input.attempt) {
        return Err(RunError::Attempt);
    }

    // Rubric: canonical JCS (so its hash is the one the contract stored), usable, and every
    // qualitative criterion reads only text fields.
    let rubric_value: Value = serde_json::from_str(&input.rubric_json)
        .map_err(|_| RunError::Rubric("rubric_json is not JSON"))?;
    if jcs(&rubric_value).ok().as_deref() != Some(input.rubric_json.as_bytes()) {
        return Err(RunError::Rubric("rubric_json is not canonical JCS"));
    }
    let rubric_hash = sha256(input.rubric_json.as_bytes());
    let rubric: Rubric = serde_json::from_value(rubric_value.clone())
        .map_err(|_| RunError::Rubric("rubric fields"))?;
    let prompt_rubric: PromptRubric = serde_json::from_value(rubric_value)
        .map_err(|_| RunError::Rubric("rubric prompt fields"))?;
    if prompt_rubric
        .criteria
        .iter()
        .filter(|c| c.kind == "qualitative")
        .flat_map(|c| c.source_fields.iter())
        .any(|f| !PROMPT_FIELDS.contains(&f.as_str()))
    {
        return Err(RunError::Rubric(
            "a qualitative criterion reads a non-text field",
        ));
    }

    // Bids: indices 0..n-1, ciphertexts decode, leaves hash to the frozen root.
    if input.bids.is_empty() {
        return Err(RunError::Input("no bids"));
    }
    let mut ciphertexts = Vec::with_capacity(input.bids.len());
    let mut leaves = Vec::with_capacity(input.bids.len());
    for (i, b) in input.bids.iter().enumerate() {
        if b.index != i {
            return Err(RunError::Input("bid indices are not 0..n-1"));
        }
        let ct = STANDARD
            .decode(&b.ciphertext_b64)
            .map_err(|_| RunError::Input("ciphertext is not base64"))?;
        let at: u64 = b
            .submitted_at_ns
            .parse()
            .map_err(|_| RunError::Input("submitted_at_ns is not a u64"))?;
        leaves.push(merkle_leaf(&b.bidder, at, &ct).ok_or(RunError::Input("bidder"))?);
        ciphertexts.push(ct);
    }
    let root = merkle_root(&leaves)?;
    if parse_hash(&input.bids_root) != Some(root) {
        return Err(RunError::RootMismatch);
    }

    // What only OutLayer knows; asked before any work so a build without it stops here.
    let wasm_sha256 = svc
        .execution
        .wasm_sha256()
        .map_err(|e| RunError::Service(e.0))?;
    let request_id = svc
        .execution
        .request_id()
        .map_err(|e| RunError::Service(e.0))?;

    // Decrypt with the tender key; a ciphertext that does not decrypt is a DECRYPT_FAILED bid.
    let sk = derive_tender_key(env, &input.contract_id, &input.tender_id)?;
    let mut decrypted: Vec<Option<Vec<u8>>> = Vec::with_capacity(ciphertexts.len());
    let mut bid_inputs = Vec::with_capacity(ciphertexts.len());
    for (b, ct) in input.bids.iter().zip(&ciphertexts) {
        let plain = ecies::decrypt(sk.expose(), ct).ok();
        bid_inputs.push(BidInput {
            index: b.index,
            submitter: b.bidder.clone(),
            decrypt_ok: plain.is_some(),
            plaintext: plain.as_deref().map(parse_plaintext),
        });
        decrypted.push(plain);
    }
    drop(sk);

    // Eligibility first: only eligible bids are sent to a model.
    let mut eligible = Vec::new();
    for b in &bid_inputs {
        let (flags, _) = check_eligibility(&rubric, &input.tender_id, b)?;
        if flags & evaluator_core::flags::INELIGIBLE == 0 {
            eligible.push(b.index);
        }
    }

    // Attestation for this run's nonce (a failure is recorded, scoring goes on).
    let nonce_hex = attestation_nonce(&root, input.attempt);
    let attestation = match svc.attestation.reports(&nonce_hex, &rubric.models) {
        Ok(reports) => json!({"nonce_hex": nonce_hex, "reports": reports}),
        Err(e) => json!({"nonce_hex": nonce_hex, "reports": [], "error": e.0}),
    };

    // One call per (eligible bid, model), then its signature.
    let mut calls: Vec<CallRecord> = Vec::new();
    let mut outputs: BTreeMap<String, Vec<Value>> = BTreeMap::new();
    for &i in &eligible {
        let pt = bid_inputs[i].plaintext.as_ref();
        let user = prompt::render_user(
            &prompt_rubric,
            &prompt::boundary(
                &root,
                u32::try_from(i).map_err(|_| RunError::Input("index"))?,
            ),
            &|f| field_text(pt, f),
        )?;
        let mut per_model = Vec::with_capacity(rubric.models.len());
        for (m, model) in rubric.models.iter().enumerate() {
            let req = ModelRequest {
                bid_index: i,
                model_index: m,
                model,
                system: prompt::SYSTEM_TEMPLATE,
                user: &user,
            };
            match svc.models.complete(&req) {
                Ok(reply) => {
                    per_model.push(
                        reply
                            .content
                            .as_deref()
                            .map(parse_model_output)
                            .unwrap_or(Value::Null),
                    );
                    let signature = svc.signatures.signature(&reply.chat_id, model);
                    calls.push(CallRecord::answered(i, model, reply, signature));
                }
                Err(e) => {
                    per_model.push(Value::Null);
                    calls.push(CallRecord::failed(i, model, e));
                }
            }
        }
        outputs.insert(i.to_string(), per_model);
    }
    eprintln!(
        "evaluate: {} bids, {} eligible, {} model calls",
        bid_inputs.len(),
        eligible.len(),
        calls.len()
    );

    // Scoring: the same core as the vectors and the TS verifier.
    let ev = evaluator_core::evaluate(&rubric, &input.tender_id, &bid_inputs, &outputs)?;

    let bids: Vec<BidRecord> = input
        .bids
        .iter()
        .zip(&ciphertexts)
        .zip(&leaves)
        .zip(decrypted)
        .map(|(((b, ct), leaf), plain)| BidRecord {
            index: b.index,
            bidder: b.bidder.clone(),
            leaf: *leaf,
            ciphertext_sha256: sha256(ct),
            debrief_pubkey: b.debrief_pubkey.clone(),
            plaintext: plain,
        })
        .collect();
    let built = report::build(&report::Context {
        input,
        ev: &ev,
        bids: &bids,
        calls: &calls,
        root: &root,
        rubric_hash: &rubric_hash,
        prompt_hash: prompt::prompt_hash(),
        wasm_sha256,
        request_id,
        block_height: env
            .var(env_names::BLOCK_HEIGHT)
            .and_then(|h| h.parse::<u64>().ok()),
        attestation,
    })?;

    // No result without a stored bundle: one retry, then fail.
    let bundle_hex = hex(&built.bundle_hash);
    let mut outcome = svc.store.put_if_absent(&bundle_hex, &built.bundle_bytes);
    if outcome.is_err() {
        outcome = svc.store.put_if_absent(&bundle_hex, &built.bundle_bytes);
    }
    match outcome.map_err(|e| RunError::Service(e.0))? {
        PutOutcome::Created | PutOutcome::Exists => {}
        PutOutcome::Conflict => return Err(RunError::Service("bundle store holds other bytes")),
    }

    let out = compact_result(
        &input.tender_id,
        &root,
        &rubric_hash,
        &built.bundle_hash,
        input.attempt,
        &ev,
    )?;
    // The bundle carries the same result, minus its own hash.
    let mut check: Value =
        serde_json::from_slice(&out).map_err(|_| RunError::Scoring("compact result"))?;
    if let Some(o) = check.as_object_mut() {
        o.remove("bundle");
    }
    if check != built.result {
        return Err(RunError::Scoring(
            "bundle result differs from the compact result",
        ));
    }
    Ok(out)
}
