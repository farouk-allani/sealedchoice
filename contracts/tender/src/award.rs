//! T08: the second half of the state machine. Humans decide, the contract enforces, money moves
//! once. Spec: docs/03-contract.md (Committee, Winner) and docs/09-payout.md (Escrow, route 1).
//!
//! Invariants this file carries:
//! - **I8** only committee members propose or approve; a deviation from the ranking needs a
//!   rationale; an ineligible or lapsed bid can never be awarded.
//! - **I9** payout goes only to the awarded bidder's declared target, at most once, for at most
//!   the escrow; the remainder returns to the buyer.
//! - **I10** is untouched here: bonds were settled when the result was accepted.

use near_sdk::json_types::{U64, U128};
use near_sdk::{AccountId, Promise, PromiseError, env, near, serde_json::Value, serde_json::json};

use crate::constants::{
    GAS_FT_TRANSFER, GAS_ON_PAYOUT, MAX_RATIONALE_CHARS, MIN_DEVIATION_RATIONALE_CHARS, ONE_YOCTO,
};
use crate::evaluate::FLAG_INELIGIBLE;
use crate::events::emit;
use crate::types::{Award, PayoutState, PayoutTarget, Status};
use crate::{Contract, ContractExt, fail, now_ns, require};

/// The ranking the accepted result stored, as `[index, total_bp, flags]` in ranking order.
/// Parsing cannot fail: `validate_result` already refused anything else before it was stored.
fn ranking(result_json: &str) -> Vec<[u64; 3]> {
    let v: Value = near_sdk::serde_json::from_str(result_json).unwrap_or(Value::Null);
    v.get("rk")
        .and_then(Value::as_array)
        .map(|rows| {
            rows.iter()
                .filter_map(|row| {
                    let a = row.as_array()?;
                    Some([
                        a.first()?.as_u64()?,
                        a.get(1)?.as_u64()?,
                        a.get(2)?.as_u64()?,
                    ])
                })
                .collect()
        })
        .unwrap_or_default()
}

impl Contract {
    fn committee_member(&self, tender_id: u64, who: &AccountId) -> bool {
        self.tender(tender_id)
            .committee
            .iter()
            .any(|m| &m.account == who)
    }

    /// Records one approval and, at the threshold, moves the tender to `Awarded`.
    fn approve(&mut self, tender_id: u64, who: AccountId) {
        let required = self.tender(tender_id).approvals_required as usize;
        let window = self.tender(tender_id).acceptance_window_ns.0;
        let t = self.tender_mut(tender_id);
        let Some(award) = t.award.as_mut() else {
            fail("E_NO_PROPOSAL")
        };
        if !award.approvals.contains(&who) {
            award.approvals.push(who.clone());
        }
        let reached = award.approvals.len() >= required;
        let (bid_index, amount, approvals) =
            (award.bid_index, award.amount, award.approvals.clone());
        if reached {
            award.approved_at_ns = Some(U64(now_ns()));
            // A close-without-award decision has nothing to accept, so it takes effect at once.
            if bid_index.is_some() {
                award.accept_by_ns = Some(U64(now_ns().saturating_add(window)));
            }
        }
        emit(
            "award_approved",
            json!({"tender_id": tender_id.to_string(), "by": who, "approvals": approvals.len(),
                   "required": required, "bid_index": bid_index, "amount": amount}),
        );
        if !reached {
            return;
        }
        match bid_index {
            Some(index) => {
                let accept_by = self
                    .tender(tender_id)
                    .award
                    .as_ref()
                    .and_then(|a| a.accept_by_ns);
                self.tender_mut(tender_id).status = Status::Awarded;
                emit(
                    "award_decided",
                    json!({"tender_id": tender_id.to_string(), "bid_index": index,
                           "amount": amount, "accept_by_ns": accept_by, "approvals": approvals}),
                );
            }
            None => {
                self.tender_mut(tender_id).status = Status::ClosedNoAward;
                emit(
                    "closed_without_award",
                    json!({"tender_id": tender_id.to_string(), "approvals": approvals}),
                );
                self.refund_escrow(tender_id);
            }
        }
    }

    /// Starts a fresh proposal, replacing any pending one and resetting its approvals.
    fn propose(
        &mut self,
        tender_id: u64,
        bid_index: Option<u32>,
        amount: U128,
        rationale: String,
        deviation: bool,
    ) {
        require(
            rationale.chars().count() <= MAX_RATIONALE_CHARS,
            "E_RATIONALE_TOO_LONG",
        );
        let proposer = env::predecessor_account_id();
        let lapsed = self
            .tender(tender_id)
            .award
            .as_ref()
            .map(|a| a.lapsed.clone())
            .unwrap_or_default();
        self.tender_mut(tender_id).award = Some(Award {
            bid_index,
            amount,
            rationale: rationale.clone(),
            deviation,
            approvals: Vec::new(),
            approved_at_ns: None,
            accept_by_ns: None,
            // Lapses are a property of the tender, not of one proposal: a bid that let its
            // acceptance window run out must stay unawardable when the committee proposes again.
            lapsed,
            payout: None,
            payout_state: PayoutState::None,
        });
        emit(
            "award_proposed",
            json!({"tender_id": tender_id.to_string(), "by": proposer, "bid_index": bid_index,
                   "amount": amount, "deviation": deviation, "rationale": rationale}),
        );
        // The proposer's own approval is the first one (docs/03).
        self.approve(tender_id, proposer);
    }
}

#[near]
impl Contract {
    /// Committee member: propose awarding `bid_index` for `amount`. Replaces any pending
    /// proposal and resets its approvals, so an approval always refers to what its sender read.
    pub fn propose_award(
        &mut self,
        tender_id: u64,
        bid_index: u32,
        amount: U128,
        rationale: String,
    ) {
        let caller = env::predecessor_account_id();
        require(self.committee_member(tender_id, &caller), "E_NOT_COMMITTEE");
        let t = self.tender(tender_id);
        require(t.status == Status::Evaluated, "E_BAD_STATUS");
        require(amount.0 > 0 && amount.0 <= t.budget_cap.0, "E_BAD_AMOUNT");

        let rk = ranking(t.result_json.as_deref().unwrap_or(""));
        let entry = rk
            .iter()
            .find(|e| e[0] == bid_index as u64)
            .unwrap_or_else(|| fail("E_NO_SUCH_BID"));
        // I8: an ineligible bid can never be awarded, whatever the committee says.
        require(entry[2] & FLAG_INELIGIBLE == 0, "E_BID_INELIGIBLE");
        let already_lapsed = t
            .award
            .as_ref()
            .is_some_and(|a| a.lapsed.contains(&bid_index));
        require(!already_lapsed, "E_BID_LAPSED");

        // Deviation is measured against the first eligible entry of the stored ranking, skipping
        // any bid that has already lapsed: after a lapse the next bid is the natural winner and
        // awarding it is not a deviation.
        let top = rk
            .iter()
            .find(|e| {
                e[2] & FLAG_INELIGIBLE == 0
                    && !t
                        .award
                        .as_ref()
                        .is_some_and(|a| a.lapsed.contains(&(e[0] as u32)))
            })
            .map(|e| e[0] as u32);
        let deviation = top != Some(bid_index);
        if deviation {
            require(
                rationale.chars().count() >= MIN_DEVIATION_RATIONALE_CHARS,
                "E_RATIONALE_REQUIRED",
            );
        }
        self.propose(tender_id, Some(bid_index), amount, rationale, deviation);
    }

    /// Committee member: approve the pending proposal. `bid_index` and `amount` must match it
    /// exactly, so nobody approves a proposal that changed after they read it.
    pub fn approve_award(&mut self, tender_id: u64, bid_index: Option<u32>, amount: U128) {
        let caller = env::predecessor_account_id();
        require(self.committee_member(tender_id, &caller), "E_NOT_COMMITTEE");
        let t = self.tender(tender_id);
        require(t.status == Status::Evaluated, "E_BAD_STATUS");
        let award = t.award.as_ref().unwrap_or_else(|| fail("E_NO_PROPOSAL"));
        require(
            award.bid_index == bid_index && award.amount == amount,
            "E_PROPOSAL_MISMATCH",
        );
        self.approve(tender_id, caller);
    }

    /// Committee member: propose closing with no award. Same threshold as an award; on reaching
    /// it the escrow goes back to the buyer and the tender is `ClosedNoAward`.
    pub fn close_without_award(&mut self, tender_id: u64, rationale: String) {
        let caller = env::predecessor_account_id();
        require(self.committee_member(tender_id, &caller), "E_NOT_COMMITTEE");
        require(
            self.tender(tender_id).status == Status::Evaluated,
            "E_BAD_STATUS",
        );
        require(
            rationale.chars().count() >= MIN_DEVIATION_RATIONALE_CHARS,
            "E_RATIONALE_REQUIRED",
        );
        self.propose(tender_id, None, U128(0), rationale, false);
    }

    /// The awarded bidder, before `accept_by_ns`: accept the amount and name where to be paid.
    /// Accepting is the winner's agreement to the amount; nothing moves until they call this.
    pub fn accept_award(&mut self, tender_id: u64, payout: PayoutTarget) {
        let caller = env::predecessor_account_id();
        let t = self.tender(tender_id);
        require(t.status == Status::Awarded, "E_BAD_STATUS");
        let award = t.award.as_ref().unwrap_or_else(|| fail("E_NO_AWARD"));
        let index = award.bid_index.unwrap_or_else(|| fail("E_NO_AWARD"));
        let accept_by = award.accept_by_ns.unwrap_or_else(|| fail("E_NO_AWARD")).0;
        require(now_ns() < accept_by, "E_ACCEPT_WINDOW_PASSED");
        let slot = self
            .slot_of_result_index(tender_id, index)
            .unwrap_or_else(|| fail("E_NO_SUCH_BID"));
        let winner = self
            .bidder_of_slot(tender_id, slot)
            .unwrap_or_else(|| fail("E_NO_SUCH_BID"));
        require(caller == winner, "E_NOT_WINNER");

        let account = match &payout {
            PayoutTarget::Near { account } => account.clone(),
            // T13 adds the 1Click route; the type accepts it so the API does not change later.
            PayoutTarget::Intents { .. } => fail("E_INTENTS_NOT_ENABLED"),
        };
        let amount = award.amount;
        require(amount.0 <= t.escrowed.0, "E_AMOUNT_OVER_ESCROW");

        let t = self.tender_mut(tender_id);
        t.status = Status::PayingOut;
        if let Some(a) = t.award.as_mut() {
            a.payout = Some(payout.clone());
            a.payout_state = PayoutState::PayingOut {
                deposit_address: None,
            };
        }
        emit(
            "award_accepted",
            json!({"tender_id": tender_id.to_string(), "bid_index": index, "slot": slot,
                   "by": caller, "amount": amount, "payout": payout}),
        );
        self.send_payout(tender_id, account, amount);
    }

    /// Anyone, after the acceptance window: the bid lapses and the committee can award another.
    pub fn lapse_award(&mut self, tender_id: u64) {
        let t = self.tender(tender_id);
        require(t.status == Status::Awarded, "E_BAD_STATUS");
        let award = t.award.as_ref().unwrap_or_else(|| fail("E_NO_AWARD"));
        let index = award.bid_index.unwrap_or_else(|| fail("E_NO_AWARD"));
        let accept_by = award.accept_by_ns.unwrap_or_else(|| fail("E_NO_AWARD")).0;
        require(now_ns() >= accept_by, "E_ACCEPT_WINDOW_OPEN");

        let t = self.tender_mut(tender_id);
        t.status = Status::Evaluated;
        if let Some(a) = t.award.as_mut() {
            if !a.lapsed.contains(&index) {
                a.lapsed.push(index);
            }
            // The proposal is spent: the committee starts a new one, which cannot name this bid.
            a.bid_index = None;
            a.amount = U128(0);
            a.approvals.clear();
            a.approved_at_ns = None;
            a.accept_by_ns = None;
        }
        emit(
            "award_lapsed",
            json!({"tender_id": tender_id.to_string(), "bid_index": index}),
        );
    }

    /// Anyone, after a failed payout (usually the receiver was not storage-registered): send it
    /// again. The amount and the target are the ones the winner already accepted.
    pub fn retry_payout(&mut self, tender_id: u64) {
        let t = self.tender(tender_id);
        require(t.status == Status::PayingOut, "E_BAD_STATUS");
        let award = t.award.as_ref().unwrap_or_else(|| fail("E_NO_AWARD"));
        require(
            matches!(award.payout_state, PayoutState::PayoutFailed { .. }),
            "E_NOT_FAILED",
        );
        let account = match award.payout.as_ref() {
            Some(PayoutTarget::Near { account }) => account.clone(),
            _ => fail("E_NO_AWARD"),
        };
        let amount = award.amount;
        require(amount.0 <= t.escrowed.0, "E_AMOUNT_OVER_ESCROW");
        if let Some(a) = self.tender_mut(tender_id).award.as_mut() {
            a.payout_state = PayoutState::PayingOut {
                deposit_address: None,
            };
        }
        self.send_payout(tender_id, account, amount);
    }

    /// `ft_transfer` result for the award (I9). On success the escrow is debited exactly once and
    /// the remainder goes back to the buyer; on failure nothing moved and the winner can retry.
    #[private]
    pub fn on_payout(&mut self, tender_id: u64, amount: U128) -> bool {
        let ok = !matches!(
            env::promise_result_checked(0, 64),
            Err(PromiseError::Failed)
        );
        let Some(t) = self.tenders.get_mut(&tender_id) else {
            return ok;
        };
        if !ok {
            if let Some(a) = t.award.as_mut() {
                a.payout_state = PayoutState::PayoutFailed {
                    reason: "E_FT_TRANSFER_FAILED".to_string(),
                };
            }
            emit(
                "payout_failed",
                json!({"tender_id": tender_id.to_string(), "amount": amount}),
            );
            return false;
        }
        // I9: the escrow is debited here and nowhere else, so a second callback for the same
        // award cannot pay twice - `PayingOut` is left behind on the first success.
        t.escrowed = U128(t.escrowed.0.saturating_sub(amount.0));
        t.status = Status::Paid;
        if let Some(a) = t.award.as_mut() {
            a.payout_state = PayoutState::Paid;
        }
        emit(
            "payout_completed",
            json!({"tender_id": tender_id.to_string(), "amount": amount,
                   "remainder": t.escrowed}),
        );
        // Whatever the award did not use belongs to the buyer.
        self.refund_escrow(tender_id);
        true
    }
}

impl Contract {
    /// `ft_transfer` of the award amount, with the callback that books it.
    fn send_payout(&mut self, tender_id: u64, account: AccountId, amount: U128) {
        let contract_id = env::current_account_id();
        let t = self.tender(tender_id);
        let args = json!({"receiver_id": account, "amount": amount,
                          "memo": format!("tender {tender_id} award")});
        Promise::new(t.currency_token.clone())
            .function_call(
                "ft_transfer".to_string(),
                args.to_string().into_bytes(),
                ONE_YOCTO,
                GAS_FT_TRANSFER,
            )
            .then(
                Self::ext(contract_id)
                    .with_static_gas(GAS_ON_PAYOUT)
                    .on_payout(tender_id, amount),
            )
            .detach();
    }

    /// The frozen-set slot that a result index names. The evaluator's `rk[i][0]` is an index
    /// into the frozen bid set, not a storage slot: a bid withdrawn before close leaves its slot
    /// out of `frozen.slots`, so from that point the two differ. Bond settlement in
    /// `accept_result` resolves it the same way, and `propose_award` matches the index against
    /// the stored ranking, which is in the same order.
    pub(crate) fn slot_of_result_index(&self, tender_id: u64, index: u32) -> Option<u32> {
        let frozen = self.tender(tender_id).frozen.as_ref()?;
        let i = usize::try_from(index).ok()?;
        frozen.slots.get(i).copied()
    }

    /// The account that submitted the bid in `slot`, if it is still active.
    pub(crate) fn bidder_of_slot(&self, tender_id: u64, slot: u32) -> Option<AccountId> {
        self.bids
            .get(&(tender_id, slot))
            .filter(|b| !b.withdrawn)
            .map(|b| b.bidder.clone())
    }
}
