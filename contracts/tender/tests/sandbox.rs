//! Sandbox integration tests (near-workspaces) for T04: the tender contract against the mock
//! OutLayer (yield/resume like the real one) and a test NEP-141 token. Each test runs its own
//! sandbox. The three wasms are built once with `cargo near build` (cargo-near 0.22 must be
//! installed) into target/sandbox-wasm, a separate target dir so the nested build does not wait
//! on the lock held by `cargo test`.
//!
//! Two sandbox rules shape these tests (measured on CI and locally, PROGRESS.md T04):
//! - A call that makes an OutLayer request (`create_tender`, `close_and_evaluate`,
//!   `retry_evaluate`) yields until the mock is resolved. `.transact()` waits for every receipt
//!   of the transaction, so it would block until the yield times out; neard's RPC gives up after
//!   10 s and near-workspaces re-sends the call with a new nonce. Such calls go out with
//!   `transact_async` (`start`); the test resolves the request, then awaits the transaction.
//! - Deadlines sit `DEADLINE_MARGIN_S` after the chain clock (the clock the contract reads) and are
//!   crossed with `fast_forward` (about 0.3 s of chain time per block), not by waiting.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use near_sdk::base64::Engine;
use near_sdk::base64::engine::general_purpose::STANDARD;
use near_sdk::serde_json::{self, Value, json};
use near_workspaces::network::Sandbox;
use near_workspaces::operations::{CallTransaction, TransactionStatus};
use near_workspaces::result::ExecutionFinalResult;
use near_workspaces::types::{Gas, NearToken};
use near_workspaces::{Account, Contract, Worker};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::task::Poll;
use tender_contract::constants::RETRY_MIN_GAP_NS;
use tender_contract::rubric::jcs;

type R<T = ()> = Result<T, Box<dyn std::error::Error>>;

const CAP: u128 = 15_000_000_000;
const BOND: NearToken = NearToken::from_millinear(100);
/// Deadline distance from the chain clock: far above the few seconds of transactions every test
/// sends before it (CI took ~41 s for one call only because of the blocking described above).
const DEADLINE_MARGIN_S: u64 = 300;

// ------------------------------------------------------------------ wasm ---

fn workspace() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

fn specs(rel: &str) -> String {
    std::fs::read_to_string(workspace().join("specs").join(rel)).unwrap()
}

/// `cargo near build` for one crate, once per test process.
fn wasm(dir: &str, name: &str) -> Vec<u8> {
    type Built = Mutex<Vec<(String, Vec<u8>)>>;
    static BUILT: OnceLock<Built> = OnceLock::new();
    let built = BUILT.get_or_init(|| Mutex::new(Vec::new()));
    let mut built = built.lock().unwrap_or_else(|e| e.into_inner());
    if let Some((_, w)) = built.iter().find(|(n, _)| n == name) {
        return w.clone();
    }
    let target = workspace().join("target/sandbox-wasm");
    let status = std::process::Command::new("cargo")
        .args(["near", "build", "non-reproducible-wasm"])
        .current_dir(workspace().join("contracts").join(dir))
        .env("CARGO_TARGET_DIR", &target)
        .status()
        .expect("run `cargo near` (install cargo-near 0.22.0)");
    assert!(
        status.success(),
        "cargo near build failed in contracts/{dir}"
    );
    let w = std::fs::read(target.join("near").join(name).join(format!("{name}.wasm"))).unwrap();
    built.push((name.to_string(), w.clone()));
    w
}

// ----------------------------------------------------------------- setup ---

struct Env {
    worker: Worker<Sandbox>,
    root: Account,
    tender: Contract,
    outlayer: Contract,
    token: Contract,
    buyer: Account,
    reviewer: Account,
    vendors: Vec<Account>,
}

fn keys() -> Value {
    serde_json::from_str(&specs("test-vectors/hashes-and-keys.json")).unwrap()
}

fn pk(name: &str) -> String {
    keys()[name]["pk_compressed_hex"]
        .as_str()
        .unwrap()
        .to_string()
}

async fn account(root: &Account, name: &str, near: u128) -> R<Account> {
    Ok(root
        .create_subaccount(name)
        .initial_balance(NearToken::from_near(near))
        .transact()
        .await?
        .into_result()?)
}

async fn deploy(root: &Account, name: &str, code: &[u8]) -> R<Contract> {
    let acc = account(root, name, 30).await?;
    Ok(acc.deploy(code).await?.into_result()?)
}

fn ok(r: ExecutionFinalResult, what: &str) -> ExecutionFinalResult {
    assert!(r.is_success(), "{what} failed: {:?}", r.failures());
    r
}

fn check(r: ExecutionFinalResult, what: &str) {
    let _ = ok(r, what);
}

fn failure_text(r: &ExecutionFinalResult) -> String {
    format!("{:?}", r.failures())
}

async fn setup(vendor_names: &[&str]) -> R<Env> {
    let (tender_wasm, outlayer_wasm, token_wasm) = (
        wasm("tender", "tender_contract"),
        wasm("mock-outlayer", "mock_outlayer"),
        wasm("mock-ft", "mock_ft"),
    );
    let worker = near_workspaces::sandbox().await?;
    let root = worker.root_account()?;
    let outlayer = deploy(&root, "outlayer", &outlayer_wasm).await?;
    let token = deploy(&root, "token", &token_wasm).await?;
    let tender = deploy(&root, "tenders", &tender_wasm).await?;
    let buyer = account(&root, "buyer", 50).await?;
    let reviewer = account(&root, "reviewer", 5).await?;
    let mut vendors = Vec::new();
    for n in vendor_names {
        vendors.push(account(&root, n, 10).await?);
    }

    check(outlayer.call("new").transact().await?, "outlayer new");
    check(
        token
            .call("new")
            .args_json(json!({"owner_id": buyer.id(), "total_supply": (10 * CAP).to_string()}))
            .transact()
            .await?,
        "token new",
    );
    // `new` is #[private]: the contract account initializes itself.
    check(
        tender
            .call("new")
            .args_json(json!({
                "owner": root.id(),
                "outlayer": outlayer.id(),
                "secrets_ref": {"profile": "evaluator", "account_id": root.id()},
                "min_deadline_delay_ns": 0,
            }))
            .transact()
            .await?,
        "tender new",
    );
    check(
        root.call(tender.id(), "add_evaluator")
            .args_json(json!({"evaluator": {
                "wasm_url": "https://example.org/evaluator.wasm",
                "wasm_sha256": "ab".repeat(32),
                "build_target": "wasm32-wasip2",
                "source_tag": "evaluator-v1.0.0",
            }}))
            .transact()
            .await?,
        "add_evaluator",
    );
    for who in [tender.as_account(), &buyer] {
        check(
            who.call(token.id(), "storage_deposit")
                .args_json(json!({"account_id": who.id()}))
                .deposit(NearToken::from_millinear(10))
                .transact()
                .await?,
            "storage_deposit",
        );
    }
    Ok(Env {
        worker,
        root,
        tender,
        outlayer,
        token,
        buyer,
        reviewer,
        vendors,
    })
}

/// The chain clock the contract reads (`env::block_timestamp`): the latest block's timestamp.
async fn chain_now(env: &Env) -> R<u64> {
    Ok(env.worker.view_block().await?.timestamp())
}

/// Moves the chain clock past `deadline` with `fast_forward`, so the next block is after it.
/// Advances the chain clock past `target_ns`. Used for the deadline and for the gap the contract
/// requires between retries (`RETRY_MIN_GAP_NS`).
async fn advance_past(env: &Env, target_ns: u64) -> R {
    for _ in 0..40 {
        let now = chain_now(env).await?;
        if now > target_ns {
            return Ok(());
        }
        // ~0.3 s of chain time per fast-forwarded block; aim a little past the target.
        let blocks = ((target_ns - now) / 300_000_000 + 20).min(2_000);
        env.worker.fast_forward(blocks).await?;
    }
    Err("the chain clock did not reach the target".into())
}

async fn cross_deadline(env: &Env, deadline: u64) -> R {
    advance_past(env, deadline).await
}

/// Waits out `RETRY_MIN_GAP_NS` from the last attempt's start, so `retry_evaluate` is allowed.
async fn wait_for_retry(env: &Env, tender_id: u64) -> R {
    let t = tender_view(env, tender_id).await?;
    let attempts = t["attempts"].as_array().ok_or("no attempts")?;
    let last = attempts.last().ok_or("no attempt to wait on")?;
    let started: u64 = last["started_at_ns"]
        .as_str()
        .ok_or("started_at_ns is not a string")?
        .parse()?;
    advance_past(env, started + RETRY_MIN_GAP_NS).await
}

/// Sends a call that makes an OutLayer request without waiting for its yielded callback.
async fn start(tx: CallTransaction) -> R<TransactionStatus> {
    Ok(tx.transact_async().await?)
}

/// Waits for request number `known` in the mock. If the call failed, returns its failures as the
/// error. A successful call's own outcome can be final a block before the request it sent is
/// visible (`request_execution` runs in the next block), so success alone keeps the wait going.
async fn new_request(env: &Env, call: &TransactionStatus, known: usize) -> R<Value> {
    for _ in 0..300 {
        let reqs = requests(env).await?;
        if let Some(r) = reqs.get(known) {
            return Ok(r.clone());
        }
        if let Poll::Ready(r) = call.status().await?
            && !r.is_success()
        {
            return Err(format!(
                "call failed without an OutLayer request: {}",
                failure_text(&r)
            )
            .into());
        }
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    }
    Err(format!("no OutLayer request number {known}").into())
}

async fn tender_view(env: &Env, id: u64) -> R<Value> {
    Ok(env
        .tender
        .view("get_tender")
        .args_json(json!({"tender_id": id}))
        .await?
        .json()?)
}

async fn requests(env: &Env) -> R<Vec<Value>> {
    Ok(env.outlayer.view("get_requests").await?.json()?)
}

async fn resolve(env: &Env, request_id: u64, output: Option<&str>) -> R<ExecutionFinalResult> {
    Ok(env
        .root
        .call(env.outlayer.id(), "resolve")
        .args_json(json!({"request_id": request_id, "output": output}))
        .gas(Gas::from_tgas(300))
        .transact()
        .await?)
}

/// Creates tender 1 with a deadline DEADLINE_MARGIN_S after the chain clock, sets its key, funds
/// it. Returns the deadline.
async fn open_tender(env: &Env) -> R<u64> {
    let mut rubric: Value = serde_json::from_str(&specs("examples/rubric.example.json"))?;
    rubric["currency"]["asset"] = json!(format!("nep141:{}", env.token.id()));
    let rubric_json = String::from_utf8(jcs(&rubric).unwrap())?;
    let deadline = chain_now(env).await? + DEADLINE_MARGIN_S * 1_000_000_000;
    let pending = start(
        env.buyer
            .call(env.tender.id(), "create_tender")
            .args_json(json!({
                "rubric_json": rubric_json,
                "deadline_ns": deadline.to_string(),
                "bond": BOND,
                "committee": [
                    {"account": env.buyer.id(), "report_pubkey": pk("committee_key")},
                    {"account": env.reviewer.id(), "report_pubkey": pk("debrief_key")},
                ],
                "evaluator_index": 0,
            }))
            .deposit(NearToken::from_near(1))
            .gas(Gas::from_tgas(300)),
    )
    .await?;

    // OutLayer (the mock) received derive_pubkey; the "TEE" answers.
    let req = new_request(env, &pending, 0).await?;
    let input: Value = serde_json::from_str(req["input_data"].as_str().unwrap())?;
    assert_eq!(input["action"], "derive_pubkey");
    assert_eq!(req["response_format"], "Text");
    assert_eq!(req["payer_account_id"], env.buyer.id().as_str());
    let key = json!({"v": 1, "tid": "1", "pk": pk("tender_key")}).to_string();
    check(resolve(env, 0, Some(&key)).await?, "resolve key");
    assert_eq!(ok(pending.await?, "create_tender").json::<u64>()?, 1);
    wait_status(env, "AwaitingFunds").await?;

    check(
        env.buyer
            .call(env.token.id(), "ft_transfer_call")
            .args_json(json!({"receiver_id": env.tender.id(), "amount": CAP.to_string(), "msg": "{\"fund_tender\":\"1\"}"}))
            .deposit(NearToken::from_yoctonear(1))
            .gas(Gas::from_tgas(100))
            .transact()
            .await?,
        "fund",
    );
    assert_eq!(tender_view(env, 1).await?["status"], "Open");
    Ok(deadline)
}

async fn submit(env: &Env, vendor: &Account, seed: u8, size: usize) -> R<ExecutionFinalResult> {
    Ok(vendor
        .call(env.tender.id(), "submit_bid")
        .args_json(json!({
            "tender_id": 1,
            "ciphertext_b64": STANDARD.encode(vec![seed; size]),
            "debrief_pubkey": pk("debrief_key"),
        }))
        .deposit(NearToken::from_millinear(300))
        .gas(Gas::from_tgas(100))
        .transact()
        .await?)
}

/// `close_and_evaluate` expected to fail before making a request (e.g. before the deadline).
async fn close(env: &Env, caller: &Account) -> R<ExecutionFinalResult> {
    Ok(caller
        .call(env.tender.id(), "close_and_evaluate")
        .args_json(json!({"tender_id": 1}))
        .gas(Gas::from_tgas(300))
        .transact()
        .await?)
}

/// `close_and_evaluate` or `retry_evaluate` that makes an evaluate request: returns the pending
/// call, the mock's request id and the parsed evaluate input.
async fn start_eval(
    env: &Env,
    caller: &Account,
    method: &str,
) -> R<(TransactionStatus, u64, Value)> {
    let known = requests(env).await?.len();
    let pending = start(
        caller
            .call(env.tender.id(), method)
            .args_json(json!({"tender_id": 1}))
            .gas(Gas::from_tgas(300)),
    )
    .await?;
    let req = new_request(env, &pending, known).await?;
    let input: Value = serde_json::from_str(req["input_data"].as_str().unwrap())?;
    assert_eq!(input["action"], "evaluate");
    Ok((pending, req["request_id"].as_u64().unwrap(), input))
}

/// A canonical compact result echoing the tender.
async fn result(env: &Env, attempt: u64, rk: Value, status: &str) -> R<String> {
    let t = tender_view(env, 1).await?;
    let v = json!({
        "v": 1, "tid": "1", "root": t["frozen"]["root"], "rubric": t["rubric_hash"],
        "bundle": "cd".repeat(32), "attempt": attempt, "status": status, "rk": rk,
    });
    Ok(String::from_utf8(jcs(&v).unwrap())?)
}

/// Yield callbacks run in the receipts of the transaction that created the yield, a block or two
/// after `resolve`: poll the tender's status.
async fn wait_status(env: &Env, status: &str) -> R {
    for _ in 0..60 {
        if tender_view(env, 1).await?["status"] == status {
            return Ok(());
        }
        tokio::time::sleep(std::time::Duration::from_millis(250)).await;
    }
    Err(format!(
        "status never became {status}: {}",
        tender_view(env, 1).await?["status"]
    )
    .into())
}

/// Polls until `accounts` gained exactly `delta` yocto each (bond transfers land after the callback).
async fn wait_gain(accounts: &[Account], before: &[u128], delta: u128) -> R {
    for _ in 0..60 {
        let now = futures_balances(accounts).await?;
        if now
            .iter()
            .zip(before)
            .all(|(a, b)| a.checked_sub(*b) == Some(delta))
        {
            return Ok(());
        }
        tokio::time::sleep(std::time::Duration::from_millis(250)).await;
    }
    Err(format!(
        "balances {:?} did not gain {delta} over {before:?}",
        futures_balances(accounts).await?
    )
    .into())
}

async fn near_balance(a: &Account) -> R<u128> {
    Ok(a.view_account().await?.balance.as_yoctonear())
}

async fn ft_balance(env: &Env, a: &Account) -> R<u128> {
    let v: String = env
        .token
        .view("ft_balance_of")
        .args_json(json!({"account_id": a.id()}))
        .await?
        .json()?;
    Ok(v.parse()?)
}

// ----------------------------------------------------------------- tests ---

/// Full happy path with the 3-bid vector ranking: I3 (no close before the deadline), I4 (frozen
/// set, no bids after), the evaluate input of docs/04 §6, acceptance and bond refunds.
#[tokio::test]
async fn i3_i4_happy_path_with_the_three_bid_vector() -> R {
    let env = setup(&["vendor-a", "vendor-b", "vendor-c"]).await?;
    let deadline = open_tender(&env).await?;
    for (i, v) in env.vendors.iter().enumerate() {
        check(submit(&env, v, i as u8 + 1, 800).await?, "submit_bid");
    }

    let early = close(&env, &env.vendors[0]).await?;
    assert!(
        !early.is_success() && failure_text(&early).contains("E_DEADLINE_NOT_REACHED"),
        "I3"
    );

    cross_deadline(&env, deadline).await?;
    let late = submit(&env, &env.reviewer, 9, 800).await?;
    assert!(
        !late.is_success() && failure_text(&late).contains("E_DEADLINE_PASSED"),
        "I2: no bid after the deadline"
    );
    // Anyone may close; not a bidder here, so the close call's prepaid gas (refunded when its
    // yielded callback finishes) does not mix with the bond refunds measured below.
    let (closing, rid, input) = start_eval(&env, &env.reviewer, "close_and_evaluate").await?;
    let t = tender_view(&env, 1).await?;
    assert_eq!(t["status"], "Evaluating");
    assert_eq!(t["frozen"]["slots"], json!([0, 1, 2]));
    let after = submit(&env, &env.reviewer, 10, 800).await?;
    assert!(
        !after.is_success() && failure_text(&after).contains("E_NOT_OPEN"),
        "I4"
    );

    assert_eq!(input["attempt"], 1);
    assert_eq!(input["contract_id"], env.tender.id().as_str());
    assert_eq!(input["tender_id"], "1");
    assert_eq!(input["bids_root"], t["frozen"]["root"]);
    assert_eq!(input["rubric_json"], t["rubric_json"]);
    assert_eq!(input["bids"].as_array().unwrap().len(), 3);
    assert_eq!(input["bids"][1]["bidder"], env.vendors[1].id().as_str());
    assert_eq!(
        input["bids"][1]["ciphertext_b64"],
        STANDARD.encode(vec![2u8; 800])
    );
    assert_eq!(input["committee"][1]["account"], env.reviewer.id().as_str());

    let before: Vec<u128> = futures_balances(&env.vendors).await?;
    let text = result(
        &env,
        1,
        json!([[0, 7466, 0], [1, 5955, 0], [2, 5700, 24]]),
        "ok",
    )
    .await?;
    check(resolve(&env, rid, Some(&text)).await?, "resolve result");
    check(closing.await?, "close");
    wait_status(&env, "Evaluated").await?;
    let stored: Option<String> = env
        .tender
        .view("get_result")
        .args_json(json!({"tender_id": 1}))
        .await?
        .json()?;
    assert_eq!(stored.as_deref(), Some(text.as_str()));
    wait_gain(&env.vendors, &before, BOND.as_yoctonear()).await?; // each bond refunded, once
    Ok(())
}

async fn futures_balances(accounts: &[Account]) -> R<Vec<u128>> {
    let mut out = Vec::new();
    for a in accounts {
        out.push(near_balance(a).await?);
    }
    Ok(out)
}

/// I5, chain side: after a result is accepted there is no other way to deliver one. The answered
/// request cannot be resumed again, a direct call from the contract account itself has no promise
/// result to read, and retry is refused. (The contract's own stale-result check is pinned by the
/// unit tests `i5_second_result_rejected` and `i12_failure_retry_success`.)
#[tokio::test]
async fn i5_second_result_rejected() -> R {
    let env = setup(&["vendor-a", "vendor-b"]).await?;
    let deadline = open_tender(&env).await?;
    for (i, v) in env.vendors.iter().enumerate() {
        check(submit(&env, v, i as u8 + 1, 500).await?, "submit_bid");
    }
    cross_deadline(&env, deadline).await?;
    let (closing, rid, _) = start_eval(&env, &env.root, "close_and_evaluate").await?;
    let first = result(&env, 1, json!([[0, 7800, 0], [1, 6400, 0]]), "ok").await?;
    check(resolve(&env, rid, Some(&first)).await?, "first result");
    check(closing.await?, "close");
    wait_status(&env, "Evaluated").await?;

    let again = resolve(&env, rid, Some(&first)).await?;
    assert!(!again.is_success(), "the same request cannot answer twice");
    let direct = env
        .tender
        .call("on_evaluate")
        .args_json(json!({"tender_id": 1, "attempt": 1}))
        .gas(Gas::from_tgas(100))
        .transact()
        .await?;
    assert!(
        !direct.is_success(),
        "a self-call has no promise result to deliver"
    );
    let retry = env
        .root
        .call(env.tender.id(), "retry_evaluate")
        .args_json(json!({"tender_id": 1}))
        .transact()
        .await?;
    assert!(failure_text(&retry).contains("E_BAD_STATUS"));
    let stored: Option<String> = env
        .tender
        .view("get_result")
        .args_json(json!({"tender_id": 1}))
        .await?
        .json()?;
    assert_eq!(stored.as_deref(), Some(first.as_str()));
    Ok(())
}

/// I7: on_evaluate is #[private]; any other caller is refused.
#[tokio::test]
async fn i7_direct_on_evaluate_from_another_account_fails() -> R {
    let env = setup(&["vendor-a"]).await?;
    let deadline = open_tender(&env).await?;
    check(submit(&env, &env.vendors[0], 1, 500).await?, "submit_bid");
    cross_deadline(&env, deadline).await?;
    // The evaluate request stays unanswered: only the attackers' calls run against it.
    let (_closing, _, _) = start_eval(&env, &env.root, "close_and_evaluate").await?;
    for attacker in [&env.vendors[0], &env.buyer, &env.root] {
        let r = attacker
            .call(env.tender.id(), "on_evaluate")
            .args_json(json!({"tender_id": 1, "attempt": 1}))
            .gas(Gas::from_tgas(100))
            .transact()
            .await?;
        assert!(!r.is_success());
        assert!(failure_text(&r).contains("private"), "{}", failure_text(&r));
    }
    assert_eq!(tender_view(&env, 1).await?["status"], "Evaluating");
    Ok(())
}

/// I6 + I12: crafted results (wrong root, missing index, wrong attempt) are rejected and recorded;
/// after the third failure the tender fails and escrow, bonds and fee go back.
#[tokio::test]
async fn i6_crafted_results_rejected_and_i12_three_failures_refund_everything() -> R {
    let env = setup(&["vendor-a", "vendor-b"]).await?;
    let ft_before = ft_balance(&env, &env.buyer).await?;
    let deadline = open_tender(&env).await?;
    for (i, v) in env.vendors.iter().enumerate() {
        check(submit(&env, v, i as u8 + 1, 500).await?, "submit_bid");
    }
    assert_eq!(ft_balance(&env, &env.buyer).await?, ft_before - CAP);
    cross_deadline(&env, deadline).await?;

    let codes = ["E_RESULT_ROOT", "E_RESULT_RANKING", "E_RESULT_ATTEMPT"];
    let vendors_before = futures_balances(&env.vendors).await?;
    for n in 1..=3u64 {
        let method = if n == 1 {
            "close_and_evaluate"
        } else {
            // The contract refuses retries fired inside RETRY_MIN_GAP_NS of the last attempt
            // (D-024 review), so the lenient third attempt cannot land in the same outage window.
            wait_for_retry(&env, 1).await?;
            "retry_evaluate"
        };
        let (pending, rid, input) = start_eval(&env, &env.root, method).await?;
        let t = tender_view(&env, 1).await?;
        assert_eq!(input["attempt"], n);
        assert_eq!(
            input["bids_root"], t["frozen"]["root"],
            "same frozen input on retry"
        );
        let crafted = match n {
            1 => {
                let wrong_root = json!({"v": 1, "tid": "1", "root": "ee".repeat(32), "rubric": t["rubric_hash"],
                    "bundle": "cd".repeat(32), "attempt": 1, "status": "ok", "rk": [[0, 7800, 0], [1, 6400, 0]]});
                String::from_utf8(jcs(&wrong_root).unwrap())?
            }
            2 => result(&env, 2, json!([[0, 7800, 0]]), "ok").await?,
            _ => result(&env, 1, json!([[0, 7800, 0], [1, 6400, 0]]), "ok").await?, // attempt 3 in flight
        };
        if n == 3 {
            let fee: u128 = t["eval_fee_remaining"].as_str().unwrap().parse()?;
            let deposit: u128 = t["exec_deposit"].as_str().unwrap().parse()?;
            let buyer_before = near_balance(&env.buyer).await?;
            check(resolve(&env, rid, Some(&crafted)).await?, "resolve 3");
            check(pending.await?, "retry 3");
            wait_status(&env, "Failed").await?;
            // The remaining fee from the contract, plus the mock OutLayer's refund of this
            // attempt's deposit to the payer (the buyer).
            wait_gain(
                std::slice::from_ref(&env.buyer),
                &[buyer_before],
                fee + deposit,
            )
            .await?;
        } else {
            check(resolve(&env, rid, Some(&crafted)).await?, "resolve");
            check(pending.await?, method);
            wait_status(&env, "EvalFailed").await?;
        }
    }
    let attempts: Vec<Value> = env
        .tender
        .view("get_attempts")
        .args_json(json!({"tender_id": 1}))
        .await?
        .json()?;
    assert_eq!(attempts.len(), 3);
    for (a, code) in attempts.iter().zip(codes) {
        assert_eq!(a["outcome"]["Failed"]["reason"], code);
    }
    // Everything back, once.
    wait_gain(&env.vendors, &vendors_before, BOND.as_yoctonear()).await?;
    for _ in 0..60 {
        if ft_balance(&env, &env.buyer).await? == ft_before {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(250)).await;
    }
    assert_eq!(
        ft_balance(&env, &env.buyer).await?,
        ft_before,
        "escrow back to the buyer"
    );
    let retry = env
        .root
        .call(env.tender.id(), "retry_evaluate")
        .args_json(json!({"tender_id": 1}))
        .transact()
        .await?;
    assert!(failure_text(&retry).contains("E_BAD_STATUS"));
    Ok(())
}

/// I12: a failed run (OutLayer returns null) is recorded; a retry with the same input succeeds.
#[tokio::test]
async fn i12_failure_retry_success() -> R {
    let env = setup(&["vendor-a", "vendor-b"]).await?;
    let deadline = open_tender(&env).await?;
    for (i, v) in env.vendors.iter().enumerate() {
        check(submit(&env, v, i as u8 + 1, 500).await?, "submit_bid");
    }
    cross_deadline(&env, deadline).await?;
    let (closing, rid, first_input) = start_eval(&env, &env.root, "close_and_evaluate").await?;
    check(resolve(&env, rid, None).await?, "failed run");
    check(closing.await?, "close");
    wait_status(&env, "EvalFailed").await?;
    wait_for_retry(&env, 1).await?;
    let (retrying, rid2, input) = start_eval(&env, &env.vendors[1], "retry_evaluate").await?;
    assert_eq!(input["attempt"], 2);
    assert_eq!(input["bids"], first_input["bids"], "same frozen bids");
    let text = result(&env, 2, json!([[1, 7000, 0], [0, 6000, 0]]), "ok").await?;
    check(resolve(&env, rid2, Some(&text)).await?, "result");
    check(retrying.await?, "retry");
    wait_status(&env, "Evaluated").await?;
    let t = tender_view(&env, 1).await?;
    assert_eq!(
        t["attempts"][0]["outcome"]["Failed"]["reason"],
        "E_EVAL_RUN_FAILED"
    );
    assert_eq!(t["attempts"][1]["outcome"], "Accepted");
    Ok(())
}

/// Gas for close_and_evaluate with 5 maximum-size bids from 64-character accounts (the worst
/// case D-020 budgets for), answered with an accepted 5-entry result (5 bond refunds). Printed for
/// PROGRESS.md; every receipt must fit in 300 Tgas.
#[tokio::test]
async fn gas_close_and_evaluate_with_five_large_bids() -> R {
    let names: Vec<String> = (0..5).map(|i| format!("{}{i}", "v".repeat(53))).collect();
    let refs: Vec<&str> = names.iter().map(String::as_str).collect();
    let env = setup(&refs).await?;
    let deadline = open_tender(&env).await?;
    for (i, v) in env.vendors.iter().enumerate() {
        assert_eq!(v.id().as_str().len(), 64);
        let r = submit(&env, v, i as u8 + 1, 4500).await?;
        if i == 0 {
            eprintln!(
                "GAS submit_bid (4500 B, debrief key checked as a curve point, I15): tx total {} Ggas",
                r.total_gas_burnt.as_gas() / 1_000_000_000
            );
        }
        check(r, "submit_bid");
    }
    cross_deadline(&env, deadline).await?;
    let (closing, rid, input) = start_eval(&env, &env.root, "close_and_evaluate").await?;
    let input_len = input.to_string().len();
    let rk = json!([
        [0, 9000, 0],
        [1, 8000, 0],
        [2, 7000, 0],
        [3, 6000, 0],
        [4, 5000, 0]
    ]);
    let text = result(&env, 1, rk, "ok").await?;
    check(resolve(&env, rid, Some(&text)).await?, "resolve");
    let r = ok(closing.await?, "close with 5 large bids");
    let max_receipt = r
        .receipt_outcomes()
        .iter()
        .map(|o| o.gas_burnt.as_tgas())
        .max()
        .unwrap_or(0);
    eprintln!(
        "GAS close_and_evaluate (5 bids x 4500 B, 64-char accounts, accepted result): tx total {} Tgas, largest receipt {} Tgas; evaluate input {} bytes",
        r.total_gas_burnt.as_tgas(),
        max_receipt,
        input_len
    );
    assert!(max_receipt < 300);
    wait_status(&env, "Evaluated").await?;
    Ok(())
}

/// Gas for create_tender with the largest committee (10 report keys, each checked as a curve
/// point, I15) and the example rubric (read in the evaluator's two shapes, I14). Printed for
/// PROGRESS.md.
#[tokio::test]
async fn gas_create_tender_with_ten_committee_keys() -> R {
    let env = setup(&[]).await?;
    let mut rubric: Value = serde_json::from_str(&specs("examples/rubric.example.json"))?;
    rubric["currency"]["asset"] = json!(format!("nep141:{}", env.token.id()));
    let rubric_json = String::from_utf8(jcs(&rubric).unwrap())?;
    let committee: Vec<Value> = (0..10)
        .map(|i| {
            let key = if i % 2 == 0 {
                "committee_key"
            } else {
                "debrief_key"
            };
            json!({"account": format!("member-{i}.test.near"), "report_pubkey": pk(key)})
        })
        .collect();
    let deadline = chain_now(&env).await? + DEADLINE_MARGIN_S * 1_000_000_000;
    let pending = start(
        env.buyer
            .call(env.tender.id(), "create_tender")
            .args_json(json!({
                "rubric_json": rubric_json,
                "deadline_ns": deadline.to_string(),
                "bond": BOND,
                "committee": committee,
                "evaluator_index": 0,
            }))
            .deposit(NearToken::from_near(2))
            .gas(Gas::from_tgas(300)),
    )
    .await?;
    new_request(&env, &pending, 0).await?;
    let key = json!({"v": 1, "tid": "1", "pk": pk("tender_key")}).to_string();
    check(resolve(&env, 0, Some(&key)).await?, "resolve key");
    let r = ok(pending.await?, "create_tender with 10 committee keys");
    let receipts: Vec<u64> = r
        .receipt_outcomes()
        .iter()
        .map(|o| o.gas_burnt.as_gas() / 1_000_000_000)
        .collect();
    eprintln!(
        "GAS create_tender (10 committee keys, example rubric): first receipt {} Ggas, largest receipt {} Ggas, tx total {} Ggas",
        receipts.first().copied().unwrap_or(0),
        receipts.iter().copied().max().unwrap_or(0),
        r.total_gas_burnt.as_gas() / 1_000_000_000
    );
    wait_status(&env, "AwaitingFunds").await?;
    Ok(())
}

/// A run OutLayer never answers: the yield times out (200 blocks), OutLayer's resume callback returns
/// null, and the contract records a failed attempt instead of staying in `Evaluating`.
#[tokio::test]
async fn i12_outlayer_timeout_is_recorded() -> R {
    let env = setup(&["vendor-a"]).await?;
    let deadline = open_tender(&env).await?;
    check(submit(&env, &env.vendors[0], 1, 500).await?, "submit_bid");
    cross_deadline(&env, deadline).await?;
    let (closing, _, _) = start_eval(&env, &env.root, "close_and_evaluate").await?;
    env.worker.fast_forward(250).await?;
    check(closing.await?, "close");
    wait_status(&env, "EvalFailed").await?;
    let t = tender_view(&env, 1).await?;
    assert_eq!(
        t["attempts"][0]["outcome"]["Failed"]["reason"],
        "E_EVAL_RUN_FAILED"
    );
    Ok(())
}
