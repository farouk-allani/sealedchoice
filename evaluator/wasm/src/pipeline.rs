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
use evaluator_core::scoring::{BidInput, check_eligibility, is_pos_int_str, parse_model_output};
use evaluator_core::{Rubric, compact_result, jcs};
use serde_json::{Value, json};
use std::collections::BTreeMap;
use zeroize::{Zeroize, Zeroizing};

/// Proposal fields a qualitative criterion may show a model. Price, delivery and identity never
/// reach a prompt, whatever the rubric says (docs/04 stage 4).
pub const PROMPT_FIELDS: [&str; 2] = ["methodology", "track_record"];

/// `^[a-z][a-z0-9_]{1,31}$` (rubric.schema.json; the price criterion's `"price"` matches).
pub fn is_criterion_id(id: &str) -> bool {
    let b = id.as_bytes();
    (2..=32).contains(&b.len())
        && b[0].is_ascii_lowercase()
        && b[1..]
            .iter()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || *c == b'_')
}

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

/// The contract makes at most this many attempts (contracts/tender `MAX_ATTEMPTS`, I12).
pub const LAST_ATTEMPT: u8 = 3;

/// A failed call that counts as unanswered for the outage rule (D-024): no HTTP response
/// (transport error, timeout), or 5xx / 429 after the one retry. Other statuses are the API
/// answering this request with a refusal.
pub fn is_outage(http_status: Option<u16>) -> bool {
    matches!(http_status, None | Some(429) | Some(500..=599))
}

/// A rubric the evaluator can run: both shapes it is read in, and its hash.
pub struct CheckedRubric {
    pub rubric: Rubric,
    pub prompt: PromptRubric,
    pub hash: Hash,
}

/// Every check the evaluator makes on a rubric, all before any service is called. The contract's
/// `create_tender` refuses every rubric this refuses (invariant I14, docs/03-contract.md), so a
/// tender that takes bids can be evaluated; a contract test runs both on the same rubrics.
///
/// - `rubric_json` is its own JCS form, so its hash is the one the contract stored;
/// - it reads as the scoring core's `Rubric` and as the prompt's `PromptRubric`;
/// - weights sum to 10000 and `budget_cap_minor` is a positive integer string;
/// - qualitative criteria read only text fields (AI never sees prices);
/// - every criterion id matches `^[a-z][a-z0-9_]{1,31}$` (rubric.schema.json): ids become keys
///   of the debrief's `criteria` object, and JCS refuses keys that are not ASCII;
/// - `min_valid_outputs` is 2 or 3 and at most the number of models. On attempts 1 and 2 the
///   outage rule means a published result has at least that many models answering each eligible
///   bid; on attempt 3 an unanswered bid is published as `EVAL_INCOMPLETE` instead of ending the
///   tender (D-024). What holds on every attempt is that no criterion is *scored* from fewer than
///   `min_valid_outputs` valid outputs: `score_qualitative` re-applies the parameter, and a failed
///   call contributes no valid output;
/// - the user template renders: every qualitative criterion has a question and anchors 0–5.
pub fn check_rubric(rubric_json: &str) -> Result<CheckedRubric, RunError> {
    let value: Value = serde_json::from_str(rubric_json)
        .map_err(|_| RunError::Rubric("rubric_json is not JSON"))?;
    if jcs(&value).ok().as_deref() != Some(rubric_json.as_bytes()) {
        return Err(RunError::Rubric("rubric_json is not canonical JCS"));
    }
    let rubric: Rubric =
        serde_json::from_value(value.clone()).map_err(|_| RunError::Rubric("rubric fields"))?;
    let prompt: PromptRubric =
        serde_json::from_value(value).map_err(|_| RunError::Rubric("rubric prompt fields"))?;
    let weights = rubric
        .criteria
        .iter()
        .try_fold(0u64, |acc, c| acc.checked_add(c.weight_bp()));
    if weights != Some(evaluator_core::BP) {
        return Err(RunError::Rubric("weights do not sum to 10000"));
    }
    if !is_pos_int_str(Some(&Value::String(rubric.budget_cap_minor.clone()))) {
        return Err(RunError::Rubric("budget_cap_minor"));
    }
    if !rubric.criteria.iter().all(|c| is_criterion_id(c.id())) {
        return Err(RunError::Rubric("criterion id"));
    }
    if prompt
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
    let min_valid = rubric.aggregation.min_valid_outputs;
    if !(2..=3).contains(&min_valid) || min_valid > rubric.models.len() {
        return Err(RunError::Rubric(
            "min_valid_outputs is not 2 or 3, or exceeds the number of models",
        ));
    }
    prompt::render_user(&prompt, "", &|_| String::new())?;
    Ok(CheckedRubric {
        rubric,
        prompt,
        hash: sha256(rubric_json.as_bytes()),
    })
}

/// Nonce for the attestation fetch: `sha256(bids_root || u32le(attempt))`, hex (D-024).
pub fn attestation_nonce(root: &Hash, attempt: u8) -> String {
    evaluator_core::run::attestation_nonce(root, u32::from(attempt))
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
    if !(1..=LAST_ATTEMPT).contains(&input.attempt) {
        return Err(RunError::Attempt);
    }

    let CheckedRubric {
        rubric,
        prompt: prompt_rubric,
        hash: rubric_hash,
    } = check_rubric(&input.rubric_json)?;

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

    // The key check: one model API call that depends on no bid (D-024). Its failure is ours, not a
    // bidder's, so it refuses on every attempt. Skipped when no bid is eligible (no model call).
    if !eligible.is_empty()
        && let Err(e) = svc.models.preflight()
    {
        return Err(if matches!(e.http_status, Some(401 | 403)) {
            RunError::ModelAuth
        } else {
            RunError::ModelOutage
        });
    }

    // Attestation for this run's nonce (a failure is recorded, scoring goes on).
    let nonce_hex = attestation_nonce(&root, input.attempt);
    let attestation = match svc.attestation.reports(&nonce_hex, &rubric.models) {
        Ok(reports) => json!({"nonce_hex": nonce_hex, "reports": reports}),
        Err(e) => json!({"nonce_hex": nonce_hex, "reports": [], "error": e.0}),
    };

    // One call per (eligible bid, model), then its signature. A model outage refuses the run, so
    // the contract's retry applies, instead of publishing a result with no qualitative scoring
    // behind it (D-024): an authorization refusal (401/403) stops at once; a bid left with fewer
    // answered calls than `min_valid_outputs` stops after its calls (`is_outage`: no response,
    // 5xx or 429 after the retry); a run where no call got a 2xx answer stops at the end. Other
    // 4xx are the API refusing that request (a bid's text can cause them), and like answers that
    // arrive but are invalid they stay recorded as invalid outputs (no retry, scoring-prompt.md).
    // On the last attempt the key check above has passed, so a failed call may be this bid's
    // doing: it is recorded as an invalid answer, whatever its status, and the result is published
    // (`needs_committee`) instead of the tender ending `Failed`. A bidder must not be able to end a
    // tender by what they write. Only a run where no call got a 2xx answer across two or more
    // eligible bids still refuses then: no single bid's text causes that.
    let last_attempt = input.attempt == LAST_ATTEMPT;
    let mut calls: Vec<CallRecord> = Vec::new();
    let mut outputs: BTreeMap<String, Vec<Value>> = BTreeMap::new();
    let mut any_reply = false;
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
        let mut answered = 0usize;
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
                    answered += 1;
                    any_reply = true;
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
                    if !last_attempt && matches!(e.http_status, Some(401 | 403)) {
                        return Err(RunError::ModelAuth);
                    }
                    if last_attempt || !is_outage(e.http_status) {
                        answered += 1;
                    }
                    per_model.push(Value::Null);
                    calls.push(CallRecord::failed(i, model, e));
                }
            }
        }
        if answered < rubric.aggregation.min_valid_outputs {
            return Err(RunError::ModelOutage);
        }
        outputs.insert(i.to_string(), per_model);
    }
    if !eligible.is_empty() && !any_reply && (!last_attempt || eligible.len() >= 2) {
        // No call answered at all: no qualitative scoring behind any bid.
        return Err(RunError::ModelOutage);
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
