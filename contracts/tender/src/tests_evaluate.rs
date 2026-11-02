//! Unit tests for T04: close and freeze (I3, I4), evaluate input (docs/04 §6), result
//! validation (I5, I6), retries (I12), bonds settled once in every path (I10).

use super::*;
use crate::evaluate::{Expected, request_gas_for_input, validate_result};
use crate::tender::worst_eval_input_bytes;

/// Closes `id` at the deadline and returns the frozen set.
fn close(c: &mut Contract, id: u64) -> Frozen {
    call(VENDORS[6], NearToken::from_yoctonear(0), DEADLINE);
    c.close_and_evaluate(id);
    c.get_frozen(id).unwrap()
}

fn with_bids(c: &mut Contract, n: usize) -> u64 {
    let id = open(c);
    for (i, v) in VENDORS.iter().take(n).enumerate() {
        bid(c, id, v, i as u8 + 1, NOW + 10 + i as u64);
    }
    id
}

/// A canonical compact result for tender `id`, attempt `attempt`, with ranking `rk`.
fn result(c: &Contract, id: u64, attempt: u8, rk: Value, status: &str) -> String {
    let t = c.get_tender(id).unwrap();
    canonical(&json!({
        "v": 1,
        "tid": id.to_string(),
        "root": t.frozen.unwrap().root,
        "rubric": t.rubric_hash,
        "bundle": "ab".repeat(32),
        "attempt": attempt,
        "status": status,
        "rk": rk,
    }))
}

fn deliver(c: &mut Contract, id: u64, attempt: u8, text: &str) -> bool {
    callback(
        DEADLINE + 10,
        PromiseResult::Successful(serde_json::to_vec(text).unwrap()),
    );
    c.on_evaluate(id, attempt)
}

fn deliver_raw(c: &mut Contract, id: u64, attempt: u8, r: PromiseResult) -> bool {
    callback(DEADLINE + 10, r);
    c.on_evaluate(id, attempt)
}

fn retry(c: &mut Contract, id: u64) {
    call(VENDORS[6], NearToken::from_yoctonear(0), DEADLINE + 20);
    c.retry_evaluate(id);
}

fn outcome(c: &Contract, id: u64, n: usize) -> AttemptOutcome {
    c.get_attempts(id)[n].outcome.clone()
}

// --------------------------------------------------------------- merkle ---

#[test]
fn i4_merkle_leaves_and_roots_match_vectors() {
    call(BUYER, NearToken::from_yoctonear(0), NOW);
    let v: Value = serde_json::from_str(&specs("test-vectors/merkle.json")).unwrap();
    let leaves: Vec<merkle::Hash> = v["leaves_input"]
        .as_array()
        .unwrap()
        .iter()
        .map(|x| {
            merkle::leaf(
                x["bidder"].as_str().unwrap(),
                x["submitted_at_ns"].as_u64().unwrap(),
                x["ciphertext_utf8"].as_str().unwrap().as_bytes(),
            )
        })
        .collect();
    let hexes: Vec<String> = leaves.iter().map(|l| rubric::hex(l)).collect();
    assert_eq!(serde_json::to_value(&hexes).unwrap(), v["leaves"]);
    for tree in v["trees"].as_array().unwrap() {
        let n = tree["n"].as_u64().unwrap() as usize;
        assert_eq!(
            rubric::hex(&merkle::root(&leaves[..n]).unwrap()),
            tree["root"].as_str().unwrap(),
            "n={n}"
        );
    }
    assert!(merkle::root(&[]).is_none());
}

// ---------------------------------------------------------- close (I3, I4) ---

#[test]
#[should_panic(expected = "E_DEADLINE_NOT_REACHED")]
fn i3_no_evaluation_before_the_deadline() {
    let mut c = setup();
    let id = with_bids(&mut c, 2);
    call(VENDORS[6], NearToken::from_yoctonear(0), DEADLINE - 1);
    c.close_and_evaluate(id);
}

#[test]
fn i3_close_at_the_deadline_requests_attempt_one() {
    let mut c = setup();
    let id = with_bids(&mut c, 2);
    close(&mut c, id);
    let t = c.get_tender(id).unwrap();
    assert_eq!(t.status, Status::Evaluating);
    assert_eq!(t.attempts.len(), 1);
    assert_eq!(t.attempts[0].n, 1);
    assert_eq!(t.attempts[0].outcome, AttemptOutcome::Pending);
    let calls = function_calls();
    assert!(calls.iter().any(|(to, m, _, d)| to == OUTLAYER
        && m == "request_execution"
        && *d == t.exec_deposit.as_yoctonear()));
    assert!(calls.iter().any(|(to, m, a, _)| to == CONTRACT
        && m == "on_evaluate"
        && a == &json!({"tender_id": id, "attempt": 1})));
}

#[test]
fn close_without_bids_refunds_the_buyer() {
    let mut c = setup();
    let id = open(&mut c);
    bid(&mut c, id, VENDORS[0], 1, NOW + 10);
    call(VENDORS[0], NearToken::from_yoctonear(0), NOW + 11);
    c.withdraw_bid(id);
    let fee = c.get_tender(id).unwrap().eval_fee_remaining;
    call(VENDORS[6], NearToken::from_yoctonear(0), DEADLINE);
    c.close_and_evaluate(id);
    let t = c.get_tender(id).unwrap();
    assert_eq!(t.status, Status::NoBids);
    assert!(t.frozen.is_none() && t.attempts.is_empty());
    assert_eq!(transfers(), vec![(BUYER.to_string(), fee.as_yoctonear())]);
    let ft: Vec<_> = function_calls()
        .into_iter()
        .filter(|(_, m, _, _)| m == "ft_transfer")
        .collect();
    assert_eq!(ft.len(), 1);
    assert_eq!(ft[0].2["amount"], CAP.to_string());
    assert!(
        function_calls()
            .iter()
            .all(|(_, m, _, _)| m != "request_execution")
    );
}

#[test]
fn i4_bid_set_is_frozen_at_close() {
    let mut c = setup();
    let id = with_bids(&mut c, 3);
    // Slot 1 withdraws and re-bids later: it is ordered by its new submission time.
    call(VENDORS[1], NearToken::from_yoctonear(0), NOW + 30);
    c.withdraw_bid(id);
    bid(&mut c, id, VENDORS[1], 42, NOW + 40);
    let frozen = close(&mut c, id);
    assert_eq!(frozen.slots, vec![0, 2, 3]);
    let expected: Vec<String> = frozen
        .slots
        .iter()
        .map(|s| {
            let b = c.bids.get(&(id, *s)).unwrap();
            rubric::hex(&merkle::leaf(
                b.bidder.as_str(),
                b.submitted_at_ns.0,
                &b.ciphertext,
            ))
        })
        .collect();
    assert_eq!(frozen.leaves, expected);
    let leaves: Vec<merkle::Hash> = frozen
        .leaves
        .iter()
        .map(|h| {
            let mut out = [0u8; 32];
            for (i, o) in out.iter_mut().enumerate() {
                *o = u8::from_str_radix(&h[2 * i..2 * i + 2], 16).unwrap();
            }
            out
        })
        .collect();
    assert_eq!(frozen.root, rubric::hex(&merkle::root(&leaves).unwrap()));

    // Nothing enters or leaves after close.
    assert_fails("E_NOT_OPEN", || {
        bid(&mut c, id, VENDORS[4], 99, DEADLINE + 1);
    });
    call(VENDORS[0], NearToken::from_yoctonear(0), DEADLINE + 1);
    assert_fails("E_NOT_OPEN", || c.withdraw_bid(id));
    call(VENDORS[6], NearToken::from_yoctonear(0), DEADLINE + 1);
    assert_fails("E_BAD_STATUS", || c.close_and_evaluate(id));
    assert_eq!(c.get_frozen(id).unwrap(), frozen);
}

// --------------------------------------------------------- evaluate input ---

#[test]
fn evaluate_input_has_the_docs_04_shape() {
    let mut c = setup();
    let id = with_bids(&mut c, 2);
    let frozen = close(&mut c, id);
    let calls = function_calls();
    let args = &calls
        .iter()
        .find(|(_, m, _, _)| m == "request_execution")
        .unwrap()
        .2;
    assert_eq!(args["response_format"], "Text");
    assert_eq!(args["payer_account_id"], BUYER);
    assert_eq!(
        args["resource_limits"]["max_execution_seconds"],
        EVAL_MAX_SECONDS
    );
    let input: Value = serde_json::from_str(args["input_data"].as_str().unwrap()).unwrap();
    // near-sdk enables serde_json `preserve_order`; compare key sets, not order.
    let sorted = |v: &Value| {
        let mut k: Vec<String> = v.as_object().unwrap().keys().cloned().collect();
        k.sort();
        k
    };
    assert_eq!(
        sorted(&input),
        [
            "action",
            "attempt",
            "bids",
            "bids_root",
            "committee",
            "contract_id",
            "rubric_json",
            "tender_id"
        ]
    );
    assert_eq!(input["action"], "evaluate");
    assert_eq!(input["contract_id"], CONTRACT);
    assert_eq!(input["tender_id"], "1");
    assert_eq!(input["attempt"], 1);
    assert_eq!(input["rubric_json"], rubric_json());
    assert_eq!(input["bids_root"], frozen.root);
    let bids = input["bids"].as_array().unwrap();
    assert_eq!(bids.len(), 2);
    for (i, b) in bids.iter().enumerate() {
        assert_eq!(
            sorted(b),
            [
                "bidder",
                "ciphertext_b64",
                "debrief_pubkey",
                "index",
                "submitted_at_ns"
            ]
        );
        assert_eq!(b["index"], i);
        assert_eq!(b["bidder"], VENDORS[i]);
        assert_eq!(b["submitted_at_ns"], (NOW + 10 + i as u64).to_string());
        assert_eq!(b["ciphertext_b64"], ciphertext(i as u8 + 1));
        assert_eq!(b["debrief_pubkey"], pk("debrief_key"));
    }
    assert_eq!(
        input["committee"],
        json!([{"account": BUYER, "pubkey": pk("committee_key")}, {"account": REVIEWER, "pubkey": pk("debrief_key")}])
    );
}

#[test]
fn worst_case_input_fits_the_gas_budget() {
    let mut c = setup();
    let id = open(&mut c);
    let long: Vec<String> = (0..MAX_BIDS)
        .map(|i| format!("{}{i}.testnet", "v".repeat(55)))
        .collect();
    for (i, v) in long.iter().enumerate() {
        assert_eq!(v.len(), 64);
        call(v, near(1), NOW + 10 + i as u64);
        c.submit_bid(
            id,
            STANDARD.encode(vec![i as u8 + 1; MAX_CIPHERTEXT_BYTES]),
            pk("debrief_key"),
        );
    }
    close(&mut c, id);
    let input = c.evaluate_input(id, 3);
    let bound = worst_eval_input_bytes(&rubric_json(), &committee());
    assert!(input.len() <= bound, "{} > bound {bound}", input.len());
    assert!(bound <= MAX_EVAL_INPUT_BYTES);
    // request + callback + the close itself stay under the 300 Tgas transaction limit.
    let total = request_gas_for_input(MAX_EVAL_INPUT_BYTES).as_gas()
        + GAS_ON_EVALUATE.as_gas()
        + Gas::from_tgas(30).as_gas();
    assert!(total <= Gas::from_tgas(300).as_gas(), "{total}");
}

#[test]
#[should_panic(expected = "E_RUBRIC_TOO_LARGE")]
fn rubric_too_large_for_the_evaluate_input_is_refused() {
    let mut c = setup();
    let mut v = rubric_value();
    v["scope"] = json!("s".repeat(5_000));
    create_with(&mut c, canonical(&v), committee(), DEADLINE);
}

// ------------------------------------------------------ result validation ---

#[test]
fn compact_result_vector_validates() {
    let v: Value = serde_json::from_str(&specs("test-vectors/compact-result.json")).unwrap();
    let i = &v["input"];
    let e = Expected {
        tender_id: 1,
        root: i["bids_root"].as_str().unwrap(),
        rubric_hash: i["rubric_hash"].as_str().unwrap(),
        attempt: 1,
        n_bids: 3,
    };
    let ok = validate_result(v["json"].as_str().unwrap(), &e).unwrap();
    assert_eq!(ok.json, v["json"].as_str().unwrap());
    assert_eq!(ok.bundle, i["bundle_hash"].as_str().unwrap());
    assert_eq!(ok.status, "ok");
    assert_eq!(ok.rk, vec![[0, 7466, 0], [1, 5955, 0], [2, 5700, 24]]);
}

#[test]
fn accepted_result_is_stored_verbatim_and_bonds_refunded() {
    let mut c = setup();
    let id = with_bids(&mut c, 3);
    close(&mut c, id);
    let text = result(
        &c,
        id,
        1,
        json!([[0, 7466, 0], [1, 5955, 0], [2, 5700, 24]]),
        "ok",
    );
    assert!(deliver(&mut c, id, 1, &text));
    let t = c.get_tender(id).unwrap();
    assert_eq!(t.status, Status::Evaluated);
    assert_eq!(c.get_result(id).as_deref(), Some(text.as_str()));
    assert_eq!(outcome(&c, id, 0), AttemptOutcome::Accepted);
    let mut got = transfers();
    got.sort();
    let bond = milli(100).as_yoctonear();
    assert_eq!(
        got,
        vec![
            (VENDORS[0].into(), bond),
            (VENDORS[1].into(), bond),
            (VENDORS[2].into(), bond)
        ]
    );
    assert!(c.get_bids(id).iter().all(|b| b.bond_settled));
    assert_eq!(
        events("evaluation_accepted")[0]["data"][0]["bundle"],
        "ab".repeat(32)
    );
}

#[test]
fn bonds_of_unreadable_or_copied_bids_go_to_the_buyer() {
    let mut c = setup();
    let id = with_bids(&mut c, 3);
    close(&mut c, id);
    // index 1: copied ciphertext (ACCOUNT_MISMATCH|INELIGIBLE = 5); index 2: DECRYPT_FAILED|INELIGIBLE = 3.
    let text = result(&c, id, 1, json!([[0, 8800, 0], [1, 0, 5], [2, 0, 3]]), "ok");
    assert!(deliver(&mut c, id, 1, &text));
    let bond = milli(100).as_yoctonear();
    let mut got = transfers();
    got.sort();
    assert_eq!(
        got,
        vec![
            (BUYER.into(), bond),
            (BUYER.into(), bond),
            (VENDORS[0].into(), bond)
        ]
    );
    let settled = &events("bonds_settled")[0]["data"][0];
    assert_eq!(settled["forfeited"].as_array().unwrap().len(), 2);
}

#[test]
fn i5_second_result_rejected() {
    let mut c = setup();
    let id = with_bids(&mut c, 2);
    close(&mut c, id);
    let first = result(&c, id, 1, json!([[0, 7800, 0], [1, 6400, 0]]), "ok");
    assert!(deliver(&mut c, id, 1, &first));
    let second = result(&c, id, 1, json!([[1, 9000, 0], [0, 1000, 0]]), "ok");
    assert!(!deliver(&mut c, id, 1, &second));
    assert!(get_logs().iter().any(|l| l == "E_STALE_RESULT"));
    assert!(transfers().is_empty(), "no bond is settled twice");
    assert_eq!(c.get_result(id).as_deref(), Some(first.as_str()));
    assert_eq!(c.get_tender(id).unwrap().status, Status::Evaluated);
    // No retry after acceptance either.
    call(VENDORS[6], NearToken::from_yoctonear(0), DEADLINE + 30);
    assert_fails("E_BAD_STATUS", || c.retry_evaluate(id));
}

#[test]
fn i6_crafted_results_are_rejected() {
    let mut c = setup();
    let id = with_bids(&mut c, 3);
    close(&mut c, id);
    let t = c.get_tender(id).unwrap();
    let root = t.frozen.clone().unwrap().root;
    let good = json!({"v": 1, "tid": "1", "root": root, "rubric": t.rubric_hash, "bundle": "ab".repeat(32),
        "attempt": 1, "status": "ok", "rk": [[0, 7466, 0], [1, 5955, 0], [2, 5700, 24]]});
    let e = Expected {
        tender_id: id,
        root: &root,
        rubric_hash: &t.rubric_hash,
        attempt: 1,
        n_bids: 3,
    };
    assert!(validate_result(&canonical(&good), &e).is_ok());

    let with = |k: &str, v: Value| {
        let mut x = good.clone();
        x[k] = v;
        canonical(&x)
    };
    let cases: Vec<(String, &str)> = vec![
        (with("tid", json!("2")), "E_RESULT_TID"),
        (with("root", json!("cd".repeat(32))), "E_RESULT_ROOT"),
        (with("rubric", json!("cd".repeat(32))), "E_RESULT_RUBRIC"),
        (with("attempt", json!(2)), "E_RESULT_ATTEMPT"),
        (with("v", json!(2)), "E_RESULT_VERSION"),
        (with("bundle", json!("xyz")), "E_RESULT_FORMAT"),
        (
            with("rk", json!([[0, 7466, 0], [1, 5955, 0]])),
            "E_RESULT_RANKING",
        ),
        (
            with("rk", json!([[0, 7466, 0], [1, 5955, 0], [3, 5700, 24]])),
            "E_RESULT_RANKING",
        ),
        (
            with("rk", json!([[0, 7466, 0], [0, 5955, 0], [2, 5700, 24]])),
            "E_RESULT_RANKING",
        ),
        (
            with(
                "rk",
                json!([[0, 7466, 0], [1, 5955, 0], [2, 5700, 24], [3, 0, 1]]),
            ),
            "E_RESULT_RANKING",
        ),
        (
            with("rk", json!([[0, 10001, 0], [1, 5955, 0], [2, 5700, 24]])),
            "E_RESULT_RANGE",
        ),
        (
            with("rk", json!([[0, 7466, 128], [1, 5955, 0], [2, 5700, 24]])),
            "E_RESULT_RANGE",
        ),
        (
            with("rk", json!([[0, 7466, 4], [1, 5955, 0], [2, 5700, 24]])),
            "E_RESULT_RANGE",
        ),
        (
            with("rk", json!([[0, 7466, 0], [1, 5955, 0], [2, 10, 1]])),
            "E_RESULT_RANGE",
        ),
        (
            with("rk", json!([[0, 5955, 0], [1, 7466, 0], [2, 5700, 24]])),
            "E_RESULT_ORDER",
        ),
        (
            with("rk", json!([[2, 0, 1], [0, 7466, 0], [1, 5955, 0]])),
            "E_RESULT_ORDER",
        ),
        (
            with("rk", json!([[0, 7466, 0], [2, 0, 1], [1, 0, 1]])),
            "E_RESULT_ORDER",
        ),
        (with("status", json!("needs_committee")), "E_RESULT_STATUS"),
        (
            with("rk", json!([[0, 7466, 64], [1, 5955, 0], [2, 5700, 24]])),
            "E_RESULT_STATUS",
        ),
        (
            with("rk", json!([[0, 0, 1], [1, 0, 3], [2, 0, 5]])),
            "E_RESULT_STATUS",
        ),
        (with("extra", json!(1)), "E_RESULT_FORMAT"),
        (
            serde_json::to_string_pretty(&good).unwrap(),
            "E_RESULT_NOT_CANONICAL",
        ),
        (
            canonical(&good).replace("\"v\":1", "\"v\":1.0"),
            "E_RESULT_NOT_CANONICAL",
        ),
        (format!("{} ", canonical(&good)), "E_RESULT_NOT_CANONICAL"),
        ("x".repeat(901), "E_RESULT_TOO_LARGE"),
        ("not json".into(), "E_RESULT_FORMAT"),
    ];
    for (text, code) in &cases {
        assert_eq!(validate_result(text, &e).err(), Some(*code), "{text}");
    }
    // Through the callback: rejected, recorded, nothing stored, bonds untouched.
    assert!(!deliver(&mut c, id, 1, &cases[1].0));
    let t = c.get_tender(id).unwrap();
    assert_eq!(t.status, Status::EvalFailed);
    assert_eq!(
        outcome(&c, id, 0),
        AttemptOutcome::Failed {
            reason: "E_RESULT_ROOT".into()
        }
    );
    assert!(t.result_json.is_none());
    assert!(transfers().is_empty());
    assert!(c.get_bids(id).iter().all(|b| !b.bond_settled));
}

#[test]
fn failed_runs_and_promises_are_recorded() {
    let mut c = setup();
    let id = with_bids(&mut c, 1);
    close(&mut c, id);
    assert!(!deliver_raw(
        &mut c,
        id,
        1,
        PromiseResult::Successful(b"null".to_vec())
    ));
    assert_eq!(
        outcome(&c, id, 0),
        AttemptOutcome::Failed {
            reason: "E_EVAL_RUN_FAILED".into()
        }
    );
    retry(&mut c, id);
    assert!(!deliver_raw(&mut c, id, 2, PromiseResult::Failed));
    assert_eq!(
        outcome(&c, id, 1),
        AttemptOutcome::Failed {
            reason: "E_EVAL_PROMISE_FAILED".into()
        }
    );
    assert_eq!(c.get_tender(id).unwrap().status, Status::EvalFailed);
}

// ---------------------------------------------------------------- retries ---

#[test]
fn i12_failure_retry_success() {
    let mut c = setup();
    let id = with_bids(&mut c, 2);
    close(&mut c, id);
    // Retry is refused while attempt 1 is in flight.
    call(VENDORS[6], NearToken::from_yoctonear(0), DEADLINE + 1);
    assert_fails("E_BAD_STATUS", || c.retry_evaluate(id));
    assert!(!deliver_raw(
        &mut c,
        id,
        1,
        PromiseResult::Successful(b"null".to_vec())
    ));
    retry(&mut c, id);
    let t = c.get_tender(id).unwrap();
    assert_eq!(t.status, Status::Evaluating);
    assert_eq!(
        t.attempts.iter().map(|a| a.n).collect::<Vec<_>>(),
        vec![1, 2]
    );
    let input: Value = serde_json::from_str(&c.evaluate_input(id, 2)).unwrap();
    assert_eq!(input["attempt"], 2);
    assert_eq!(input["bids_root"], t.frozen.clone().unwrap().root);

    // A late result for attempt 1 is stale; attempt 2's result is accepted.
    let late = result(&c, id, 1, json!([[0, 7800, 0], [1, 6400, 0]]), "ok");
    assert!(!deliver(&mut c, id, 1, &late));
    assert_eq!(c.get_tender(id).unwrap().status, Status::Evaluating);
    let ok = result(&c, id, 2, json!([[0, 7800, 0], [1, 6400, 0]]), "ok");
    assert!(deliver(&mut c, id, 2, &ok));
    let t = c.get_tender(id).unwrap();
    assert_eq!(t.status, Status::Evaluated);
    assert_eq!(
        t.attempts[0].outcome,
        AttemptOutcome::Failed {
            reason: "E_EVAL_RUN_FAILED".into()
        }
    );
    assert_eq!(t.attempts[1].outcome, AttemptOutcome::Accepted);
}

#[test]
fn i12_three_failures_fail_the_tender_and_refund_everything() {
    let mut c = setup();
    let id = with_bids(&mut c, 2);
    close(&mut c, id);
    for n in 1..=3u8 {
        if n > 1 {
            retry(&mut c, id);
        }
        assert!(!deliver_raw(
            &mut c,
            id,
            n,
            PromiseResult::Successful(b"null".to_vec())
        ));
    }
    let t = c.get_tender(id).unwrap();
    assert_eq!(t.status, Status::Failed);
    assert_eq!(t.attempts.len(), 3);
    assert!(
        t.attempts
            .iter()
            .all(|a| matches!(a.outcome, AttemptOutcome::Failed { .. }))
    );
    // Everything back, once: both bonds, the remaining fee, the escrow.
    let bond = milli(100).as_yoctonear();
    let mut got = transfers();
    got.sort();
    assert_eq!(got.len(), 3);
    assert!(got.contains(&(VENDORS[0].into(), bond)) && got.contains(&(VENDORS[1].into(), bond)));
    assert!(got.iter().any(|(to, _)| to == BUYER));
    let ft: Vec<_> = function_calls()
        .into_iter()
        .filter(|(_, m, _, _)| m == "ft_transfer")
        .collect();
    assert_eq!(ft.len(), 1);
    assert_eq!(ft[0].2["amount"], CAP.to_string());
    assert!(t.eval_fee_remaining.is_zero() && t.escrowed == U128(0));
    assert!(c.get_bids(id).iter().all(|b| b.bond_settled));
    call(VENDORS[6], NearToken::from_yoctonear(0), DEADLINE + 40);
    assert_fails("E_BAD_STATUS", || c.retry_evaluate(id));
}

#[test]
fn eval_budget_survives_two_key_retries() {
    let mut c = setup();
    let id = create(&mut c);
    for _ in 0..2 {
        call(BUYER, NearToken::from_yoctonear(0), NOW + 1);
        c.retry_pubkey(id);
    }
    set_key(&mut c, id);
    fund(&mut c, id);
    bid(&mut c, id, VENDORS[0], 1, NOW + 10);
    close(&mut c, id);
    for n in 1..=3u8 {
        if n > 1 {
            retry(&mut c, id);
        }
        assert_eq!(
            c.get_tender(id).unwrap().attempts.len(),
            usize::from(n),
            "attempt {n} was requested"
        );
        assert!(!deliver_raw(&mut c, id, n, PromiseResult::Failed));
    }
    assert_eq!(c.get_tender(id).unwrap().status, Status::Failed);
}

// -------------------------------------------------- bonds settled once (I10) ---

#[test]
fn i10_bonds_settled_once_across_withdraw_failure_and_retry() {
    let mut c = setup();
    let id = with_bids(&mut c, 3);
    call(VENDORS[2], NearToken::from_yoctonear(0), NOW + 30);
    c.withdraw_bid(id); // settled now
    close(&mut c, id);
    assert!(!deliver_raw(&mut c, id, 1, PromiseResult::Failed));
    assert!(
        transfers().is_empty(),
        "a failure below MAX_ATTEMPTS settles nothing"
    );
    retry(&mut c, id);
    let text = result(&c, id, 2, json!([[1, 7000, 0], [0, 0, 3]]), "ok");
    assert!(deliver(&mut c, id, 2, &text));
    let bond = milli(100).as_yoctonear();
    let mut got = transfers();
    got.sort();
    assert_eq!(got, vec![(BUYER.into(), bond), (VENDORS[1].into(), bond)]);
    assert!(c.get_bids(id).iter().all(|b| b.bond_settled));
}
