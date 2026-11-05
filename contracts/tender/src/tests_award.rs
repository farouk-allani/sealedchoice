//! Unit tests for T08: award, acceptance, payout, lapse and no-award.
//! I8 (who may decide, deviation rationale, ineligible and lapsed bids), I9 (payout only to the
//! declared target, once, within the escrow, remainder to the buyer).

use super::*;
use crate::types::{PayoutState, PayoutTarget};

/// An open tender whose rubric asks for `required` approvals.
fn open_with_approvals(c: &mut Contract, required: u64) -> u64 {
    let mut v = rubric_value();
    v["award_policy"]["approvals_required"] = json!(required);
    let id = create_with(c, canonical(&v), committee(), DEADLINE);
    set_key(c, id);
    fund(c, id);
    id
}

/// A tender evaluated with `rk`, ready for the committee.
fn evaluated(c: &mut Contract, n: usize, rk: Value) -> u64 {
    evaluated_with(c, n, rk, 1)
}

fn evaluated_with(c: &mut Contract, n: usize, rk: Value, approvals: u64) -> u64 {
    let id = if approvals == 1 {
        open(c)
    } else {
        open_with_approvals(c, approvals)
    };
    for (i, v) in VENDORS.iter().take(n).enumerate() {
        bid(c, id, v, i as u8 + 1, NOW + 10 + i as u64);
    }
    call(VENDORS[6], NearToken::from_yoctonear(0), DEADLINE);
    c.close_and_evaluate(id);
    let t = c.get_tender(id).unwrap();
    let text = canonical(&json!({
        "v": 1,
        "tid": id.to_string(),
        "root": t.frozen.unwrap().root,
        "rubric": t.rubric_hash,
        "bundle": "ab".repeat(32),
        "attempt": 1,
        "status": "ok",
        "rk": rk,
    }));
    callback(
        DEADLINE + 10,
        PromiseResult::Successful(serde_json::to_vec(&text).unwrap()),
    );
    assert!(c.on_evaluate(id, 1), "the result should be accepted");
    assert_eq!(c.get_tender(id).unwrap().status, Status::Evaluated);
    id
}

/// The usual shape: three bids, vendor 0 on top, all eligible, awarded for the full cap.
fn awarded(c: &mut Contract) -> u64 {
    awarded_for(c, CAP)
}

/// With `approvals_required: 1` the proposer's own approval decides it, so a tender is `Awarded`
/// the moment it is proposed and there is no pending proposal left to replace. A test that needs
/// a different amount has to ask for it here.
fn awarded_for(c: &mut Contract, amount: u128) -> u64 {
    let id = evaluated(c, 3, json!([[0, 8166, 0], [2, 5200, 8], [1, 4755, 0]]));
    call(BUYER, NearToken::from_yoctonear(0), DEADLINE + 20);
    c.propose_award(id, 0, U128(amount), "top of the ranking".into());
    assert_eq!(c.get_tender(id).unwrap().status, Status::Awarded);
    id
}

fn accept_by(c: &Contract, id: u64) -> u64 {
    c.get_award(id).unwrap().accept_by_ns.unwrap().0
}

/// Runs the ft_transfer callback for a payout.
fn payout_result(c: &mut Contract, id: u64, amount: u128, ok: bool, at: u64) -> bool {
    callback(
        at,
        if ok {
            PromiseResult::Successful(b"".to_vec())
        } else {
            PromiseResult::Failed
        },
    );
    c.on_payout(id, U128(amount))
}

// ----------------------------------------------------------------- I8: who decides, and how

#[test]
fn i8_only_a_committee_member_proposes_or_approves() {
    let mut c = setup();
    let id = evaluated(&mut c, 3, json!([[0, 8166, 0], [1, 4755, 0], [2, 1000, 0]]));
    call(VENDORS[0], NearToken::from_yoctonear(0), DEADLINE + 20);
    assert_fails("E_NOT_COMMITTEE", || {
        c.propose_award(id, 0, U128(CAP), "mine".into())
    });
    call(BUYER, NearToken::from_yoctonear(0), DEADLINE + 20);
    c.propose_award(id, 0, U128(CAP), "top of the ranking".into());
    call(VENDORS[0], NearToken::from_yoctonear(0), DEADLINE + 21);
    assert_fails("E_NOT_COMMITTEE", || {
        c.approve_award(id, Some(0), U128(CAP))
    });
}

#[test]
fn i8_deviating_from_the_ranking_needs_a_rationale() {
    let mut c = setup();
    // Two approvals, so the first proposal stays pending and a second one can replace it.
    let id = evaluated_with(
        &mut c,
        3,
        json!([[0, 8166, 0], [1, 4755, 0], [2, 1000, 0]]),
        2,
    );
    call(BUYER, NearToken::from_yoctonear(0), DEADLINE + 20);
    // Bid 1 is not the top of the ranking, so a short rationale is refused.
    assert_fails("E_RATIONALE_REQUIRED", || {
        c.propose_award(id, 1, U128(CAP), "because".into())
    });
    c.propose_award(
        id,
        1,
        U128(CAP),
        "the top bidder withdrew from the market last week".into(),
    );
    let a = c.get_award(id).unwrap();
    assert!(
        a.deviation,
        "awarding anything but the top bid is a deviation"
    );
    // The top bid needs no rationale at all.
    c.propose_award(id, 0, U128(CAP), String::new());
    assert!(!c.get_award(id).unwrap().deviation);
}

#[test]
fn i8_an_ineligible_bid_can_never_be_awarded() {
    let mut c = setup();
    // Bid 2 is ineligible (flag 1) and ranked last with 0, as the evaluator writes it.
    let id = evaluated(&mut c, 3, json!([[0, 8166, 0], [1, 4755, 0], [2, 0, 1]]));
    call(BUYER, NearToken::from_yoctonear(0), DEADLINE + 20);
    assert_fails("E_BID_INELIGIBLE", || {
        c.propose_award(
            id,
            2,
            U128(CAP),
            "we liked their proposal despite the ineligibility".into(),
        )
    });
}

#[test]
fn i8_an_approval_must_match_the_proposal_it_approves() {
    let mut c = setup();
    let id = evaluated_with(
        &mut c,
        3,
        json!([[0, 8166, 0], [1, 4755, 0], [2, 1000, 0]]),
        2,
    );
    call(BUYER, NearToken::from_yoctonear(0), DEADLINE + 20);
    c.propose_award(id, 0, U128(CAP), "top of the ranking".into());
    call(REVIEWER, NearToken::from_yoctonear(0), DEADLINE + 21);
    assert_fails("E_PROPOSAL_MISMATCH", || {
        c.approve_award(id, Some(0), U128(CAP - 1))
    });
    assert_fails("E_PROPOSAL_MISMATCH", || {
        c.approve_award(id, Some(1), U128(CAP))
    });
}

#[test]
fn i8_a_new_proposal_resets_the_approvals_of_the_old_one() {
    let mut c = setup();
    let id = evaluated_with(
        &mut c,
        3,
        json!([[0, 8166, 0], [1, 4755, 0], [2, 1000, 0]]),
        2,
    );
    call(BUYER, NearToken::from_yoctonear(0), DEADLINE + 20);
    c.propose_award(id, 0, U128(CAP), "top of the ranking".into());
    assert_eq!(c.get_award(id).unwrap().approvals.len(), 1);
    // A second proposal, by the same member, starts the count again: an approval that arrives
    // later must apply to what its sender read, not to whatever is pending by then.
    c.propose_award(id, 0, U128(CAP / 2), "they agreed a lower price".into());
    let a = c.get_award(id).unwrap();
    assert_eq!(a.approvals.len(), 1);
    assert_eq!(a.amount, U128(CAP / 2));
    assert_eq!(c.get_tender(id).unwrap().status, Status::Evaluated);
}

#[test]
fn two_approvals_award_when_the_rubric_asks_for_two() {
    let mut c = setup();
    let id = evaluated_with(
        &mut c,
        3,
        json!([[0, 8166, 0], [1, 4755, 0], [2, 1000, 0]]),
        2,
    );
    call(BUYER, NearToken::from_yoctonear(0), DEADLINE + 20);
    c.propose_award(id, 0, U128(CAP), "top of the ranking".into());
    assert_eq!(c.get_tender(id).unwrap().status, Status::Evaluated);
    call(REVIEWER, NearToken::from_yoctonear(0), DEADLINE + 21);
    c.approve_award(id, Some(0), U128(CAP));
    assert_eq!(c.get_tender(id).unwrap().status, Status::Awarded);
    assert_eq!(c.get_award(id).unwrap().approvals.len(), 2);
}

#[test]
fn an_amount_over_the_budget_cap_is_refused() {
    let mut c = setup();
    let id = evaluated(&mut c, 3, json!([[0, 8166, 0], [1, 4755, 0], [2, 1000, 0]]));
    call(BUYER, NearToken::from_yoctonear(0), DEADLINE + 20);
    assert_fails("E_BAD_AMOUNT", || {
        c.propose_award(id, 0, U128(CAP + 1), String::new())
    });
    assert_fails("E_BAD_AMOUNT", || {
        c.propose_award(id, 0, U128(0), String::new())
    });
}

// ----------------------------------------------------------------- I9: the money

#[test]
fn i9_only_the_awarded_bidder_accepts() {
    let mut c = setup();
    let id = awarded(&mut c);
    call(VENDORS[1], NearToken::from_yoctonear(0), DEADLINE + 30);
    assert_fails("E_NOT_WINNER", || {
        c.accept_award(
            id,
            PayoutTarget::Near {
                account: acc(VENDORS[1]),
            },
        )
    });
    call(BUYER, NearToken::from_yoctonear(0), DEADLINE + 30);
    assert_fails("E_NOT_WINNER", || {
        c.accept_award(
            id,
            PayoutTarget::Near {
                account: acc(BUYER),
            },
        )
    });
}

#[test]
fn i9_payout_pays_once_and_the_remainder_goes_back_to_the_buyer() {
    let mut c = setup();
    // Award less than the cap, so the remainder going back to the buyer is visible.
    let amount = CAP - 3_000_000_000;
    let id = awarded_for(&mut c, amount);
    call(VENDORS[0], NearToken::from_yoctonear(0), DEADLINE + 30);
    c.accept_award(
        id,
        PayoutTarget::Near {
            account: acc(VENDORS[0]),
        },
    );
    assert_eq!(c.get_tender(id).unwrap().status, Status::PayingOut);

    assert!(payout_result(&mut c, id, amount, true, DEADLINE + 40));
    let t = c.get_tender(id).unwrap();
    assert_eq!(t.status, Status::Paid);
    // The escrow was debited by the award and the rest left for the buyer.
    assert_eq!(
        t.escrowed,
        U128(0),
        "the remainder refund clears the escrow"
    );
    assert!(matches!(
        c.get_award(id).unwrap().payout_state,
        PayoutState::Paid
    ));

    // A second callback for the same award must not pay again.
    let before = c.get_tender(id).unwrap().escrowed;
    assert!(payout_result(&mut c, id, amount, true, DEADLINE + 41));
    assert_eq!(c.get_tender(id).unwrap().escrowed, before);
}

#[test]
fn i9_a_failed_payout_keeps_the_escrow_and_can_be_retried() {
    let mut c = setup();
    let id = awarded(&mut c);
    call(VENDORS[0], NearToken::from_yoctonear(0), DEADLINE + 30);
    c.accept_award(
        id,
        PayoutTarget::Near {
            account: acc(VENDORS[0]),
        },
    );

    assert!(!payout_result(&mut c, id, CAP, false, DEADLINE + 40));
    let t = c.get_tender(id).unwrap();
    assert_eq!(t.status, Status::PayingOut, "still paying out, not Paid");
    assert_eq!(t.escrowed, U128(CAP), "nothing moved");
    assert!(matches!(
        c.get_award(id).unwrap().payout_state,
        PayoutState::PayoutFailed { .. }
    ));

    call(VENDORS[0], NearToken::from_yoctonear(0), DEADLINE + 50);
    c.retry_payout(id);
    assert!(payout_result(&mut c, id, CAP, true, DEADLINE + 60));
    assert_eq!(c.get_tender(id).unwrap().status, Status::Paid);
}

#[test]
fn retry_payout_only_after_a_failure() {
    let mut c = setup();
    let id = awarded(&mut c);
    call(VENDORS[0], NearToken::from_yoctonear(0), DEADLINE + 30);
    c.accept_award(
        id,
        PayoutTarget::Near {
            account: acc(VENDORS[0]),
        },
    );
    call(VENDORS[0], NearToken::from_yoctonear(0), DEADLINE + 35);
    assert_fails("E_NOT_FAILED", || c.retry_payout(id));
}

#[test]
fn the_intents_route_is_refused_until_t13() {
    let mut c = setup();
    let id = awarded(&mut c);
    call(VENDORS[0], NearToken::from_yoctonear(0), DEADLINE + 30);
    assert_fails("E_INTENTS_NOT_ENABLED", || {
        c.accept_award(
            id,
            PayoutTarget::Intents {
                destination_asset: "nep141:usdc.near".into(),
                recipient: "0xabc".into(),
            },
        )
    });
}

// ----------------------------------------------------------------- lapse and no award

#[test]
fn an_unaccepted_award_lapses_and_the_next_bid_can_be_awarded() {
    let mut c = setup();
    let id = awarded(&mut c);
    let by = accept_by(&c, id);

    call(VENDORS[6], NearToken::from_yoctonear(0), by - 1);
    assert_fails("E_ACCEPT_WINDOW_OPEN", || c.lapse_award(id));

    call(VENDORS[6], NearToken::from_yoctonear(0), by);
    c.lapse_award(id);
    let t = c.get_tender(id).unwrap();
    assert_eq!(t.status, Status::Evaluated);
    assert_eq!(c.get_award(id).unwrap().lapsed, vec![0]);

    // The lapsed bid cannot be awarded again.
    call(BUYER, NearToken::from_yoctonear(0), by + 10);
    assert_fails("E_BID_LAPSED", || {
        c.propose_award(id, 0, U128(CAP), "they came back to us about it".into())
    });

    // The next bid in the ranking is now the natural winner, so it is not a deviation and needs
    // no rationale. The ranking here is [0, 2, 1], so bid 2 follows bid 0.
    c.propose_award(id, 2, U128(CAP), String::new());
    let a = c.get_award(id).unwrap();
    assert!(
        !a.deviation,
        "the next bid after a lapse is not a deviation"
    );
    assert_eq!(c.get_tender(id).unwrap().status, Status::Awarded);
}

#[test]
fn the_winner_cannot_accept_after_the_window() {
    let mut c = setup();
    let id = awarded(&mut c);
    let by = accept_by(&c, id);
    call(VENDORS[0], NearToken::from_yoctonear(0), by);
    assert_fails("E_ACCEPT_WINDOW_PASSED", || {
        c.accept_award(
            id,
            PayoutTarget::Near {
                account: acc(VENDORS[0]),
            },
        )
    });
}

#[test]
fn close_without_award_refunds_the_escrow() {
    let mut c = setup();
    let id = evaluated(&mut c, 3, json!([[0, 8166, 0], [1, 4755, 0], [2, 1000, 0]]));
    call(BUYER, NearToken::from_yoctonear(0), DEADLINE + 20);
    assert_fails("E_RATIONALE_REQUIRED", || {
        c.close_without_award(id, "no".into())
    });
    c.close_without_award(
        id,
        "every bid came in above what the department can spend".into(),
    );
    let t = c.get_tender(id).unwrap();
    assert_eq!(t.status, Status::ClosedNoAward);
    assert_eq!(t.escrowed, U128(0), "the escrow went back to the buyer");
}

#[test]
fn awarding_needs_an_evaluated_tender() {
    let mut c = setup();
    let id = open(&mut c);
    call(BUYER, NearToken::from_yoctonear(0), NOW + 20);
    assert_fails("E_BAD_STATUS", || {
        c.propose_award(id, 0, U128(CAP), String::new())
    });
    assert_fails("E_BAD_STATUS", || c.lapse_award(id));
}

#[test]
fn every_transition_emits_an_event() {
    let mut c = setup();
    let id = awarded(&mut c);
    let names = |logs: Vec<String>| -> Vec<String> {
        logs.iter()
            .filter_map(|l| l.strip_prefix("EVENT_JSON:").map(str::to_string))
            .filter_map(|j| {
                serde_json::from_str::<Value>(&j)
                    .ok()?
                    .get("event")?
                    .as_str()
                    .map(str::to_string)
            })
            .collect()
    };
    let proposed = names(get_logs());
    assert!(
        proposed.contains(&"award_proposed".to_string()),
        "{proposed:?}"
    );
    assert!(
        proposed.contains(&"award_approved".to_string()),
        "{proposed:?}"
    );
    assert!(
        proposed.contains(&"award_decided".to_string()),
        "{proposed:?}"
    );

    call(VENDORS[0], NearToken::from_yoctonear(0), DEADLINE + 30);
    c.accept_award(
        id,
        PayoutTarget::Near {
            account: acc(VENDORS[0]),
        },
    );
    assert!(names(get_logs()).contains(&"award_accepted".to_string()));

    payout_result(&mut c, id, CAP, true, DEADLINE + 40);
    assert!(names(get_logs()).contains(&"payout_completed".to_string()));
}
