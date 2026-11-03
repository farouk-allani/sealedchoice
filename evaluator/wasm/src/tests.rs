//! Native tests of the whole pipeline with fixture services (the wasmtime harness runs the same
//! inputs through the real WASM binary).

use crate::error::RunError;
use crate::offline::Fixtures;
use crate::services::{BundleStore, PutOutcome, ServiceError, Services, Unavailable};
use crate::testkit::{self, CONTRACT, MemStore};
use crate::{env_names, run};
use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use evaluator_core::jcs;
use evaluator_core::merkle::{hex, sha256};
use serde_json::{Value, json};
use std::cell::Cell;

fn derive_input(tender_id: &str) -> Vec<u8> {
    json!({"action": "derive_pubkey", "contract_id": CONTRACT, "tender_id": tender_id})
        .to_string()
        .into_bytes()
}

#[test]
fn derive_pubkey_matches_the_vector_and_is_stable() {
    let env = testkit::env();
    let k = testkit::keys();
    let svc = Unavailable::services();
    let out = run(&derive_input("1"), &env, &svc).unwrap();
    assert_eq!(
        String::from_utf8(out.clone()).unwrap(),
        format!("{{\"pk\":\"{}\",\"tid\":\"1\",\"v\":1}}", k.tender_pk_hex)
    );
    assert_eq!(
        run(&derive_input("1"), &env, &svc).unwrap(),
        out,
        "two runs agree"
    );
    let other = run(&derive_input("2"), &env, &svc).unwrap();
    assert_ne!(other, out, "another tender, another key");
    for o in [&out, &other] {
        let text = String::from_utf8_lossy(o);
        assert!(!text.contains(&k.tender_sk_hex) && !text.contains(&k.master_secret_hex));
    }
}

#[test]
fn derive_pubkey_refuses_without_the_contract_or_the_secret() {
    let svc = Unavailable::services();
    let mut env = testkit::env();
    env.0
        .insert(env_names::SENDER_ID.into(), "someone.testnet".into());
    assert_eq!(
        run(&derive_input("1"), &env, &svc),
        Err(RunError::SenderMismatch)
    );
    env.0.remove(env_names::SENDER_ID);
    assert_eq!(
        run(&derive_input("1"), &env, &svc),
        Err(RunError::SenderMismatch)
    );

    let mut env = testkit::env();
    env.0.remove(env_names::MASTER_SECRET);
    assert_eq!(
        run(&derive_input("1"), &env, &svc).map_err(|e| e.code()),
        Err("E_ENV")
    );
    env.0
        .insert(env_names::MASTER_SECRET.into(), "11".repeat(31));
    assert_eq!(
        run(&derive_input("1"), &env, &svc).map_err(|e| e.code()),
        Err("E_ENV")
    );
}

#[test]
fn unknown_and_stub_actions_refuse() {
    let env = testkit::env();
    let svc = Unavailable::services();
    for (input, code) in [
        (json!({"action": "nope"}), "E_INPUT"),
        (json!({"action": "quote"}), "E_NOT_IMPLEMENTED"),
        (json!({"action": "payout_status"}), "E_NOT_IMPLEMENTED"),
        (
            json!({"action": "derive_pubkey", "contract_id": CONTRACT, "tender_id": "1", "x": 1}),
            "E_INPUT",
        ),
    ] {
        let r = run(input.to_string().as_bytes(), &env, &svc);
        assert_eq!(r.map_err(|e| e.code()), Err(code), "{input}");
    }
    assert_eq!(
        run(b"not json", &env, &svc).map_err(|e| e.code()),
        Err("E_INPUT")
    );
}

/// Runs a case with fixture services; returns stdout and the stored bundle.
fn evaluate(case: &testkit::Case) -> Result<(Value, Value), RunError> {
    let fixtures = Fixtures::from_value(&case.fixtures).unwrap();
    let store = MemStore::default();
    let svc = testkit::services(&fixtures, &store);
    let out = run(case.input.to_string().as_bytes(), &testkit::env(), &svc)?;
    let compact: Value = serde_json::from_slice(&out).unwrap();
    assert_eq!(out, jcs(&compact).unwrap(), "stdout is JCS");
    assert!(out.len() <= evaluator_core::COMPACT_RESULT_MAX_BYTES);
    let stored = store.0.borrow();
    assert_eq!(stored.len(), 1, "one bundle stored");
    let (name, bytes) = stored.iter().next().unwrap();
    assert_eq!(name, compact["bundle"].as_str().unwrap());
    assert_eq!(hex(&sha256(bytes)), *name);
    let bundle: Value = serde_json::from_slice(bytes).unwrap();
    Ok((compact, bundle))
}

fn check_against_expected(case: &testkit::Case, compact: &Value, bundle: &Value) {
    let rk: Value = case.expected["ranking"].clone();
    assert_eq!(compact["rk"], rk, "ranking, totals and flags");
    assert_eq!(compact["status"], case.expected["status"]);
    let mut result = compact.clone();
    result.as_object_mut().unwrap().remove("bundle");
    assert_eq!(
        bundle["result"], result,
        "bundle.result = compact result minus bundle"
    );
    let k = testkit::keys();
    let expected_bids = case.expected["bids"].as_array().unwrap();
    for d in bundle["debriefs"].as_array().unwrap() {
        let plain = testkit::open(d["ecies_b64"].as_str().unwrap(), &k.debrief_sk_hex);
        assert_eq!(
            hex(&sha256(&plain)),
            d["plaintext_sha256"].as_str().unwrap()
        );
        let debrief: Value = serde_json::from_slice(&plain).unwrap();
        let i = debrief["bid_index"].as_u64().unwrap() as usize;
        let want = &expected_bids[i];
        assert_eq!(debrief["criteria"], want["criteria"], "bid {i} criteria");
        assert_eq!(debrief["total_bp"], want["total_bp"]);
        assert_eq!(debrief["flags"], want["flags"]);
        assert_eq!(debrief["ineligible_reasons"], want["reasons"]);
    }
    for (member, (account, _, sk)) in bundle["committee_report"]
        .as_array()
        .unwrap()
        .iter()
        .zip(testkit::committee())
    {
        assert_eq!(member["member"], account);
        let plain = testkit::open(member["ecies_b64"].as_str().unwrap(), &sk);
        assert_eq!(
            hex(&sha256(&plain)),
            member["plaintext_sha256"].as_str().unwrap()
        );
        let report: Value = serde_json::from_slice(&plain).unwrap();
        assert_eq!(report["rk"], rk);
        assert_eq!(
            report["lowest_eligible_price_minor"],
            case.expected["lowest_eligible_price_minor"]
        );
    }
}

#[test]
fn three_bid_injection_vector_end_to_end() {
    let case = testkit::case("scoring-3-bids-injection.json", 1);
    let (compact, bundle) = evaluate(&case).unwrap();
    check_against_expected(&case, &compact, &bundle);

    // One call per (eligible bid, model), hashes only in public.
    let calls = bundle["model_calls"].as_array().unwrap();
    assert_eq!(calls.len(), 3 * 3);
    let public = bundle.to_string();
    for t in &case.bid_texts {
        assert!(
            !public.contains(t.as_str()),
            "no proposal text in the public bundle"
        );
    }
    assert!(
        !public.contains("12000000000"),
        "no price in the public bundle"
    );

    // The prompts: boundary lines, the proposal, never the price.
    let k = testkit::keys();
    let d0 = &bundle["debriefs"][0];
    let debrief: Value = serde_json::from_slice(&testkit::open(
        d0["ecies_b64"].as_str().unwrap(),
        &k.debrief_sk_hex,
    ))
    .unwrap();
    let raw = &debrief["raw_calls"][0];
    let request = String::from_utf8(
        STANDARD
            .decode(raw["request_b64"].as_str().unwrap())
            .unwrap(),
    )
    .unwrap();
    let root =
        evaluator_core::merkle::parse_hash(case.input["bids_root"].as_str().unwrap()).unwrap();
    let b = crate::prompt::boundary(&root, 0);
    assert!(request.contains(&format!("=====BEGIN PROPOSAL {b}=====")));
    assert!(request.contains("missing #[private] on callbacks"));
    assert!(!request.contains("12000000000") && !request.contains("price_minor"));
    assert_eq!(debrief["rank"], 1);
    assert_eq!(debrief["of"], 3);
    assert_eq!(bundle["prompt_hash"], crate::prompt::prompt_hash());
    assert_eq!(
        bundle["evaluator"]["outlayer_request_id"],
        "offline-request-1"
    );
    assert_eq!(bundle["evaluator"]["near_block_height"], 123456);
    assert_eq!(
        bundle["attestation"]["nonce_hex"],
        crate::pipeline::attestation_nonce(&root, 1)
    );
}

#[test]
fn every_scoring_vector_through_the_pipeline() {
    let mut n = 0;
    for file in ["scoring-2-bids.json", "scoring-3-bids-injection.json"] {
        let case = testkit::case(file, 1);
        let (compact, bundle) = evaluate(&case).unwrap();
        check_against_expected(&case, &compact, &bundle);
        n += 1;
    }
    let edge = testkit::spec_json("test-vectors/scoring-edge-cases.json");
    for c in edge["cases"].as_array().unwrap() {
        let case = testkit::case_from(c, 2);
        let (compact, bundle) = evaluate(&case).unwrap_or_else(|e| panic!("{}: {e}", c["name"]));
        check_against_expected(&case, &compact, &bundle);
        assert_eq!(compact["attempt"], 2);
        n += 1;
    }
    assert_eq!(n, 2 + edge["cases"].as_array().unwrap().len());
}

#[test]
fn refuses_a_wrong_root_rubric_attempt_or_sender() {
    let base = testkit::case("scoring-2-bids.json", 1);
    let refuse = |f: &dyn Fn(&mut Value), code: &str| {
        let mut case = testkit::case("scoring-2-bids.json", 1);
        case.input = base.input.clone();
        f(&mut case.input);
        assert_eq!(
            evaluate(&case).map(|_| ()).map_err(|e| e.code()),
            Err(code),
            "{code}"
        );
    };
    refuse(
        &|i| i["bids_root"] = json!("00".repeat(32)),
        "E_ROOT_MISMATCH",
    );
    refuse(
        &|i| i["bids"][0]["submitted_at_ns"] = json!("1"),
        "E_ROOT_MISMATCH",
    );
    refuse(
        &|i| {
            let r = i["rubric_json"].as_str().unwrap().replacen('{', "{ ", 1);
            i["rubric_json"] = json!(r);
        },
        "E_RUBRIC",
    );
    refuse(&|i| i["attempt"] = json!(0), "E_ATTEMPT");
    refuse(&|i| i["attempt"] = json!(4), "E_ATTEMPT");
    refuse(&|i| i["contract_id"] = json!("other.testnet"), "E_SENDER");
    // AI never sees prices: a rubric that would show price_minor to a model is refused.
    refuse(
        &|i| {
            let mut r: Value = serde_json::from_str(i["rubric_json"].as_str().unwrap()).unwrap();
            for c in r["criteria"].as_array_mut().unwrap() {
                if c["type"] == "qualitative" {
                    c["source_fields"] = json!(["methodology", "price_minor"]);
                }
            }
            i["rubric_json"] = json!(String::from_utf8(jcs(&r).unwrap()).unwrap());
        },
        "E_RUBRIC",
    );
}

#[test]
fn a_bid_that_does_not_decrypt_is_decrypt_failed() {
    let mut case = testkit::case("scoring-2-bids.json", 1);
    // Re-encrypt bid 1 to another key: it no longer opens with the tender key.
    let other = testkit::unhex(&testkit::keys().debrief_pk_hex);
    let ct = ecies::encrypt(&other, b"{}").unwrap();
    case.input["bids"][1]["ciphertext_b64"] = json!(STANDARD.encode(&ct));
    let leaves: Vec<_> = case.input["bids"]
        .as_array()
        .unwrap()
        .iter()
        .map(|b| {
            evaluator_core::merkle::merkle_leaf(
                b["bidder"].as_str().unwrap(),
                b["submitted_at_ns"].as_str().unwrap().parse().unwrap(),
                &STANDARD
                    .decode(b["ciphertext_b64"].as_str().unwrap())
                    .unwrap(),
            )
            .unwrap()
        })
        .collect();
    case.input["bids_root"] = json!(hex(&evaluator_core::merkle::merkle_root(&leaves).unwrap()));
    let (compact, bundle) = evaluate(&case).unwrap();
    let rk = compact["rk"].as_array().unwrap();
    assert_eq!(
        rk.last().unwrap(),
        &json!([1, 0, 3]),
        "INELIGIBLE | DECRYPT_FAILED, ranked last"
    );
    assert_eq!(
        bundle["bids"][1]["ineligible_reasons"],
        json!(["decrypt_failed"])
    );
    assert_eq!(
        bundle["model_calls"].as_array().unwrap().len(),
        3,
        "never sent to a model"
    );
}

#[test]
fn the_default_build_stops_before_any_result() {
    let case = testkit::case("scoring-2-bids.json", 1);
    let r = run(
        case.input.to_string().as_bytes(),
        &testkit::env(),
        &Unavailable::services(),
    );
    assert_eq!(r.map_err(|e| e.code()), Err("E_SERVICE"));
}

struct Flaky {
    fails: Cell<u32>,
    inner: MemStore,
    conflict: bool,
}

impl BundleStore for Flaky {
    fn put_if_absent(&self, h: &str, body: &[u8]) -> Result<PutOutcome, ServiceError> {
        if self.fails.get() > 0 {
            self.fails.set(self.fails.get() - 1);
            return Err(ServiceError("down"));
        }
        if self.conflict {
            return Ok(PutOutcome::Conflict);
        }
        self.inner.put_if_absent(h, body)
    }
}

#[test]
fn no_result_without_a_stored_bundle() {
    let case = testkit::case("scoring-2-bids.json", 1);
    let fixtures = Fixtures::from_value(&case.fixtures).unwrap();
    let unused = MemStore::default();
    let go = |store: &Flaky| {
        let svc = Services {
            store,
            ..testkit::services(&fixtures, &unused)
        };
        run(case.input.to_string().as_bytes(), &testkit::env(), &svc).map(|_| ())
    };
    let once = Flaky {
        fails: Cell::new(1),
        inner: MemStore::default(),
        conflict: false,
    };
    assert_eq!(go(&once), Ok(()), "one retry");
    assert_eq!(once.inner.0.borrow().len(), 1);
    let twice = Flaky {
        fails: Cell::new(2),
        inner: MemStore::default(),
        conflict: false,
    };
    assert_eq!(go(&twice).map_err(|e| e.code()), Err("E_SERVICE"));
    let conflict = Flaky {
        fails: Cell::new(0),
        inner: MemStore::default(),
        conflict: true,
    };
    assert_eq!(go(&conflict).map_err(|e| e.code()), Err("E_SERVICE"));
}

#[test]
fn error_object_is_a_fixed_code() {
    assert_eq!(
        crate::error_object(&RunError::RootMismatch),
        br#"{"error":"E_ROOT_MISMATCH","v":1}"#.to_vec()
    );
    let v: Value = serde_json::from_slice(&crate::error_object(&RunError::Attempt)).unwrap();
    assert_eq!(jcs(&v).unwrap(), crate::error_object(&RunError::Attempt));
}

#[test]
fn ecies_reads_the_eciespy_vectors_and_round_trips_with_reader_keys() {
    // Bids are encrypted in the browser with eciesjs; ecies-decrypt.json holds eciespy 0.4.7
    // ciphertexts in the same format (uncompressed ephemeral key, 16-byte nonce).
    let v = testkit::spec_json("test-vectors/ecies-decrypt.json");
    let sk = testkit::unhex(v["tender_sk_hex"].as_str().unwrap());
    let cases = v["cases"].as_array().unwrap();
    assert!(!cases.is_empty());
    for c in cases {
        let ct = STANDARD
            .decode(c["ciphertext_b64"].as_str().unwrap())
            .unwrap();
        let plain = ecies::decrypt(&sk, &ct).unwrap();
        assert_eq!(
            hex(&sha256(&plain)),
            c["plaintext_jcs_sha256"].as_str().unwrap()
        );
        // 65-byte ephemeral key + 16-byte nonce + 16-byte tag.
        assert_eq!(ct.len(), plain.len() + 97);
    }
    let k = testkit::keys();
    let sealed = ecies::encrypt(&testkit::unhex(&k.committee_pk_hex), b"report").unwrap();
    assert_eq!(sealed.len(), 6 + 97);
    assert_eq!(
        testkit::open(&STANDARD.encode(&sealed), &k.committee_sk_hex),
        b"report"
    );
}
