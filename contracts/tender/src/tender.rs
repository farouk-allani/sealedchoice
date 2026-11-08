//! Buyer side: create_tender, the tender key (OutLayer derive_pubkey), escrow funding, cancel.

use crate::events::emit;
use crate::rubric::{is_compressed_pubkey, parse_rubric};
use crate::*;
use near_sdk::json_types::{U64, U128};
use near_sdk::serde::Deserialize;
use near_sdk::serde_json::{self, json};
use near_sdk::{Promise, PromiseError, PromiseOrValue};

/// What the evaluator prints for `derive_pubkey` (stdout, via OutLayer `Text` format).
#[derive(Deserialize)]
#[serde(crate = "near_sdk::serde", deny_unknown_fields)]
struct PubkeyOutput {
    v: u8,
    tid: String,
    pk: String,
}

#[derive(Deserialize)]
#[serde(crate = "near_sdk::serde", deny_unknown_fields)]
struct FundMsg {
    fund_tender: String,
}

#[near]
impl Contract {
    /// Payable: storage + eval fee. Returns the tender id. Starts the OutLayer derive_pubkey request.
    #[payable]
    pub fn create_tender(
        &mut self,
        rubric_json: String,
        deadline_ns: U64,
        bond: NearToken,
        committee: Vec<CommitteeMember>,
        evaluator_index: u32,
    ) -> u64 {
        let storage_before = env::storage_usage();
        let buyer = env::predecessor_account_id();

        require(
            !committee.is_empty() && committee.len() <= MAX_COMMITTEE,
            "E_COMMITTEE_SIZE",
        );
        for (i, m) in committee.iter().enumerate() {
            require(is_compressed_pubkey(&m.report_pubkey), "E_BAD_PUBKEY");
            require(
                !committee[..i].iter().any(|o| o.account == m.account),
                "E_COMMITTEE_DUPLICATE",
            );
        }
        let parsed = parse_rubric(&rubric_json, committee.len()).unwrap_or_else(|code| fail(code));
        let worst_input = worst_eval_input_bytes(&rubric_json, &committee);
        // One reading of the clock for both the deadline rule and the recorded creation time, so
        // the two can never disagree about when this tender was made.
        let created_at_ns = now_ns();
        let min_deadline = created_at_ns.saturating_add(self.min_deadline_delay_ns);
        require(deadline_ns.0 >= min_deadline, "E_DEADLINE_TOO_SOON");
        let evaluator = self
            .evaluators
            .get(evaluator_index)
            .cloned()
            .unwrap_or_else(|| fail("E_NO_EVALUATOR"));

        let id = self.next_tender_id;
        self.next_tender_id += 1;
        self.tenders.insert(
            id,
            Tender {
                id,
                buyer: buyer.clone(),
                rubric_json,
                rubric_hash: parsed.hash_hex.clone(),
                currency_token: parsed.currency_token,
                budget_cap: U128(parsed.budget_cap),
                approvals_required: parsed.approvals_required,
                acceptance_window_ns: U64(parsed.acceptance_window_ns),
                created_at_ns: U64(created_at_ns),
                deadline_ns,
                bond,
                committee,
                evaluator,
                tender_pubkey: None,
                escrowed: U128(0),
                eval_fee_remaining: NearToken::from_yoctonear(0),
                exec_deposit: NearToken::from_yoctonear(0),
                status: Status::PendingKey,
                bid_slots: 0,
                active_slots: Vec::new(),
                frozen: None,
                attempts: Vec::new(),
                result_json: None,
                award: None,
            },
        );
        self.tenders.flush();
        // The tender's own bytes now, plus a reserve for what close and evaluation add (D-020).
        let added = env::storage_usage().saturating_sub(storage_before) + STORAGE_RESERVE_BYTES;
        let storage = Self::storage_cost(added);
        let attached = env::attached_deposit();
        let eval_fee = attached
            .checked_sub(storage)
            .unwrap_or_else(|| fail("E_INSUFFICIENT_DEPOSIT"));
        let exec_deposit = NearToken::from_yoctonear(eval_fee.as_yoctonear() / EXECUTIONS_BUDGETED);
        require(!exec_deposit.is_zero(), "E_EVAL_FEE_LOW");
        // Each OutLayer deposit must at least cover the input-storage deposit OutLayer holds for
        // the largest evaluate input this tender can produce, or large bids would fail every
        // attempt (D-020). The compute part is the client's estimate (estimate_execution_cost).
        require(
            exec_deposit.as_yoctonear() >= outlayer_input_storage(worst_input),
            "E_EVAL_FEE_LOW",
        );
        {
            let t = self.tender_mut(id);
            t.eval_fee_remaining = eval_fee;
            t.exec_deposit = exec_deposit;
        }

        let t = self.tender(id);
        emit(
            "tender_created",
            json!({
                "tender_id": id.to_string(),
                "buyer": t.buyer,
                "rubric_hash": t.rubric_hash,
                "deadline_ns": t.deadline_ns,
                "bond": t.bond,
                "currency_token": t.currency_token,
                "budget_cap": t.budget_cap,
                "evaluator": t.evaluator,
                "committee": t.committee,
            }),
        );
        self.request_key(id);
        id
    }

    /// Buyer only, while the key is missing. Keeps enough fee for MAX_ATTEMPTS evaluations.
    pub fn retry_pubkey(&mut self, tender_id: u64) {
        let t = self.tender(tender_id);
        require(env::predecessor_account_id() == t.buyer, "E_NOT_BUYER");
        require(t.status == Status::PendingKey, "E_BAD_STATUS");
        require(now_ns() < t.deadline_ns.0, "E_DEADLINE_PASSED");
        let reserve = t.exec_deposit.saturating_mul(u128::from(MAX_ATTEMPTS) + 1);
        require(t.eval_fee_remaining >= reserve, "E_EVAL_FEE_LOW");
        self.request_key(tender_id);
    }

    /// OutLayer result of derive_pubkey. Never panics: a bad or missing result leaves the
    /// tender in `PendingKey` so the buyer can `retry_pubkey`. Returns true if the key was set.
    #[private]
    pub fn on_pubkey(&mut self, tender_id: u64) -> bool {
        let result = env::promise_result_checked(0, MAX_CALLBACK_BYTES);
        let Some(t) = self.tenders.get_mut(&tender_id) else {
            env::log_str("E_NO_TENDER");
            return false;
        };
        if t.status != Status::PendingKey || t.tender_pubkey.is_some() {
            env::log_str("E_BAD_STATUS: key result ignored");
            return false;
        }
        match parse_pubkey_result(result, tender_id) {
            Ok(pk) => {
                t.tender_pubkey = Some(pk.clone());
                t.status = Status::AwaitingFunds;
                emit(
                    "tender_key_set",
                    json!({"tender_id": tender_id.to_string(), "tender_pubkey": pk}),
                );
                true
            }
            Err(code) => {
                env::log_str(code);
                false
            }
        }
    }

    /// NEP-141 receiver for escrow. msg = {"fund_tender":"<id>"}. Accepts only the rubric token,
    /// only from the buyer, only in AwaitingFunds, only exactly the cap (I11); otherwise every
    /// token is returned. Never panics.
    pub fn ft_on_transfer(
        &mut self,
        sender_id: AccountId,
        amount: U128,
        msg: String,
    ) -> PromiseOrValue<U128> {
        let token = env::predecessor_account_id();
        let refund_all = |code: &str| {
            env::log_str(code);
            PromiseOrValue::Value(amount)
        };
        let Ok(FundMsg { fund_tender }) = serde_json::from_str::<FundMsg>(&msg) else {
            return refund_all("E_BAD_MSG");
        };
        let Ok(tender_id) = fund_tender.parse::<u64>() else {
            return refund_all("E_BAD_MSG");
        };
        let Some(t) = self.tenders.get_mut(&tender_id) else {
            return refund_all("E_NO_TENDER");
        };
        if token != t.currency_token {
            return refund_all("E_WRONG_TOKEN");
        }
        if sender_id != t.buyer {
            return refund_all("E_NOT_BUYER");
        }
        if t.status != Status::AwaitingFunds {
            return refund_all("E_BAD_STATUS");
        }
        if amount != t.budget_cap {
            return refund_all("E_WRONG_AMOUNT");
        }
        if now_ns() >= t.deadline_ns.0 {
            return refund_all("E_DEADLINE_PASSED");
        }
        t.escrowed = amount;
        t.status = Status::Open;
        emit(
            "tender_funded",
            json!({"tender_id": tender_id.to_string(), "amount": amount, "token": token}),
        );
        PromiseOrValue::Value(U128(0))
    }

    /// Buyer only, in PendingKey / AwaitingFunds / Open, before the deadline (or after it while the
    /// tender never opened). Refunds escrow,
    /// every active bond and the remaining eval fee, once.
    pub fn cancel_tender(&mut self, tender_id: u64, reason: String) {
        require(
            reason.chars().count() <= MAX_RATIONALE_CHARS,
            "E_RATIONALE_TOO_LONG",
        );
        let t = self.tender(tender_id);
        require(env::predecessor_account_id() == t.buyer, "E_NOT_BUYER");
        require(
            matches!(
                t.status,
                Status::PendingKey | Status::AwaitingFunds | Status::Open
            ),
            "E_BAD_STATUS",
        );
        // Before the deadline in every state; after it only while no bid or escrow can exist
        // (key missing or never funded), so the buyer's fee is never stuck (D-020).
        require(
            now_ns() < t.deadline_ns.0
                || matches!(t.status, Status::PendingKey | Status::AwaitingFunds),
            "E_DEADLINE_PASSED",
        );
        let slots = t.active_slots.clone();

        let mut refunded = Vec::new();
        for slot in slots {
            if let Some((bidder, bond)) = self.settle_bond(tender_id, slot) {
                refunded.push(json!({"slot": slot, "bidder": bidder, "bond": bond}));
                if !bond.is_zero() {
                    Promise::new(bidder).transfer(bond).detach();
                }
            }
        }
        let t = self.tender_mut(tender_id);
        t.status = Status::Cancelled;
        let buyer = t.buyer.clone();
        let fee = std::mem::replace(&mut t.eval_fee_remaining, NearToken::from_yoctonear(0));
        if !fee.is_zero() {
            Promise::new(buyer).transfer(fee).detach();
        }
        emit(
            "tender_cancelled",
            json!({"tender_id": tender_id.to_string(), "reason": reason, "eval_fee_refunded": fee}),
        );
        emit(
            "bonds_settled",
            json!({"tender_id": tender_id.to_string(), "refunded": refunded, "forfeited": []}),
        );
        self.refund_escrow(tender_id);
    }

    /// Anyone: if an escrow refund to the buyer failed (callback restored `escrowed`), send it again.
    /// Only in states where the escrow belongs to the buyer.
    pub fn retry_escrow_refund(&mut self, tender_id: u64) {
        let t = self.tender(tender_id);
        require(
            matches!(
                t.status,
                Status::Cancelled
                    | Status::NoBids
                    | Status::Failed
                    | Status::ClosedNoAward
                    // `Paid` too: `on_payout` debits the winner's amount, sets `Paid` and then
                    // refunds the remainder, so a failed remainder transfer (an unregistered
                    // buyer, usually) books the tokens back as `escrowed` in a state nothing else
                    // can move them out of. The winner is already paid and the payout path needs
                    // `PayingOut`, so this cannot pay anyone twice (I9); what is left is the
                    // buyer's.
                    | Status::Paid
            ),
            "E_BAD_STATUS",
        );
        require(t.escrowed.0 > 0, "E_NOTHING_TO_REFUND");
        self.refund_escrow(tender_id);
    }

    /// ft_transfer result for an escrow refund: on failure the amount is booked back as escrowed.
    #[private]
    pub fn on_escrow_refund(&mut self, tender_id: u64, amount: U128) -> bool {
        // Only a failed receipt means the tokens did not move; any output (even unexpected) is success.
        let ok = !matches!(
            env::promise_result_checked(0, 64),
            Err(PromiseError::Failed)
        );
        if !ok {
            if let Some(t) = self.tenders.get_mut(&tender_id) {
                t.escrowed = U128(t.escrowed.0.saturating_add(amount.0));
            }
            emit(
                "escrow_refund_failed",
                json!({"tender_id": tender_id.to_string(), "amount": amount}),
            );
        }
        ok
    }
}

impl Contract {
    /// Sends one derive_pubkey request to OutLayer with `exec_deposit`, paid from the eval fee.
    /// OutLayer refunds unused deposit to `payer_account_id` = the buyer.
    fn request_key(&mut self, tender_id: u64) {
        let contract_id = env::current_account_id();
        let outlayer = self.outlayer.clone();
        let secrets_ref = self.secrets_ref.clone();
        let t = self.tender_mut(tender_id);
        let deposit = t.exec_deposit;
        t.eval_fee_remaining = t
            .eval_fee_remaining
            .checked_sub(deposit)
            .unwrap_or_else(|| fail("E_EVAL_FEE_LOW"));
        let input = json!({"action": "derive_pubkey", "contract_id": contract_id, "tender_id": tender_id.to_string()});
        let args = json!({
            "source": {"WasmUrl": {
                "url": t.evaluator.wasm_url,
                "hash": t.evaluator.wasm_sha256,
                "build_target": t.evaluator.build_target,
            }},
            "resource_limits": {
                "max_instructions": DERIVE_MAX_INSTRUCTIONS,
                "max_memory_mb": DERIVE_MAX_MEMORY_MB,
                "max_execution_seconds": DERIVE_MAX_SECONDS,
            },
            "input_data": input.to_string(),
            "secrets_ref": secrets_ref,
            "response_format": "Text",
            "payer_account_id": t.buyer,
        });
        emit(
            "key_requested",
            json!({"tender_id": tender_id.to_string(), "deposit": deposit}),
        );
        Promise::new(outlayer)
            .function_call(
                "request_execution".to_string(),
                args.to_string().into_bytes(),
                deposit,
                GAS_REQUEST_EXECUTION,
            )
            .then(
                Self::ext(contract_id)
                    .with_static_gas(GAS_ON_PUBKEY)
                    .on_pubkey(tender_id),
            )
            .detach();
    }

    /// Moves the whole escrow back to the buyer (ft_transfer + callback). No-op if nothing is escrowed.
    pub(crate) fn refund_escrow(&mut self, tender_id: u64) {
        let contract_id = env::current_account_id();
        let t = self.tender_mut(tender_id);
        let amount = std::mem::replace(&mut t.escrowed, U128(0));
        if amount.0 == 0 {
            return;
        }
        let args = json!({"receiver_id": t.buyer, "amount": amount, "memo": format!("tender {tender_id} escrow refund")});
        Promise::new(t.currency_token.clone())
            .function_call(
                "ft_transfer".to_string(),
                args.to_string().into_bytes(),
                ONE_YOCTO,
                GAS_FT_TRANSFER,
            )
            .then(
                Self::ext(contract_id)
                    .with_static_gas(GAS_ON_ESCROW_REFUND)
                    .on_escrow_refund(tender_id, amount),
            )
            .detach();
    }

    /// Marks a bid's bond settled and returns (bidder, bond) if it was not settled yet (I10).
    pub(crate) fn settle_bond(
        &mut self,
        tender_id: u64,
        slot: u32,
    ) -> Option<(AccountId, NearToken)> {
        let bid = self.bids.get_mut(&(tender_id, slot))?;
        if bid.bond_settled {
            return None;
        }
        bid.bond_settled = true;
        Some((bid.bidder.clone(), bid.bond))
    }
}

/// Parses OutLayer's callback payload for derive_pubkey: a JSON string holding the evaluator's
/// stdout (`{"v":1,"tid":"<id>","pk":"02…"}`), or `null` when the run failed.
fn parse_pubkey_result(
    result: Result<Vec<u8>, PromiseError>,
    tender_id: u64,
) -> Result<String, &'static str> {
    let bytes = result.map_err(|_| "E_KEY_PROMISE_FAILED")?;
    let text: Option<String> = serde_json::from_slice(&bytes).map_err(|_| "E_KEY_RESULT_FORMAT")?;
    let text = text.ok_or("E_KEY_RUN_FAILED")?;
    let out: PubkeyOutput = serde_json::from_str(&text).map_err(|_| "E_KEY_RESULT_FORMAT")?;
    if out.v != 1 {
        return Err("E_KEY_RESULT_VERSION");
    }
    if out.tid != tender_id.to_string() {
        return Err("E_KEY_RESULT_TID");
    }
    if !is_compressed_pubkey(&out.pk) {
        return Err("E_BAD_PUBKEY");
    }
    Ok(out.pk)
}

/// Upper bound of the evaluate input this tender can produce (5 maximum-size bids); its OutLayer
/// storage deposit must fit in each eval deposit (D-020).
pub fn worst_eval_input_bytes(rubric_json: &str, committee: &[CommitteeMember]) -> usize {
    let rubric_escaped = serde_json::to_string(rubric_json)
        .map(|s| s.len())
        .unwrap_or(usize::MAX);
    let committee_json: Vec<serde_json::Value> = committee
        .iter()
        .map(|m| json!({"account": m.account, "pubkey": m.report_pubkey}))
        .collect();
    let committee_len = serde_json::to_string(&committee_json)
        .map(|s| s.len())
        .unwrap_or(usize::MAX);
    EVAL_INPUT_OVERHEAD_BYTES
        .saturating_add(MAX_BIDS * MAX_BID_ENTRY_BYTES)
        .saturating_add(rubric_escaped)
        .saturating_add(committee_len)
}

/// Deposit OutLayer holds for `input_len` bytes of `input_data` (its `input_storage_deposit`).
pub fn outlayer_input_storage(input_len: usize) -> u128 {
    (input_len.saturating_sub(OUTLAYER_INPUT_FREE_BYTES) as u128)
        .saturating_mul(OUTLAYER_STORAGE_PRICE_PER_BYTE)
}
