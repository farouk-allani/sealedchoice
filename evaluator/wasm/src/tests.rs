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
    let report_env = &bundle["committee_report"];
    let members = testkit::committee();
    assert_eq!(report_env["keys"].as_array().unwrap().len(), members.len());
    for (i, (account, _, sk)) in members.iter().enumerate() {
        let entry = &report_env["keys"][i];
        assert_eq!(entry["member"], account.as_str());
        assert!(
            entry.get("plaintext_sha256").is_none(),
            "no hash of the key"
        );
        let plain = testkit::open_report(report_env, i, sk);
        assert_eq!(
            hex(&sha256(&plain)),
            report_env["plaintext_sha256"].as_str().unwrap()
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

/// x = 0 is not on secp256k1 (7 is not a square mod p), yet "02" + 64 zeros passes the contract's
/// format check.
const OFF_CURVE: &str = "020000000000000000000000000000000000000000000000000000000000000000";

#[test]
fn a_reader_key_off_the_curve_is_recorded_not_fatal() {
    let mut case = testkit::case("scoring-3-bids-injection.json", 1);
    case.input["bids"][1]["debrief_pubkey"] = json!(OFF_CURVE);
    case.input["committee"][1]["pubkey"] = json!(OFF_CURVE);
    let (compact, bundle) = evaluate(&case).expect("a bad reader key must not stop the run");
    assert_eq!(compact["rk"], case.expected["ranking"]);
    let d1 = &bundle["debriefs"][1];
    assert_eq!(d1["ecies_b64"], "");
    assert_eq!(d1["error"], "E_READER_KEY");
    assert_eq!(d1["recipient_pubkey"], OFF_CURVE);
    let c1 = &bundle["committee_report"]["keys"][1];
    assert_eq!(
        (c1["ecies_b64"].as_str(), c1["error"].as_str()),
        (Some(""), Some("E_READER_KEY"))
    );
    // Everyone else still gets a readable envelope.
    let k = testkit::keys();
    for i in [0, 2] {
        let d = &bundle["debriefs"][i];
        assert!(d.get("error").is_none());
        testkit::open(d["ecies_b64"].as_str().unwrap(), &k.debrief_sk_hex);
    }
    testkit::open_report(&bundle["committee_report"], 0, &k.committee_sk_hex);
    // Not hex at all is the same case.
    case.input["bids"][0]["debrief_pubkey"] = json!("zz");
    let (_, bundle) = evaluate(&case).unwrap();
    assert_eq!(bundle["debriefs"][0]["error"], "E_READER_KEY");
}

#[test]
fn a_failed_call_keeps_its_attempts_and_bytes() {
    let edge = testkit::spec_json("test-vectors/scoring-edge-cases.json");
    let c = edge["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["name"] == "one_model_failed_uses_lower_median")
        .unwrap();
    let case = testkit::case_from(c, 1);
    let (_, bundle) = evaluate(&case).unwrap();
    let failed = bundle["model_calls"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c.get("error").is_some())
        .expect("model 1's call is recorded as failed");
    assert_eq!(failed["attempts"], 2, "the try and its retry");
    assert_eq!(failed["http_status"], 503);
    assert_eq!(failed["chat_id"], "");
    assert_ne!(
        failed["request_sha256"],
        hex(&sha256(b"")),
        "the request sent is hashed"
    );
    let k = testkit::keys();
    let debrief: Value = serde_json::from_slice(&testkit::open(
        bundle["debriefs"][0]["ecies_b64"].as_str().unwrap(),
        &k.debrief_sk_hex,
    ))
    .unwrap();
    let raws = debrief["raw_calls"].as_array().unwrap();
    assert_eq!(
        raws.len(),
        3,
        "failed calls keep their bytes in the debrief"
    );
    let raw = raws.iter().find(|r| r["chat_id"] == "").unwrap();
    let req = STANDARD
        .decode(raw["request_b64"].as_str().unwrap())
        .unwrap();
    assert_eq!(
        hex(&sha256(&req)),
        failed["request_sha256"].as_str().unwrap()
    );
}

/// Counts every service call.
#[derive(Default)]
struct Counting {
    calls: Cell<u32>,
}

impl crate::services::ModelClient for Counting {
    fn complete(
        &self,
        _: &crate::services::ModelRequest<'_>,
    ) -> Result<crate::services::ModelReply, crate::services::ModelFailure> {
        self.calls.set(self.calls.get() + 1);
        Err(crate::services::ModelFailure {
            attempts: 0,
            request: vec![],
            response: vec![],
            http_status: None,
            reason: "counting",
        })
    }
}
impl crate::services::SignatureSource for Counting {
    fn signature(&self, _: &str, _: &str) -> Result<Value, ServiceError> {
        self.calls.set(self.calls.get() + 1);
        Err(ServiceError("counting"))
    }
}
impl crate::services::AttestationSource for Counting {
    fn reports(&self, _: &str, _: &[String]) -> Result<Vec<Value>, ServiceError> {
        self.calls.set(self.calls.get() + 1);
        Err(ServiceError("counting"))
    }
}
impl BundleStore for Counting {
    fn put_if_absent(&self, _: &str, _: &[u8]) -> Result<PutOutcome, ServiceError> {
        self.calls.set(self.calls.get() + 1);
        Err(ServiceError("counting"))
    }
}
impl crate::services::ExecutionInfo for Counting {
    fn wasm_sha256(&self) -> Result<String, ServiceError> {
        self.calls.set(self.calls.get() + 1);
        Err(ServiceError("counting"))
    }
    fn request_id(&self) -> Result<Value, ServiceError> {
        self.calls.set(self.calls.get() + 1);
        Err(ServiceError("counting"))
    }
}

#[test]
fn refusals_happen_before_any_service_is_called() {
    let base = testkit::case("scoring-2-bids.json", 1).input;
    type Mutation<'a> = (&'a str, &'a dyn Fn(&mut Value));
    let mutations: [Mutation<'_>; 4] = [
        ("E_SENDER", &|i| i["contract_id"] = json!("other.testnet")),
        ("E_ATTEMPT", &|i| i["attempt"] = json!(4)),
        ("E_RUBRIC", &|i| {
            let r = i["rubric_json"].as_str().unwrap().replacen('{', "{ ", 1);
            i["rubric_json"] = json!(r);
        }),
        ("E_ROOT_MISMATCH", &|i| {
            i["bids_root"] = json!("11".repeat(32))
        }),
    ];
    for (code, mutate) in mutations {
        let mut input = base.clone();
        mutate(&mut input);
        let counting = Counting::default();
        let svc = Services {
            models: &counting,
            signatures: &counting,
            attestation: &counting,
            store: &counting,
            execution: &counting,
        };
        let r = run(input.to_string().as_bytes(), &testkit::env(), &svc);
        assert_eq!(r.map_err(|e| e.code()), Err(code));
        assert_eq!(counting.calls.get(), 0, "{code}: no service called");
    }
}

#[test]
fn no_price_in_the_public_bundle_or_in_any_prompt() {
    for file in ["scoring-2-bids.json", "scoring-3-bids-injection.json"] {
        let case = testkit::case(file, 1);
        let vector = testkit::spec_json(&format!("test-vectors/{file}"));
        let prices: Vec<String> = vector["bids"]
            .as_array()
            .unwrap()
            .iter()
            .map(|b| b["plaintext"]["price_minor"].as_str().unwrap().to_string())
            .collect();
        let (_, bundle) = evaluate(&case).unwrap();
        let public = bundle.to_string();
        let k = testkit::keys();
        for d in bundle["debriefs"].as_array().unwrap() {
            let debrief: Value = serde_json::from_slice(&testkit::open(
                d["ecies_b64"].as_str().unwrap(),
                &k.debrief_sk_hex,
            ))
            .unwrap();
            for raw in debrief["raw_calls"].as_array().unwrap() {
                let req = String::from_utf8(
                    STANDARD
                        .decode(raw["request_b64"].as_str().unwrap())
                        .unwrap(),
                )
                .unwrap();
                assert!(!req.contains("price_minor") && !req.contains("delivery_days"));
                for p in &prices {
                    assert!(
                        !req.contains(p.as_str()),
                        "{file}: a price reached a prompt"
                    );
                }
            }
        }
        for p in &prices {
            assert!(
                !public.contains(p.as_str()),
                "{file}: a price is in the public bundle"
            );
        }
    }
}

/// Worst case the contract allows: 5 bids with maximum-length proposals, 10 committee members,
/// every model answering with a long rationale. Returns the bundle size in bytes.
fn worst_case_bundle_bytes() -> usize {
    let mut v = testkit::spec_json("test-vectors/scoring-3-bids-injection.json");
    let base = v["bids"][0].clone();
    let bids: Vec<Value> = (0..5)
        .map(|i| {
            let mut b = base.clone();
            let bidder = format!("{}{i}", "v".repeat(53));
            b["index"] = json!(i);
            b["submitter"] = json!(bidder);
            b["plaintext"]["bidder"] = json!(bidder);
            b["plaintext"]["methodology"] = json!("m".repeat(1990) + &format!(" bid {i:04}"));
            b["plaintext"]["track_record"] = json!("t".repeat(1190) + &format!(" bid {i:04}"));
            b
        })
        .collect();
    v["bids"] = json!(bids);
    let answer = json!({"scores": [
        {"criterion_id": "methodology", "score": 3, "evidence": ["m".repeat(60), "m".repeat(60)],
         "missing": ["x".repeat(120), "y".repeat(120)], "rationale": "r".repeat(400)},
        {"criterion_id": "track_record", "score": 3, "evidence": ["t".repeat(60)],
         "missing": ["z".repeat(120)], "rationale": "r".repeat(400)},
    ]});
    let outputs: serde_json::Map<String, Value> = (0..5)
        .map(|i| (i.to_string(), json!([answer, answer, answer])))
        .collect();
    v["model_outputs"] = Value::Object(outputs);
    let mut case = testkit::case_from(&v, 1);
    let member = case.input["committee"][0].clone();
    case.input["committee"] = json!(
        (0..10)
            .map(|i| {
                let mut m = member.clone();
                m["account"] = json!(format!("member-{i}.testnet"));
                m
            })
            .collect::<Vec<_>>()
    );
    let fixtures = Fixtures::from_value(&case.fixtures).unwrap();
    let store = MemStore::default();
    let svc = testkit::services(&fixtures, &store);
    run(case.input.to_string().as_bytes(), &testkit::env(), &svc).unwrap();
    let sizes: Vec<usize> = store.0.borrow().values().map(Vec::len).collect();
    sizes[0]
}

/// Measured 2026-11-03 with fixture bodies: 2,698,072 bytes when the committee report was encrypted
/// once per member, 476,872 bytes with one body and per-member key envelopes (D-024). The store
/// limit is MAX_BUNDLE_BYTES = 4 MiB (packages/shared); real model responses are larger than the
/// fixtures, so keep a wide margin.
#[test]
fn worst_case_bundle_size_is_measured() {
    let bytes = worst_case_bundle_bytes();
    eprintln!("worst-case bundle (5 bids x 3 models, 10 members, fixture bodies): {bytes} bytes");
    assert!(bytes < 1_000_000, "{bytes}: update D-024 and PROGRESS");
    assert!(
        bytes < 4 * 1024 * 1024 / 4,
        "a quarter of the store limit at most"
    );
}

#[test]
fn the_committee_report_body_does_not_grow_with_the_committee() {
    let size = |members: usize| {
        let mut case = testkit::case("scoring-3-bids-injection.json", 1);
        let m = case.input["committee"][0].clone();
        case.input["committee"] = json!(
            (0..members)
                .map(|i| {
                    let mut x = m.clone();
                    x["account"] = json!(format!("member-{i}.testnet"));
                    x
                })
                .collect::<Vec<_>>()
        );
        let (_, bundle) = evaluate(&case).unwrap();
        let report = &bundle["committee_report"];
        (
            report["body_b64"].as_str().unwrap().len(),
            bundle.to_string().len(),
        )
    };
    let (body1, total1) = size(1);
    let (body10, total10) = size(10);
    assert_eq!(body1, body10, "one body, whatever the committee size");
    // Each further member adds only a key envelope (~250 bytes of JSON).
    assert!(total10 - total1 < 9 * 400, "{total1} -> {total10}");
}
