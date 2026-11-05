//! Close, freeze, evaluate, accept once (docs/03-contract.md "Anyone"; I3–I7, I10, I12).

use crate::events::emit;
use crate::merkle;
use crate::rubric::{hex, is_sha256_hex, jcs};
use crate::*;
use near_sdk::base64::Engine;
use near_sdk::base64::engine::general_purpose::STANDARD;
use near_sdk::json_types::U64;
use near_sdk::serde::Deserialize;
use near_sdk::serde_json::{self, Value, json};
use near_sdk::{Promise, PromiseError};

/// Flags (docs/04-evaluator.md stage 7) the contract acts on.
pub const FLAG_INELIGIBLE: u64 = 1;
pub const FLAG_DECRYPT_FAILED: u64 = 2;
pub const FLAG_ACCOUNT_MISMATCH: u64 = 4;
pub const FLAG_EVAL_INCOMPLETE: u64 = 64;
pub const FLAGS_MAX: u64 = 127;

/// The compact result as the evaluator prints it (specs/schemas/compact-result.schema.json).
#[derive(Deserialize)]
#[serde(crate = "near_sdk::serde", deny_unknown_fields)]
struct CompactResult {
    v: u8,
    tid: String,
    root: String,
    rubric: String,
    bundle: String,
    attempt: u8,
    status: String,
    rk: Vec<[u64; 3]>,
}

/// What a result must echo (docs/03 "Validation of the compact result").
pub struct Expected<'a> {
    pub tender_id: u64,
    pub root: &'a str,
    pub rubric_hash: &'a str,
    pub attempt: u8,
    pub n_bids: usize,
}

/// A result that passed every rule.
#[derive(Debug, PartialEq, Eq)]
pub struct Accepted {
    pub json: String,
    pub bundle: String,
    pub status: String,
    /// `[index, total_bp, flags]` in ranking order.
    pub rk: Vec<[u64; 3]>,
}

/// Checks a compact result against docs/03 rules 1–5 (plus: canonical JCS, ≤ 900 bytes,
/// ineligible entries carry total 0 and follow by index, flags 2/4 imply ineligible).
pub fn validate_result(text: &str, e: &Expected) -> Result<Accepted, &'static str> {
    if text.len() > MAX_RESULT_BYTES {
        return Err("E_RESULT_TOO_LARGE");
    }
    let value: Value = serde_json::from_str(text).map_err(|_| "E_RESULT_FORMAT")?;
    if jcs(&value)
        .map_err(|_| "E_RESULT_NOT_CANONICAL")?
        .as_slice()
        != text.as_bytes()
    {
        return Err("E_RESULT_NOT_CANONICAL");
    }
    let r: CompactResult = serde_json::from_value(value).map_err(|_| "E_RESULT_FORMAT")?;
    if r.v != 1 {
        return Err("E_RESULT_VERSION");
    }
    if r.tid != e.tender_id.to_string() {
        return Err("E_RESULT_TID");
    }
    if r.root != e.root {
        return Err("E_RESULT_ROOT");
    }
    if r.rubric != e.rubric_hash {
        return Err("E_RESULT_RUBRIC");
    }
    if r.attempt != e.attempt {
        return Err("E_RESULT_ATTEMPT");
    }
    if !is_sha256_hex(&r.bundle) {
        return Err("E_RESULT_FORMAT");
    }
    // Rule 3: every index exactly once, totals and flags in range.
    if r.rk.len() != e.n_bids {
        return Err("E_RESULT_RANKING");
    }
    let mut seen = vec![false; e.n_bids];
    for [index, total, flags] in &r.rk {
        let i = usize::try_from(*index).map_err(|_| "E_RESULT_RANKING")?;
        match seen.get_mut(i) {
            Some(s) if !*s => *s = true,
            _ => return Err("E_RESULT_RANKING"),
        }
        if *total > rubric::BP || *flags > FLAGS_MAX {
            return Err("E_RESULT_RANGE");
        }
        let eligible = flags & FLAG_INELIGIBLE == 0;
        if eligible && flags & (FLAG_DECRYPT_FAILED | FLAG_ACCOUNT_MISMATCH) != 0 {
            return Err("E_RESULT_RANGE");
        }
        if !eligible && *total != 0 {
            return Err("E_RESULT_RANGE");
        }
    }
    // Rule 4: eligible first, by total descending; then ineligible by index.
    let eligible = |entry: &[u64; 3]| entry[2] & FLAG_INELIGIBLE == 0;
    let split = r.rk.iter().position(|x| !eligible(x)).unwrap_or(r.rk.len());
    let (elig, inelig) = r.rk.split_at(split);
    if inelig.iter().any(eligible) {
        return Err("E_RESULT_ORDER");
    }
    if elig.windows(2).any(|w| w[0][1] < w[1][1]) || inelig.windows(2).any(|w| w[0][0] >= w[1][0]) {
        return Err("E_RESULT_ORDER");
    }
    // Rule 5: status consistent with the flags.
    let want = if elig.is_empty() {
        "no_eligible_bids"
    } else if elig.iter().any(|x| x[2] & FLAG_EVAL_INCOMPLETE != 0) {
        "needs_committee"
    } else {
        "ok"
    };
    if r.status != want {
        return Err("E_RESULT_STATUS");
    }
    Ok(Accepted {
        json: text.to_string(),
        bundle: r.bundle,
        status: r.status,
        rk: r.rk,
    })
}

/// Reads OutLayer's callback payload: a JSON string with the evaluator's stdout, or `null`.
fn read_output(result: Result<Vec<u8>, PromiseError>) -> Result<String, &'static str> {
    let bytes = result.map_err(|_| "E_EVAL_PROMISE_FAILED")?;
    let text: Option<String> = serde_json::from_slice(&bytes).map_err(|_| "E_RESULT_FORMAT")?;
    text.ok_or("E_EVAL_RUN_FAILED")
}

#[near]
impl Contract {
    /// Anyone, at or after the deadline (I3). No active bids: `NoBids` and everything goes back
    /// to the buyer. Otherwise freezes the bid set (I4) and requests evaluation attempt 1.
    pub fn close_and_evaluate(&mut self, tender_id: u64) {
        let t = self.tender(tender_id);
        require(t.status == Status::Open, "E_BAD_STATUS");
        require(now_ns() >= t.deadline_ns.0, "E_DEADLINE_NOT_REACHED");

        if t.active_slots.is_empty() {
            self.tender_mut(tender_id).status = Status::NoBids;
            let fee = self.refund_eval_fee(tender_id);
            emit(
                "tender_closed",
                json!({"tender_id": tender_id.to_string(), "n": 0, "status": "NoBids", "eval_fee_refunded": fee}),
            );
            self.refund_escrow(tender_id);
            return;
        }

        // Freeze: active slots by (submitted_at_ns, slot) → indices 0..n-1.
        let mut order: Vec<(u64, u32)> = t
            .active_slots
            .iter()
            .filter_map(|slot| {
                self.bids
                    .get(&(tender_id, *slot))
                    .map(|b| (b.submitted_at_ns.0, *slot))
            })
            .collect();
        order.sort_unstable();
        let mut leaves = Vec::with_capacity(order.len());
        for (_, slot) in &order {
            let b = self
                .bids
                .get(&(tender_id, *slot))
                .unwrap_or_else(|| fail("E_NO_BID"));
            leaves.push(merkle::leaf(
                b.bidder.as_str(),
                b.submitted_at_ns.0,
                &b.ciphertext,
            ));
        }
        let root = merkle::root(&leaves).unwrap_or_else(|| fail("E_NO_BID"));
        let frozen = Frozen {
            slots: order.iter().map(|(_, s)| *s).collect(),
            leaves: leaves.iter().map(|l| hex(l)).collect(),
            root: hex(&root),
        };
        emit(
            "tender_closed",
            json!({"tender_id": tender_id.to_string(), "n": frozen.slots.len(), "root": frozen.root, "status": "Evaluating"}),
        );
        self.tender_mut(tender_id).frozen = Some(frozen);
        self.start_attempt(tender_id);
    }

    /// Anyone, after a failed attempt, while attempts < MAX_ATTEMPTS (I12). Same frozen input.
    ///
    /// At least `RETRY_MIN_GAP_NS` after the last attempt started: the evaluator's last attempt is
    /// deliberately lenient (an unanswered bid is published as EVAL_INCOMPLETE rather than ending
    /// the tender, D-024), which only makes sense if the earlier attempts were spread out. Without
    /// a gap anyone could fire attempts 2 and 3 in consecutive blocks during one outage, so the
    /// lenient attempt lands inside the same failure window and bids that happened to go
    /// unanswered publish with their text criteria at 0.
    pub fn retry_evaluate(&mut self, tender_id: u64) {
        let t = self.tender(tender_id);
        require(t.status == Status::EvalFailed, "E_BAD_STATUS");
        require(
            t.attempts.len() < usize::from(MAX_ATTEMPTS),
            "E_MAX_ATTEMPTS",
        );
        if let Some(last) = t.attempts.last() {
            require(
                now_ns() >= last.started_at_ns.0.saturating_add(RETRY_MIN_GAP_NS),
                "E_RETRY_TOO_SOON",
            );
        }
        self.start_attempt(tender_id);
    }

    /// OutLayer result of an evaluate request. `#[private]`: only this contract's own promise
    /// chain can call it (I7). Accepts at most one result per tender (I5), only for the attempt in
    /// flight, only if every rule holds (I6). Never panics; every outcome is recorded (I12).
    #[private]
    pub fn on_evaluate(&mut self, tender_id: u64, attempt: u8) -> bool {
        let result = env::promise_result_checked(0, MAX_CALLBACK_BYTES);
        let Some(t) = self.tenders.get(&tender_id) else {
            env::log_str("E_NO_TENDER");
            return false;
        };
        let current = t.attempts.last().map(|a| (a.n, a.outcome.clone()));
        if t.status != Status::Evaluating || current != Some((attempt, AttemptOutcome::Pending)) {
            env::log_str("E_STALE_RESULT");
            return false;
        }
        let Some(frozen) = t.frozen.as_ref() else {
            env::log_str("E_NOT_FROZEN");
            return false;
        };
        let expected = Expected {
            tender_id,
            root: &frozen.root,
            rubric_hash: &t.rubric_hash,
            attempt,
            n_bids: frozen.slots.len(),
        };
        match read_output(result).and_then(|text| validate_result(&text, &expected)) {
            Ok(accepted) => {
                self.accept_result(tender_id, accepted);
                true
            }
            Err(code) => {
                self.fail_attempt(tender_id, code);
                false
            }
        }
    }
}

impl Contract {
    /// Pushes attempt n+1, sends the evaluate request with one eval deposit, status `Evaluating`.
    /// If the fee cannot pay another attempt, the tender fails and everything is refunded.
    fn start_attempt(&mut self, tender_id: u64) {
        let t = self.tender(tender_id);
        let n = u8::try_from(t.attempts.len() + 1).unwrap_or(u8::MAX);
        if t.eval_fee_remaining < t.exec_deposit || t.exec_deposit.is_zero() {
            self.finish_failed(tender_id, "E_EVAL_FEE_LOW");
            return;
        }
        let input = self.evaluate_input(tender_id, n);
        let contract_id = env::current_account_id();
        let outlayer = self.outlayer.clone();
        let secrets_ref = self.secrets_ref.clone();
        let t = self.tender_mut(tender_id);
        let deposit = t.exec_deposit;
        t.eval_fee_remaining = t.eval_fee_remaining.saturating_sub(deposit);
        t.attempts.push(Attempt {
            n,
            started_at_ns: U64(now_ns()),
            outcome: AttemptOutcome::Pending,
        });
        t.status = Status::Evaluating;
        let args = json!({
            "source": {"WasmUrl": {
                "url": t.evaluator.wasm_url,
                "hash": t.evaluator.wasm_sha256,
                "build_target": t.evaluator.build_target,
            }},
            "resource_limits": {
                "max_instructions": EVAL_MAX_INSTRUCTIONS,
                "max_memory_mb": EVAL_MAX_MEMORY_MB,
                "max_execution_seconds": EVAL_MAX_SECONDS,
            },
            "input_data": input,
            "secrets_ref": secrets_ref,
            "response_format": "Text",
            "payer_account_id": t.buyer,
        });
        let gas = request_gas_for_input(input.len());
        emit(
            "evaluation_requested",
            json!({"tender_id": tender_id.to_string(), "attempt": n, "deposit": deposit, "input_bytes": input.len()}),
        );
        Promise::new(outlayer)
            .function_call(
                "request_execution".to_string(),
                args.to_string().into_bytes(),
                deposit,
                gas,
            )
            .then(
                Self::ext(contract_id)
                    .with_static_gas(GAS_ON_EVALUATE)
                    .on_evaluate(tender_id, n),
            )
            .detach();
    }

    /// Evaluator input (docs/04-evaluator.md §6), built from the frozen bid set only.
    pub(crate) fn evaluate_input(&self, tender_id: u64, attempt: u8) -> String {
        let t = self.tender(tender_id);
        let frozen = t.frozen.as_ref().unwrap_or_else(|| fail("E_NOT_FROZEN"));
        let bids: Vec<Value> = frozen
            .slots
            .iter()
            .enumerate()
            .map(|(index, slot)| {
                let b = self
                    .bids
                    .get(&(tender_id, *slot))
                    .unwrap_or_else(|| fail("E_NO_BID"));
                json!({
                    "index": index,
                    "bidder": b.bidder,
                    "submitted_at_ns": b.submitted_at_ns,
                    "ciphertext_b64": STANDARD.encode(&b.ciphertext),
                    "debrief_pubkey": b.debrief_pubkey,
                })
            })
            .collect();
        let committee: Vec<Value> = t
            .committee
            .iter()
            .map(|m| json!({"account": m.account, "pubkey": m.report_pubkey}))
            .collect();
        json!({
            "action": "evaluate",
            "contract_id": env::current_account_id(),
            "tender_id": tender_id.to_string(),
            "attempt": attempt,
            "rubric_json": t.rubric_json,
            "bids_root": frozen.root,
            "bids": bids,
            "committee": committee,
            // What this tender pinned at creation. The WASM cannot measure its own hash - OutLayer
            // exposes no such variable (G1 listed all 27) and a binary cannot contain its own
            // digest - so the bundle carries the hash the contract pinned, and a verifier checks
            // it against the attestation's `executed_wasm_sha256` (docs/06 check 4, D-029).
            "evaluator": {
                "wasm_sha256": t.evaluator.wasm_sha256,
                "source_tag": t.evaluator.source_tag,
            },
        })
        .to_string()
    }

    fn accept_result(&mut self, tender_id: u64, accepted: Accepted) {
        let slots = self
            .tender(tender_id)
            .frozen
            .as_ref()
            .map(|f| f.slots.clone())
            .unwrap_or_default();
        let buyer = self.tender(tender_id).buyer.clone();
        {
            let t = self.tender_mut(tender_id);
            t.result_json = Some(accepted.json.clone());
            t.status = Status::Evaluated;
            if let Some(a) = t.attempts.last_mut() {
                a.outcome = AttemptOutcome::Accepted;
            }
        }
        // Bonds: forfeit to the buyer for bids that could not be evaluated (DECRYPT_FAILED,
        // ACCOUNT_MISMATCH), refund the rest. Each exactly once (I10).
        let mut refunded = Vec::new();
        let mut forfeited = Vec::new();
        for [index, _, flags] in &accepted.rk {
            let Some(slot) = usize::try_from(*index)
                .ok()
                .and_then(|i| slots.get(i))
                .copied()
            else {
                continue;
            };
            let Some((bidder, bond)) = self.settle_bond(tender_id, slot) else {
                continue;
            };
            let to = if flags & (FLAG_DECRYPT_FAILED | FLAG_ACCOUNT_MISMATCH) != 0 {
                forfeited.push(json!({"slot": slot, "bidder": bidder, "bond": bond}));
                buyer.clone()
            } else {
                refunded.push(json!({"slot": slot, "bidder": bidder, "bond": bond}));
                bidder
            };
            if !bond.is_zero() {
                Promise::new(to).transfer(bond).detach();
            }
        }
        let attempt = self.tender(tender_id).attempts.last().map(|a| a.n);
        emit(
            "evaluation_accepted",
            json!({"tender_id": tender_id.to_string(), "attempt": attempt, "bundle": accepted.bundle, "status": accepted.status}),
        );
        emit(
            "bonds_settled",
            json!({"tender_id": tender_id.to_string(), "refunded": refunded, "forfeited": forfeited}),
        );
    }

    /// Records the failed attempt. Below MAX_ATTEMPTS (and with fee left) the tender waits for
    /// `retry_evaluate`; otherwise it fails and everything is refunded.
    fn fail_attempt(&mut self, tender_id: u64, code: &str) {
        let reason: String = code.chars().take(MAX_REASON_CHARS).collect();
        let t = self.tender_mut(tender_id);
        let n = t.attempts.last().map(|a| a.n).unwrap_or(0);
        if let Some(a) = t.attempts.last_mut() {
            a.outcome = AttemptOutcome::Failed {
                reason: reason.clone(),
            };
        }
        let can_retry =
            n < MAX_ATTEMPTS && t.eval_fee_remaining >= t.exec_deposit && !t.exec_deposit.is_zero();
        emit(
            "evaluation_failed",
            json!({"tender_id": tender_id.to_string(), "attempt": n, "reason": reason, "final": !can_retry}),
        );
        if can_retry {
            self.tender_mut(tender_id).status = Status::EvalFailed;
        } else {
            self.finish_failed(tender_id, &reason);
        }
    }

    /// Status `Failed`: escrow, every unsettled bond and the remaining fee go back.
    fn finish_failed(&mut self, tender_id: u64, reason: &str) {
        let slots = self
            .tender(tender_id)
            .frozen
            .as_ref()
            .map(|f| f.slots.clone())
            .unwrap_or_default();
        self.tender_mut(tender_id).status = Status::Failed;
        let mut refunded = Vec::new();
        for slot in slots {
            if let Some((bidder, bond)) = self.settle_bond(tender_id, slot) {
                refunded.push(json!({"slot": slot, "bidder": bidder, "bond": bond}));
                if !bond.is_zero() {
                    Promise::new(bidder).transfer(bond).detach();
                }
            }
        }
        let fee = self.refund_eval_fee(tender_id);
        emit(
            "tender_failed",
            json!({"tender_id": tender_id.to_string(), "reason": reason, "eval_fee_refunded": fee}),
        );
        emit(
            "bonds_settled",
            json!({"tender_id": tender_id.to_string(), "refunded": refunded, "forfeited": []}),
        );
        self.refund_escrow(tender_id);
    }

    /// Sends the remaining eval fee to the buyer; returns it.
    pub(crate) fn refund_eval_fee(&mut self, tender_id: u64) -> NearToken {
        let t = self.tender_mut(tender_id);
        let fee = std::mem::replace(&mut t.eval_fee_remaining, NearToken::from_yoctonear(0));
        if !fee.is_zero() {
            Promise::new(t.buyer.clone()).transfer(fee).detach();
        }
        fee
    }
}

/// Gas for `request_execution`: OutLayer reserves `CALLBACK_GAS_PER_INPUT_BYTE` of resume gas for
/// every `input_data` byte beyond 32 KiB on top of its 50 Tgas minimum (references.md).
pub fn request_gas_for_input(input_len: usize) -> Gas {
    let over = input_len.saturating_sub(OUTLAYER_INPUT_FREE_BYTES) as u64;
    Gas::from_gas(
        GAS_REQUEST_EXECUTION
            .as_gas()
            .saturating_add(over.saturating_mul(OUTLAYER_CALLBACK_GAS_PER_INPUT_BYTE)),
    )
}
