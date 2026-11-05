//! Unit tests (VMContextBuilder) for T03: rubric rules, tender key callback, escrow (I11),
//! bids (I2, I13), bonds (I10), cancel, immutability (I1). Vectors load by relative path.

use super::*;
use crate::rubric::{jcs, parse_rubric};
use near_sdk::base64::Engine;
use near_sdk::base64::engine::general_purpose::STANDARD;
use near_sdk::json_types::{U64, U128};
use near_sdk::mock::MockAction;
use near_sdk::serde_json::{self, Value, json};
use near_sdk::test_utils::{VMContextBuilder, get_created_receipts, get_logs};
use near_sdk::{PromiseOrValue, PromiseResult, RuntimeFeesConfig, test_vm_config, testing_env};

const CONTRACT: &str = "tenders.testnet";
const OWNER: &str = "owner.testnet";
const OUTLAYER: &str = "outlayer.testnet";
const BUYER: &str = "buyer.testnet";
const REVIEWER: &str = "reviewer.testnet";
const TOKEN: &str = "usdc.fakes.testnet";
const VENDORS: [&str; 7] = [
    "vendor-a.testnet",
    "vendor-b.testnet",
    "vendor-c.testnet",
    "vendor-d.testnet",
    "vendor-e.testnet",
    "vendor-f.testnet",
    "vendor-g.testnet",
];

const NOW: u64 = 1_762_000_000_000_000_000;
const MINUTE: u64 = 60_000_000_000;
const HOUR: u64 = 60 * MINUTE;
const DEADLINE: u64 = NOW + HOUR;
const MIN_DELAY: u64 = 5 * MINUTE;
const CAP: u128 = 15_000_000_000;
const WASM_SHA: &str = "5c481606498ba9b07190ef0b3a6f01850078daa5bea6a6528403b7e033388c49";

fn acc(s: &str) -> AccountId {
    s.parse().unwrap()
}

fn near(n: u128) -> NearToken {
    NearToken::from_near(n)
}

fn milli(n: u128) -> NearToken {
    NearToken::from_millinear(n)
}

fn specs(rel: &str) -> String {
    std::fs::read_to_string(format!("{}/../../specs/{rel}", env!("CARGO_MANIFEST_DIR"))).unwrap()
}

fn keys_vector() -> Value {
    serde_json::from_str(&specs("test-vectors/hashes-and-keys.json")).unwrap()
}

/// Public keys from hashes-and-keys.json (fake, published).
fn pk(name: &str) -> String {
    keys_vector()[name]["pk_compressed_hex"]
        .as_str()
        .unwrap()
        .to_string()
}

fn rubric_value() -> Value {
    serde_json::from_str(&specs("examples/rubric.example.json")).unwrap()
}

fn canonical(v: &Value) -> String {
    String::from_utf8(jcs(v).unwrap()).unwrap()
}

fn rubric_json() -> String {
    canonical(&rubric_value())
}

fn committee() -> Vec<CommitteeMember> {
    vec![
        CommitteeMember {
            account: acc(BUYER),
            report_pubkey: pk("committee_key"),
        },
        CommitteeMember {
            account: acc(REVIEWER),
            report_pubkey: pk("debrief_key"),
        },
    ]
}

fn evaluator() -> EvaluatorRef {
    EvaluatorRef {
        wasm_url: "https://example.org/evaluator-v1.wasm".into(),
        wasm_sha256: WASM_SHA.into(),
        build_target: "wasm32-wasip2".into(),
        source_tag: "evaluator-v1.0.0".into(),
    }
}

fn ctx(predecessor: &str, deposit: NearToken, ts: u64) -> VMContextBuilder {
    let mut b = VMContextBuilder::new();
    b.current_account_id(acc(CONTRACT))
        .signer_account_id(acc(predecessor))
        .predecessor_account_id(acc(predecessor))
        .attached_deposit(deposit)
        .block_timestamp(ts)
        .account_balance(near(10_000));
    b
}

fn call(predecessor: &str, deposit: NearToken, ts: u64) {
    testing_env!(ctx(predecessor, deposit, ts).build());
}

/// A callback call from the contract to itself with one promise result.
fn callback(ts: u64, result: PromiseResult) {
    testing_env!(
        ctx(CONTRACT, NearToken::from_yoctonear(0), ts).build(),
        test_vm_config(),
        RuntimeFeesConfig::test(),
        Default::default(),
        vec![result],
    );
}

fn setup() -> Contract {
    call(OWNER, NearToken::from_yoctonear(0), NOW);
    let mut c = Contract::new(
        acc(OWNER),
        acc(OUTLAYER),
        SecretsRef {
            profile: "evaluator".into(),
            account_id: acc(OWNER),
        },
        MIN_DELAY,
    );
    c.add_evaluator(evaluator());
    c
}

fn create_with(
    c: &mut Contract,
    rubric: String,
    committee: Vec<CommitteeMember>,
    deadline: u64,
) -> u64 {
    call(BUYER, near(1), NOW);
    c.create_tender(rubric, U64(deadline), milli(100), committee, 0)
}

fn create(c: &mut Contract) -> u64 {
    create_with(c, rubric_json(), committee(), DEADLINE)
}

/// What the evaluator prints for derive_pubkey, wrapped as OutLayer's `Text` callback payload.
fn key_payload(tid: &str, pk_hex: &str) -> Vec<u8> {
    serde_json::to_vec(&json!({"v": 1, "tid": tid, "pk": pk_hex}).to_string()).unwrap()
}

fn set_key(c: &mut Contract, id: u64) {
    callback(
        NOW + 1,
        PromiseResult::Successful(key_payload(&id.to_string(), &pk("tender_key"))),
    );
    assert!(c.on_pubkey(id));
}

fn fund(c: &mut Contract, id: u64) {
    call(TOKEN, NearToken::from_yoctonear(0), NOW + 2);
    let r = c.ft_on_transfer(
        acc(BUYER),
        U128(CAP),
        json!({"fund_tender": id.to_string()}).to_string(),
    );
    assert!(
        matches!(r, PromiseOrValue::Value(U128(0))),
        "funding refused"
    );
}

fn open(c: &mut Contract) -> u64 {
    let id = create(c);
    set_key(c, id);
    fund(c, id);
    id
}

fn ciphertext(seed: u8) -> String {
    STANDARD.encode(vec![seed; 600])
}

fn bid(c: &mut Contract, id: u64, vendor: &str, seed: u8, ts: u64) -> BidReceipt {
    call(vendor, milli(200), ts);
    c.submit_bid(id, ciphertext(seed), pk("debrief_key"))
}

/// (receiver, yocto) of every plain transfer created by the last call.
fn transfers() -> Vec<(String, u128)> {
    get_created_receipts()
        .into_iter()
        .flat_map(|r| {
            let to = r.receiver_id.to_string();
            r.actions.into_iter().filter_map(move |a| match a {
                MockAction::Transfer { deposit, .. } => Some((to.clone(), deposit.as_yoctonear())),
                _ => None,
            })
        })
        .collect()
}

/// (receiver, method, args, deposit) of every function call created by the last call.
fn function_calls() -> Vec<(String, String, Value, u128)> {
    get_created_receipts()
        .into_iter()
        .flat_map(|r| {
            let to = r.receiver_id.to_string();
            r.actions.into_iter().filter_map(move |a| match a {
                MockAction::FunctionCallWeight {
                    method_name,
                    args,
                    attached_deposit,
                    ..
                } => Some((
                    to.clone(),
                    String::from_utf8(method_name).unwrap(),
                    serde_json::from_slice(&args).unwrap_or(Value::Null),
                    attached_deposit.as_yoctonear(),
                )),
                _ => None,
            })
        })
        .collect()
}

fn events(name: &str) -> Vec<Value> {
    get_logs()
        .into_iter()
        .filter_map(|l| {
            l.strip_prefix("EVENT_JSON:")
                .map(|j| serde_json::from_str::<Value>(j).unwrap())
        })
        .filter(|e| e["event"] == name)
        .collect()
}

/// Runs `f` and asserts it panics with `code` (an `E_*` error).
fn assert_fails(code: &str, f: impl FnOnce()) {
    let err =
        std::panic::catch_unwind(std::panic::AssertUnwindSafe(f)).expect_err("expected a panic");
    let msg = err
        .downcast_ref::<String>()
        .cloned()
        .or_else(|| err.downcast_ref::<&str>().map(|s| s.to_string()))
        .unwrap_or_default();
    assert!(msg.contains(code), "expected {code}, got {msg:?}");
}

// ------------------------------------------------------------ rubric rules ---

#[test]
fn example_rubric_hash_matches_vector() {
    call(BUYER, NearToken::from_yoctonear(0), NOW);
    let parsed = parse_rubric(&rubric_json(), 2).unwrap();
    assert_eq!(
        parsed.hash_hex,
        keys_vector()["rubric_jcs_sha256"].as_str().unwrap()
    );
    assert_eq!(parsed.currency_token, acc(TOKEN));
    assert_eq!(parsed.budget_cap, CAP);
    assert_eq!(parsed.approvals_required, 1);
    assert_eq!(parsed.acceptance_window_ns, 72 * HOUR);
}

fn rubric_error(mutate: impl FnOnce(&mut Value)) -> &'static str {
    call(BUYER, NearToken::from_yoctonear(0), NOW);
    let mut v = rubric_value();
    mutate(&mut v);
    parse_rubric(&canonical(&v), 2).unwrap_err()
}

/// D-028: two models is the demo's rubric shape, so the contract must accept it.
#[test]
fn two_models_are_accepted() {
    call(BUYER, NearToken::from_yoctonear(0), NOW);
    let mut v = rubric_value();
    v["models"] = json!(["Qwen/Qwen3.6-35B-A3B-FP8", "z-ai/glm-5.3-flash"]);
    v["aggregation"]["min_valid_outputs"] = json!(2);
    // `ParsedRubric` keeps only what the contract stores, so the assertion is that it parses at
    // all: before D-028 this exact rubric was refused with E_RUBRIC_MODELS.
    let parsed = parse_rubric(&canonical(&v), 2).expect("two distinct models are valid");
    assert_eq!(parsed.approvals_required, 1);
}

#[test]
fn rubric_rules_each_have_an_error_code() {
    assert_eq!(rubric_error(|v| v["v"] = json!(2)), "E_RUBRIC_VERSION");
    assert_eq!(
        rubric_error(|v| v["criteria"][0]["weight_bp"] = json!(3000)),
        "E_RUBRIC_WEIGHTS"
    );
    assert_eq!(
        rubric_error(|v| v["criteria"] = json!([])),
        "E_RUBRIC_WEIGHTS"
    );
    // D-028: two or three distinct ids. Two is the demo's shape, because only two NEAR AI models
    // sign `provider_tee`; one is too few to aggregate and four is beyond the schema.
    assert_eq!(
        rubric_error(|v| v["models"] = json!(["a"])),
        "E_RUBRIC_MODELS"
    );
    assert_eq!(
        rubric_error(|v| v["models"] = json!(["a", "b", "c", "d"])),
        "E_RUBRIC_MODELS"
    );
    assert_eq!(
        rubric_error(|v| v["models"] = json!(["a", "a", "b"])),
        "E_RUBRIC_MODELS"
    );
    assert_eq!(
        rubric_error(|v| v["models"] = json!(["a", "b", "a"])),
        "E_RUBRIC_MODELS"
    );
    assert_eq!(
        rubric_error(|v| v["models"] = json!(["a", "b", ""])),
        "E_RUBRIC_MODELS"
    );
    assert_eq!(
        rubric_error(|v| v["models"] = json!(["a", "a"])),
        "E_RUBRIC_MODELS"
    );
    assert_eq!(
        rubric_error(|v| v["budget_cap_minor"] = json!("0")),
        "E_RUBRIC_CAP"
    );
    assert_eq!(
        rubric_error(|v| v["budget_cap_minor"] = json!("015000")),
        "E_RUBRIC_CAP"
    );
    assert_eq!(
        rubric_error(|v| v["budget_cap_minor"] = json!("15000.5")),
        "E_RUBRIC_CAP"
    );
    assert_eq!(
        rubric_error(|v| v["budget_cap_minor"] = json!(15000)),
        "E_RUBRIC_FIELDS"
    );
    assert_eq!(
        rubric_error(|v| v["currency"]["asset"] = json!("usdc.fakes.testnet")),
        "E_RUBRIC_TOKEN"
    );
    assert_eq!(
        rubric_error(|v| v["currency"]["asset"] = json!("nep141:Not An Account")),
        "E_RUBRIC_TOKEN"
    );
    assert_eq!(
        rubric_error(|v| v["award_policy"]["approvals_required"] = json!(3)),
        "E_RUBRIC_APPROVALS"
    );
    assert_eq!(
        rubric_error(|v| v["award_policy"]["approvals_required"] = json!(0)),
        "E_RUBRIC_APPROVALS"
    );
    assert_eq!(
        rubric_error(|v| v["award_policy"]["acceptance_window_hours"] = json!(0)),
        "E_RUBRIC_WINDOW"
    );
    assert_eq!(
        rubric_error(|v| v["award_policy"]["acceptance_window_hours"] = json!(721)),
        "E_RUBRIC_WINDOW"
    );
}

#[test]
fn rubric_must_be_canonical_json() {
    call(BUYER, NearToken::from_yoctonear(0), NOW);
    let pretty = serde_json::to_string_pretty(&rubric_value()).unwrap();
    assert_eq!(parse_rubric(&pretty, 2), Err("E_RUBRIC_NOT_CANONICAL"));
    let float = rubric_json().replace("\"max_delivery_days\":30", "\"max_delivery_days\":30.0");
    assert_eq!(parse_rubric(&float, 2), Err("E_RUBRIC_NOT_CANONICAL"));
    assert_eq!(parse_rubric("{not json", 2), Err("E_RUBRIC_JSON"));
    let huge = format!("{{\"pad\":\"{}\"}}", "x".repeat(MAX_RUBRIC_BYTES));
    assert_eq!(parse_rubric(&huge, 2), Err("E_RUBRIC_TOO_LARGE"));
}

#[test]
#[should_panic(expected = "E_RUBRIC_WEIGHTS")]
fn create_tender_rejects_an_invalid_rubric() {
    let mut c = setup();
    let mut v = rubric_value();
    v["criteria"][0]["weight_bp"] = json!(1);
    create_with(&mut c, canonical(&v), committee(), DEADLINE);
}

#[test]
#[should_panic(expected = "E_DEADLINE_TOO_SOON")]
fn deadline_too_soon_is_rejected() {
    let mut c = setup();
    create_with(&mut c, rubric_json(), committee(), NOW + MIN_DELAY - 1);
}

#[test]
fn deadline_at_the_minimum_delay_is_accepted() {
    let mut c = setup();
    assert_eq!(
        create_with(&mut c, rubric_json(), committee(), NOW + MIN_DELAY),
        1
    );
}

#[test]
#[should_panic(expected = "E_BAD_PUBKEY")]
fn committee_pubkey_format_is_checked() {
    let mut c = setup();
    let mut m = committee();
    m[1].report_pubkey = format!("04{}", &m[1].report_pubkey[2..]);
    create_with(&mut c, rubric_json(), m, DEADLINE);
}

#[test]
#[should_panic(expected = "E_BAD_PUBKEY")]
fn committee_pubkey_must_be_lowercase_hex() {
    let mut c = setup();
    let mut m = committee();
    m[0].report_pubkey = m[0].report_pubkey.to_uppercase();
    create_with(&mut c, rubric_json(), m, DEADLINE);
}

#[test]
#[should_panic(expected = "E_COMMITTEE_DUPLICATE")]
fn committee_members_are_unique() {
    let mut c = setup();
    let mut m = committee();
    m[1].account = acc(BUYER);
    create_with(&mut c, rubric_json(), m, DEADLINE);
}

#[test]
#[should_panic(expected = "E_COMMITTEE_SIZE")]
fn committee_cannot_be_empty() {
    let mut c = setup();
    create_with(&mut c, rubric_json(), vec![], DEADLINE);
}

#[test]
#[should_panic(expected = "E_NO_EVALUATOR")]
fn unknown_evaluator_index_is_rejected() {
    let mut c = setup();
    call(BUYER, near(1), NOW);
    c.create_tender(rubric_json(), U64(DEADLINE), milli(100), committee(), 7);
}

#[test]
#[should_panic(expected = "E_INSUFFICIENT_DEPOSIT")]
fn create_tender_must_pay_its_storage() {
    let mut c = setup();
    call(BUYER, NearToken::from_yoctonear(1), NOW);
    c.create_tender(rubric_json(), U64(DEADLINE), milli(100), committee(), 0);
}

// ------------------------------------------------------- create + tender key ---

#[test]
fn create_tender_stores_parsed_rubric_and_requests_the_key() {
    let mut c = setup();
    let id = create(&mut c);
    let t = c.get_tender(id).unwrap();
    assert_eq!(t.status, Status::PendingKey);
    assert_eq!(
        t.rubric_hash,
        keys_vector()["rubric_jcs_sha256"].as_str().unwrap()
    );
    assert_eq!(t.rubric_json, rubric_json());
    assert_eq!(t.currency_token, acc(TOKEN));
    assert_eq!(t.budget_cap, U128(CAP));
    assert_eq!(t.evaluator, evaluator());

    let calls = function_calls();
    let (to, method, args, deposit) = &calls[0];
    assert_eq!(
        (to.as_str(), method.as_str()),
        (OUTLAYER, "request_execution")
    );
    assert_eq!(*deposit, t.exec_deposit.as_yoctonear());
    assert_eq!(args["source"]["WasmUrl"]["hash"], WASM_SHA);
    assert_eq!(args["source"]["WasmUrl"]["build_target"], "wasm32-wasip2");
    assert_eq!(args["response_format"], "Text");
    assert_eq!(args["payer_account_id"], BUYER);
    assert_eq!(
        args["secrets_ref"],
        json!({"profile": "evaluator", "account_id": OWNER})
    );
    assert_eq!(
        args["resource_limits"]["max_execution_seconds"],
        DERIVE_MAX_SECONDS
    );
    let input: Value = serde_json::from_str(args["input_data"].as_str().unwrap()).unwrap();
    assert_eq!(
        input,
        json!({"action": "derive_pubkey", "contract_id": CONTRACT, "tender_id": "1"})
    );
    assert!(
        calls
            .iter()
            .any(|(to, m, a, _)| to == CONTRACT && m == "on_pubkey" && a["tender_id"] == 1)
    );

    // Eval fee = attached − storage, split in 6 equal deposits; one is spent on the key request.
    let fee_total = t.eval_fee_remaining.as_yoctonear() + t.exec_deposit.as_yoctonear();
    assert_eq!(
        t.exec_deposit.as_yoctonear(),
        fee_total / EXECUTIONS_BUDGETED
    );
    assert!(fee_total < near(1).as_yoctonear());
    assert_eq!(events("tender_created").len(), 1);
}

#[test]
fn on_pubkey_success_sets_the_key_once() {
    let mut c = setup();
    let id = create(&mut c);
    set_key(&mut c, id);
    let t = c.get_tender(id).unwrap();
    assert_eq!(t.status, Status::AwaitingFunds);
    assert_eq!(t.tender_pubkey.as_deref(), Some(pk("tender_key").as_str()));
    assert_eq!(events("tender_key_set").len(), 1);

    // A second (late) result is ignored.
    callback(
        NOW + 5,
        PromiseResult::Successful(key_payload("1", &pk("debrief_key"))),
    );
    assert!(!c.on_pubkey(id));
    assert_eq!(
        c.get_tender(id).unwrap().tender_pubkey.as_deref(),
        Some(pk("tender_key").as_str())
    );
}

fn pubkey_failure(result: PromiseResult) -> (bool, Status, Vec<String>) {
    let mut c = setup();
    let id = create(&mut c);
    callback(NOW + 1, result);
    let ok = c.on_pubkey(id);
    (ok, c.get_tender(id).unwrap().status, get_logs())
}

#[test]
fn on_pubkey_failures_leave_the_tender_pending() {
    let cases: Vec<(PromiseResult, &str)> = vec![
        (PromiseResult::Failed, "E_KEY_PROMISE_FAILED"),
        (
            PromiseResult::Successful(b"null".to_vec()),
            "E_KEY_RUN_FAILED",
        ),
        (
            PromiseResult::Successful(key_payload("2", &pk("tender_key"))),
            "E_KEY_RESULT_TID",
        ),
        (
            PromiseResult::Successful(key_payload("1", &pk("tender_key").to_uppercase())),
            "E_BAD_PUBKEY",
        ),
        (
            PromiseResult::Successful(key_payload("1", "04abcd")),
            "E_BAD_PUBKEY",
        ),
        (
            PromiseResult::Successful(
                serde_json::to_vec(
                    &json!({"v": 2, "tid": "1", "pk": pk("tender_key")}).to_string(),
                )
                .unwrap(),
            ),
            "E_KEY_RESULT_VERSION",
        ),
        (
            PromiseResult::Successful(
                serde_json::to_vec(
                    &json!({"v": 1, "tid": "1", "pk": pk("tender_key"), "sk": "x"}).to_string(),
                )
                .unwrap(),
            ),
            "E_KEY_RESULT_FORMAT",
        ),
        // Json response format (an object, not a string) is not what we asked for.
        (
            PromiseResult::Successful(
                json!({"v": 1, "tid": "1", "pk": pk("tender_key")})
                    .to_string()
                    .into_bytes(),
            ),
            "E_KEY_RESULT_FORMAT",
        ),
        (
            PromiseResult::Successful(vec![b'"'; MAX_CALLBACK_BYTES + 1]),
            "E_KEY_PROMISE_FAILED",
        ),
    ];
    for (result, code) in cases {
        let (ok, status, logs) = pubkey_failure(result);
        assert!(!ok, "{code}");
        assert_eq!(status, Status::PendingKey, "{code}");
        assert!(logs.iter().any(|l| l == code), "{code} not in {logs:?}");
    }
}

#[test]
fn on_pubkey_after_cancel_is_ignored() {
    let mut c = setup();
    let id = create(&mut c);
    call(BUYER, NearToken::from_yoctonear(0), NOW + 1);
    c.cancel_tender(id, "changed plans".into());
    callback(
        NOW + 2,
        PromiseResult::Successful(key_payload("1", &pk("tender_key"))),
    );
    assert!(!c.on_pubkey(id));
    let t = c.get_tender(id).unwrap();
    assert_eq!(t.status, Status::Cancelled);
    assert_eq!(t.tender_pubkey, None);
}

#[test]
fn retry_pubkey_keeps_the_evaluation_budget() {
    let mut c = setup();
    let id = create(&mut c);
    for _ in 0..2 {
        call(BUYER, NearToken::from_yoctonear(0), NOW + 1);
        c.retry_pubkey(id);
        assert_eq!(function_calls()[0].1, "request_execution");
    }
    let t = c.get_tender(id).unwrap();
    assert!(t.eval_fee_remaining >= t.exec_deposit.saturating_mul(u128::from(MAX_ATTEMPTS)));
    call(BUYER, NearToken::from_yoctonear(0), NOW + 1);
    // A third retry would eat into the evaluation budget.
    assert_fails("E_EVAL_FEE_LOW", || c.retry_pubkey(id));
}

#[test]
#[should_panic(expected = "E_NOT_BUYER")]
fn only_the_buyer_retries_the_key() {
    let mut c = setup();
    let id = create(&mut c);
    call(VENDORS[0], NearToken::from_yoctonear(0), NOW + 1);
    c.retry_pubkey(id);
}

// ------------------------------------------------------------ escrow (I11) ---

fn try_fund(c: &mut Contract, id: u64, token: &str, sender: &str, amount: u128, ts: u64) -> U128 {
    call(token, NearToken::from_yoctonear(0), ts);
    match c.ft_on_transfer(
        acc(sender),
        U128(amount),
        json!({"fund_tender": id.to_string()}).to_string(),
    ) {
        PromiseOrValue::Value(v) => v,
        PromiseOrValue::Promise(_) => panic!("unexpected promise"),
    }
}

#[test]
fn i11_escrow_only_from_buyer_in_rubric_token_for_exact_cap() {
    let mut c = setup();
    let id = create(&mut c);
    // Before the key: refused.
    assert_eq!(try_fund(&mut c, id, TOKEN, BUYER, CAP, NOW + 1), U128(CAP));
    set_key(&mut c, id);
    // Wrong token, wrong sender, wrong amount (both ways): every token comes back.
    assert_eq!(
        try_fund(&mut c, id, "other-token.testnet", BUYER, CAP, NOW + 2),
        U128(CAP)
    );
    assert_eq!(
        try_fund(&mut c, id, TOKEN, VENDORS[0], CAP, NOW + 2),
        U128(CAP)
    );
    assert_eq!(
        try_fund(&mut c, id, TOKEN, BUYER, CAP - 1, NOW + 2),
        U128(CAP - 1)
    );
    assert_eq!(
        try_fund(&mut c, id, TOKEN, BUYER, CAP + 1, NOW + 2),
        U128(CAP + 1)
    );
    assert_eq!(c.get_tender(id).unwrap().escrowed, U128(0));
    assert_eq!(c.get_tender(id).unwrap().status, Status::AwaitingFunds);
    // Exact: accepted once; a second transfer is refused.
    assert_eq!(try_fund(&mut c, id, TOKEN, BUYER, CAP, NOW + 3), U128(0));
    assert_eq!(c.get_tender(id).unwrap().escrowed, U128(CAP));
    assert_eq!(c.get_tender(id).unwrap().status, Status::Open);
    assert_eq!(try_fund(&mut c, id, TOKEN, BUYER, CAP, NOW + 4), U128(CAP));
    assert_eq!(c.get_tender(id).unwrap().escrowed, U128(CAP));
}

#[test]
fn ft_on_transfer_refunds_bad_messages_and_late_funding() {
    let mut c = setup();
    let id = create(&mut c);
    set_key(&mut c, id);
    call(TOKEN, NearToken::from_yoctonear(0), NOW + 2);
    for msg in [
        "",
        "{}",
        "{\"fund_tender\":\"x\"}",
        "{\"fund_tender\":\"99\"}",
        "{\"fund_tender\":\"1\",\"x\":1}",
    ] {
        assert!(
            matches!(
                c.ft_on_transfer(acc(BUYER), U128(CAP), msg.into()),
                PromiseOrValue::Value(U128(CAP))
            ),
            "{msg}"
        );
    }
    assert_eq!(try_fund(&mut c, id, TOKEN, BUYER, CAP, DEADLINE), U128(CAP));
    assert_eq!(c.get_tender(id).unwrap().status, Status::AwaitingFunds);
}

// ------------------------------------------------------------------- bids ---

#[test]
fn submit_bid_stores_ciphertext_and_returns_receipt() {
    let mut c = setup();
    let id = open(&mut c);
    let r = bid(&mut c, id, VENDORS[0], 1, NOW + 10);
    let raw = vec![1u8; 600];
    assert_eq!(r.slot, 0);
    assert_eq!(r.ciphertext_sha256, rubric::hex(&env::sha256(&raw)));
    assert_eq!(r.submitted_at_ns, U64(NOW + 10));
    assert_eq!(c.get_bid_ciphertext(id, 0), Some(STANDARD.encode(&raw)));
    let views = c.get_bids(id);
    assert_eq!(views.len(), 1);
    assert_eq!(views[0].bidder, acc(VENDORS[0]));
    assert_eq!(views[0].bond, milli(100));
    assert!(c.is_ciphertext_used(id, r.ciphertext_sha256));
    assert_eq!(c.get_tender(id).unwrap().active_slots, vec![0]);
    // Attached 0.2 NEAR, bond 0.1 NEAR + storage: the change comes back.
    let change: u128 = transfers()
        .iter()
        .filter(|(to, _)| to == VENDORS[0])
        .map(|(_, y)| y)
        .sum();
    assert!(change > 0 && change < milli(100).as_yoctonear());
    assert_eq!(
        events("bid_submitted")[0]["data"][0]["submitted_at_ns"],
        json!((NOW + 10).to_string())
    );
}

#[test]
fn i2_no_bid_at_or_after_the_deadline() {
    let mut c = setup();
    let id = open(&mut c);
    bid(&mut c, id, VENDORS[0], 1, DEADLINE - 1);
    for ts in [DEADLINE, DEADLINE + 1] {
        assert_fails("E_DEADLINE_PASSED", || {
            bid(&mut c, id, VENDORS[1], 2, ts);
        });
    }
    assert_eq!(c.get_bids(id).len(), 1);
}

#[test]
#[should_panic(expected = "E_DEADLINE_PASSED")]
fn i2_bid_exactly_at_deadline_panics_with_code() {
    let mut c = setup();
    let id = open(&mut c);
    bid(&mut c, id, VENDORS[0], 1, DEADLINE);
}

#[test]
#[should_panic(expected = "E_NOT_OPEN")]
fn bids_need_a_funded_tender() {
    let mut c = setup();
    let id = create(&mut c);
    set_key(&mut c, id);
    bid(&mut c, id, VENDORS[0], 1, NOW + 10);
}

#[test]
#[should_panic(expected = "E_CIPHERTEXT_TOO_LARGE")]
fn bid_too_large_is_rejected() {
    let mut c = setup();
    let id = open(&mut c);
    call(VENDORS[0], milli(200), NOW + 10);
    c.submit_bid(
        id,
        STANDARD.encode(vec![7u8; MAX_CIPHERTEXT_BYTES + 1]),
        pk("debrief_key"),
    );
}

#[test]
fn bid_of_exactly_the_max_size_is_accepted() {
    let mut c = setup();
    let id = open(&mut c);
    call(VENDORS[0], milli(200), NOW + 10);
    c.submit_bid(
        id,
        STANDARD.encode(vec![7u8; MAX_CIPHERTEXT_BYTES]),
        pk("debrief_key"),
    );
}

#[test]
#[should_panic(expected = "E_BAD_CIPHERTEXT")]
fn bid_must_be_base64() {
    let mut c = setup();
    let id = open(&mut c);
    call(VENDORS[0], milli(200), NOW + 10);
    c.submit_bid(id, "not base64!".into(), pk("debrief_key"));
}

#[test]
#[should_panic(expected = "E_BAD_PUBKEY")]
fn debrief_pubkey_format_is_checked() {
    let mut c = setup();
    let id = open(&mut c);
    call(VENDORS[0], milli(200), NOW + 10);
    c.submit_bid(id, ciphertext(1), "02xyz".into());
}

#[test]
fn max_bids_is_enforced_and_a_withdrawal_frees_a_slot() {
    let mut c = setup();
    let id = open(&mut c);
    for (i, v) in VENDORS.iter().take(MAX_BIDS).enumerate() {
        bid(&mut c, id, v, i as u8 + 1, NOW + 10 + i as u64);
    }
    assert_fails("E_MAX_BIDS", || {
        bid(&mut c, id, VENDORS[5], 50, NOW + 20);
    });
    call(VENDORS[0], NearToken::from_yoctonear(0), NOW + 21);
    c.withdraw_bid(id);
    bid(&mut c, id, VENDORS[5], 51, NOW + 22);
    assert_eq!(c.get_tender(id).unwrap().active_slots, vec![1, 2, 3, 4, 5]);
}

#[test]
#[should_panic(expected = "E_MAX_BIDS")]
fn sixth_active_bid_panics_with_code() {
    let mut c = setup();
    let id = open(&mut c);
    for (i, v) in VENDORS.iter().take(MAX_BIDS + 1).enumerate() {
        bid(&mut c, id, v, i as u8 + 1, NOW + 10 + i as u64);
    }
}

#[test]
#[should_panic(expected = "E_ALREADY_BID")]
fn one_active_bid_per_account() {
    let mut c = setup();
    let id = open(&mut c);
    bid(&mut c, id, VENDORS[0], 1, NOW + 10);
    bid(&mut c, id, VENDORS[0], 2, NOW + 11);
}

#[test]
#[should_panic(expected = "E_DUPLICATE_CIPHERTEXT")]
fn i13_duplicate_ciphertext_is_rejected() {
    let mut c = setup();
    let id = open(&mut c);
    bid(&mut c, id, VENDORS[0], 1, NOW + 10);
    bid(&mut c, id, VENDORS[1], 1, NOW + 11); // copies vendor A's ciphertext
}

#[test]
#[should_panic(expected = "E_DUPLICATE_CIPHERTEXT")]
fn i13_withdrawn_ciphertext_cannot_be_resubmitted() {
    let mut c = setup();
    let id = open(&mut c);
    bid(&mut c, id, VENDORS[0], 1, NOW + 10);
    call(VENDORS[0], NearToken::from_yoctonear(0), NOW + 11);
    c.withdraw_bid(id);
    bid(&mut c, id, VENDORS[1], 1, NOW + 12);
}

#[test]
fn deposit_then_bid_from_balance_then_withdraw_the_rest() {
    let mut c = setup();
    let id = open(&mut c);
    call(VENDORS[0], milli(500), NOW + 5);
    let credited = c.deposit(id);
    assert!(
        credited < milli(500) && credited > milli(490),
        "storage of the entry is paid from the deposit"
    );
    assert_eq!(c.get_balance(id, acc(VENDORS[0])), credited);

    // Function-call key: no deposit attached.
    call(VENDORS[0], NearToken::from_yoctonear(0), NOW + 6);
    c.submit_bid(id, ciphertext(9), pk("debrief_key"));
    assert!(transfers().is_empty());
    let left = c.get_balance(id, acc(VENDORS[0]));
    assert!(left < credited.saturating_sub(milli(100)));

    call(VENDORS[0], NearToken::from_yoctonear(0), NOW + 7);
    assert_eq!(c.withdraw_balance(id), left);
    assert_eq!(
        transfers(),
        vec![(VENDORS[0].to_string(), left.as_yoctonear())]
    );
    assert_eq!(
        c.get_balance(id, acc(VENDORS[0])),
        NearToken::from_yoctonear(0)
    );
}

#[test]
#[should_panic(expected = "E_INSUFFICIENT_DEPOSIT")]
fn bid_without_deposit_or_balance_is_rejected() {
    let mut c = setup();
    let id = open(&mut c);
    call(VENDORS[0], NearToken::from_yoctonear(0), NOW + 6);
    c.submit_bid(id, ciphertext(9), pk("debrief_key"));
}

// -------------------------------------------------------------- bonds (I10) ---

#[test]
fn i10_withdraw_refunds_the_bond_exactly_once() {
    let mut c = setup();
    let id = open(&mut c);
    bid(&mut c, id, VENDORS[0], 1, NOW + 10);
    call(VENDORS[0], NearToken::from_yoctonear(0), NOW + 11);
    c.withdraw_bid(id);
    assert_eq!(
        transfers(),
        vec![(VENDORS[0].to_string(), milli(100).as_yoctonear())]
    );
    let views = c.get_bids(id);
    assert!(views[0].withdrawn && views[0].bond_settled);
    assert!(c.get_tender(id).unwrap().active_slots.is_empty());

    call(VENDORS[0], NearToken::from_yoctonear(0), NOW + 12);
    assert_fails("E_NO_ACTIVE_BID", || c.withdraw_bid(id));
    // Cancel later refunds no bond for the withdrawn bid.
    call(BUYER, NearToken::from_yoctonear(0), NOW + 13);
    c.cancel_tender(id, "no".into());
    assert!(transfers().iter().all(|(to, _)| to != VENDORS[0]));
}

#[test]
#[should_panic(expected = "E_DEADLINE_PASSED")]
fn withdraw_after_deadline_is_rejected() {
    let mut c = setup();
    let id = open(&mut c);
    bid(&mut c, id, VENDORS[0], 1, NOW + 10);
    call(VENDORS[0], NearToken::from_yoctonear(0), DEADLINE);
    c.withdraw_bid(id);
}

// ------------------------------------------------------------------ cancel ---

#[test]
fn cancel_refunds_everything_once() {
    let mut c = setup();
    let id = open(&mut c);
    bid(&mut c, id, VENDORS[0], 1, NOW + 10);
    bid(&mut c, id, VENDORS[1], 2, NOW + 11);
    let fee = c.get_tender(id).unwrap().eval_fee_remaining;

    call(BUYER, NearToken::from_yoctonear(0), NOW + 20);
    c.cancel_tender(id, "budget withdrawn".into());
    let mut got = transfers();
    got.sort();
    let mut want = vec![
        (BUYER.to_string(), fee.as_yoctonear()),
        (VENDORS[0].to_string(), milli(100).as_yoctonear()),
        (VENDORS[1].to_string(), milli(100).as_yoctonear()),
    ];
    want.sort();
    assert_eq!(got, want);
    let ft: Vec<_> = function_calls()
        .into_iter()
        .filter(|(_, m, _, _)| m == "ft_transfer")
        .collect();
    assert_eq!(ft.len(), 1);
    assert_eq!(ft[0].0, TOKEN);
    assert_eq!(ft[0].2["receiver_id"], BUYER);
    assert_eq!(ft[0].2["amount"], CAP.to_string());
    assert_eq!(ft[0].3, 1);

    let t = c.get_tender(id).unwrap();
    assert_eq!(t.status, Status::Cancelled);
    assert_eq!(t.escrowed, U128(0));
    assert!(t.eval_fee_remaining.is_zero());
    assert!(c.get_bids(id).iter().all(|b| b.bond_settled));

    call(BUYER, NearToken::from_yoctonear(0), NOW + 21);
    assert_fails("E_BAD_STATUS", || c.cancel_tender(id, "again".into()));
}

#[test]
fn failed_escrow_refund_is_booked_back_and_can_be_retried() {
    let mut c = setup();
    let id = open(&mut c);
    call(BUYER, NearToken::from_yoctonear(0), NOW + 20);
    c.cancel_tender(id, "x".into());
    callback(NOW + 21, PromiseResult::Failed);
    assert!(!c.on_escrow_refund(id, U128(CAP)));
    assert_eq!(c.get_tender(id).unwrap().escrowed, U128(CAP));

    call(VENDORS[3], NearToken::from_yoctonear(0), NOW + 22);
    c.retry_escrow_refund(id);
    assert_eq!(c.get_tender(id).unwrap().escrowed, U128(0));
    assert_eq!(
        function_calls()
            .iter()
            .filter(|(_, m, _, _)| m == "ft_transfer")
            .count(),
        1
    );
    callback(NOW + 23, PromiseResult::Successful(vec![]));
    assert!(c.on_escrow_refund(id, U128(CAP)));
    assert_eq!(c.get_tender(id).unwrap().escrowed, U128(0));
}

#[test]
#[should_panic(expected = "E_NOT_BUYER")]
fn only_the_buyer_cancels() {
    let mut c = setup();
    let id = open(&mut c);
    call(VENDORS[0], NearToken::from_yoctonear(0), NOW + 20);
    c.cancel_tender(id, "x".into());
}

#[test]
#[should_panic(expected = "E_DEADLINE_PASSED")]
fn no_cancel_at_or_after_the_deadline() {
    let mut c = setup();
    let id = open(&mut c);
    call(BUYER, NearToken::from_yoctonear(0), DEADLINE);
    c.cancel_tender(id, "x".into());
}

// ------------------------------------------------------------------ admin ---

#[test]
#[should_panic(expected = "E_NOT_OWNER")]
fn only_the_owner_adds_evaluators() {
    let mut c = setup();
    call(BUYER, NearToken::from_yoctonear(0), NOW);
    c.add_evaluator(evaluator());
}

#[test]
#[should_panic(expected = "E_BAD_EVALUATOR")]
fn evaluator_hash_must_be_sha256_hex() {
    let mut c = setup();
    call(OWNER, NearToken::from_yoctonear(0), NOW);
    c.add_evaluator(EvaluatorRef {
        wasm_sha256: "abc".into(),
        ..evaluator()
    });
}

// ----------------------------------------------------------- immutability ---

/// The full public method list. A new method must be added here and to README.md, and must
/// not change rubric_json, rubric_hash, evaluator, committee, deadline_ns or bond (I1).
const METHODS: [&str; 36] = [
    "new",
    "add_evaluator",
    "create_tender",
    "retry_pubkey",
    "on_pubkey",
    "ft_on_transfer",
    "cancel_tender",
    "retry_escrow_refund",
    "on_escrow_refund",
    "deposit",
    "withdraw_balance",
    "submit_bid",
    "withdraw_bid",
    "close_and_evaluate",
    "retry_evaluate",
    "on_evaluate",
    // award.rs (T08)
    "propose_award",
    "approve_award",
    "close_without_award",
    "accept_award",
    "lapse_award",
    "retry_payout",
    "on_payout",
    "version",
    "get_config",
    "get_evaluators",
    "get_tender",
    "list_tenders",
    "get_bids",
    "get_bid_ciphertext",
    "get_frozen",
    "get_attempts",
    "get_result",
    "get_award",
    "get_balance",
    "is_ciphertext_used",
];

/// Files holding `#[near] impl` blocks, in the order METHODS lists their methods.
const CONTRACT_FILES: [&str; 6] = [
    "lib.rs",
    "tender.rs",
    "bids.rs",
    "evaluate.rs",
    "award.rs",
    "views.rs",
];

fn public_methods() -> Vec<String> {
    let src = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
    // Every source file with a #[near] impl must be scanned: a new one fails here.
    let mut with_impl: Vec<String> = std::fs::read_dir(&src)
        .unwrap()
        .map(|e| e.unwrap().file_name().into_string().unwrap())
        .filter(|f| f.ends_with(".rs") && !f.starts_with("tests"))
        .filter(|f| {
            std::fs::read_to_string(src.join(f))
                .unwrap()
                .contains("#[near]\nimpl")
        })
        .collect();
    with_impl.sort();
    let mut known: Vec<String> = CONTRACT_FILES.iter().map(|f| f.to_string()).collect();
    known.sort();
    assert_eq!(
        with_impl, known,
        "a #[near] impl block lives in a file the I1 scan does not read"
    );
    CONTRACT_FILES
        .iter()
        .flat_map(|f| {
            std::fs::read_to_string(src.join(f))
                .unwrap()
                .lines()
                .filter_map(|l| l.strip_prefix("    pub fn "))
                .filter_map(|rest| rest.split('(').next())
                .map(str::to_string)
                .collect::<Vec<_>>()
        })
        .collect()
}

#[test]
fn i1_method_list_has_no_setter_for_immutable_fields() {
    assert_eq!(public_methods(), METHODS);
    let readme = include_str!("../README.md");
    for m in METHODS {
        assert!(
            readme.contains(&format!("`{m}`")),
            "{m} missing from README.md"
        );
        for bad in ["set_", "update_", "edit_", "change_", "modify_", "replace_"] {
            assert!(!m.starts_with(bad), "{m} looks like a setter");
        }
    }
}

type Immutable = (
    String,
    String,
    EvaluatorRef,
    Vec<CommitteeMember>,
    U64,
    NearToken,
);

fn immutable(c: &Contract, id: u64) -> Immutable {
    let t = c.get_tender(id).unwrap();
    (
        t.rubric_json,
        t.rubric_hash,
        t.evaluator,
        t.committee,
        t.deadline_ns,
        t.bond,
    )
}

#[test]
fn i1_no_method_changes_the_fixed_fields() {
    let mut c = setup();
    let id = create(&mut c);
    let before = immutable(&c, id);
    let check = |c: &Contract| assert_eq!(immutable(c, id), before);

    set_key(&mut c, id);
    check(&c);
    call(OWNER, NearToken::from_yoctonear(0), NOW + 2);
    c.add_evaluator(EvaluatorRef {
        wasm_sha256: "ab".repeat(32),
        source_tag: "evaluator-v2".into(),
        ..evaluator()
    });
    check(&c);
    fund(&mut c, id);
    check(&c);
    call(VENDORS[0], milli(500), NOW + 3);
    c.deposit(id);
    check(&c);
    bid(&mut c, id, VENDORS[1], 1, NOW + 4);
    check(&c);
    call(VENDORS[0], NearToken::from_yoctonear(0), NOW + 5);
    c.submit_bid(id, ciphertext(2), pk("debrief_key"));
    check(&c);
    call(VENDORS[1], NearToken::from_yoctonear(0), NOW + 6);
    c.withdraw_bid(id);
    check(&c);
    call(VENDORS[0], NearToken::from_yoctonear(0), NOW + 7);
    c.withdraw_balance(id);
    check(&c);
    call(BUYER, NearToken::from_yoctonear(0), NOW + 8);
    c.cancel_tender(id, "done".into());
    check(&c);
    assert_eq!(
        c.get_tender(id).unwrap().evaluator.source_tag,
        "evaluator-v1.0.0"
    );
}

#[test]
fn i1_fixed_fields_survive_key_retry_refused_funding_and_escrow_refund_retry() {
    let mut c = setup();
    let id = create(&mut c);
    let before = immutable(&c, id);
    call(BUYER, NearToken::from_yoctonear(0), NOW + 1);
    c.retry_pubkey(id);
    assert_eq!(immutable(&c, id), before);
    set_key(&mut c, id);
    assert_eq!(
        try_fund(&mut c, id, TOKEN, VENDORS[0], CAP, NOW + 2),
        U128(CAP)
    );
    assert_eq!(immutable(&c, id), before);
    fund(&mut c, id);
    call(BUYER, NearToken::from_yoctonear(0), NOW + 3);
    c.cancel_tender(id, "x".into());
    callback(NOW + 4, PromiseResult::Failed);
    c.on_escrow_refund(id, U128(CAP));
    assert_eq!(immutable(&c, id), before);
    call(VENDORS[1], NearToken::from_yoctonear(0), NOW + 5);
    c.retry_escrow_refund(id);
    assert_eq!(immutable(&c, id), before);
}

// ------------------------------------------- bonds: the settle guard itself ---

#[test]
fn i10_settle_bond_settles_a_slot_once() {
    let mut c = setup();
    let id = open(&mut c);
    bid(&mut c, id, VENDORS[0], 1, NOW + 10);
    call(VENDORS[0], NearToken::from_yoctonear(0), NOW + 11);
    assert_eq!(c.settle_bond(id, 0), Some((acc(VENDORS[0]), milli(100))));
    assert_eq!(c.settle_bond(id, 0), None);
    assert_eq!(c.settle_bond(id, 7), None);
}

// ----------------------------------------------- cancel after the deadline ---

#[test]
fn late_cancel_frees_the_fee_of_a_tender_that_never_opened() {
    for funded_key in [false, true] {
        let mut c = setup();
        let id = create(&mut c);
        if funded_key {
            set_key(&mut c, id);
        }
        let fee = c.get_tender(id).unwrap().eval_fee_remaining;
        call(BUYER, NearToken::from_yoctonear(0), DEADLINE + HOUR);
        c.cancel_tender(id, "never opened".into());
        assert_eq!(c.get_tender(id).unwrap().status, Status::Cancelled);
        assert_eq!(transfers(), vec![(BUYER.to_string(), fee.as_yoctonear())]);
    }
}

#[test]
#[should_panic(expected = "E_DEADLINE_PASSED")]
fn open_tender_cannot_be_cancelled_after_the_deadline() {
    let mut c = setup();
    let id = open(&mut c);
    call(BUYER, NearToken::from_yoctonear(0), DEADLINE);
    c.cancel_tender(id, "x".into());
}

#[test]
#[should_panic(expected = "E_DEADLINE_PASSED")]
fn no_key_retry_after_the_deadline() {
    let mut c = setup();
    let id = create(&mut c);
    call(BUYER, NearToken::from_yoctonear(0), DEADLINE);
    c.retry_pubkey(id);
}

// ------------------------------------------------------------------- views ---

#[test]
fn views_page_tenders_and_carry_ns_as_strings() {
    let mut c = setup();
    let a = create(&mut c);
    let b = create(&mut c);
    assert_eq!((a, b), (1, 2));
    assert_eq!(c.list_tenders(None, None).len(), 2);
    assert_eq!(
        c.list_tenders(Some(2), Some(10))
            .iter()
            .map(|t| t.id)
            .collect::<Vec<_>>(),
        vec![2]
    );
    let json = serde_json::to_value(c.get_tender(a).unwrap()).unwrap();
    assert_eq!(json["deadline_ns"], json!(DEADLINE.to_string()));
    assert_eq!(json["status"], "PendingKey");
    assert_eq!(c.get_config().next_tender_id, 3);
    assert_eq!(c.get_evaluators(), vec![evaluator()]);
    assert!(c.get_tender(99).is_none());
}

#[path = "tests_evaluate.rs"]
mod evaluate_tests;

#[path = "tests_rubric.rs"]
mod rubric_tests;

#[path = "tests_award.rs"]
mod award_tests;
