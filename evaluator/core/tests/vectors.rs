//! Every vector in specs/test-vectors/ that the pure core covers, loaded by relative path.
//! Scoring results are compared as serde_json::Value (key order irrelevant, values exact).
// Test crate: helpers outside #[test] fns may unwrap too (clippy.toml covers only #[test] code).
#![allow(clippy::unwrap_used, clippy::expect_used)]

use evaluator_core::keys::{
    SALT_COMMITTEE, SALT_DEBRIEF, SALT_TENDER, hkdf_sha256, key_derivation_message,
    pubkey_compressed, reader_key, tender_key,
};
use evaluator_core::merkle::{
    ProofStep, hex, merkle_leaf, merkle_proof, merkle_root, merkle_verify, parse_hash, sha256,
};
use evaluator_core::{BidInput, COMPACT_RESULT_MAX_BYTES, Rubric, compact_result, evaluate, jcs};
use serde_json::Value;
use std::collections::BTreeMap;
use std::path::PathBuf;

fn specs(rel: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../specs")
        .join(rel)
}

fn load(rel: &str) -> Value {
    let text = std::fs::read_to_string(specs(rel)).unwrap_or_else(|e| panic!("{rel}: {e}"));
    serde_json::from_str(&text).unwrap_or_else(|e| panic!("{rel}: {e}"))
}

fn from_hex(s: &str) -> Vec<u8> {
    (0..s.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&s[i..i + 2], 16).unwrap())
        .collect()
}

/// Runs one scoring case and compares with `expected`.
fn run_case(name: &str, rubric_json: &Value, case: &Value) {
    let rubric: Rubric = serde_json::from_value(rubric_json.clone()).unwrap();
    let tender_id = case["tender_id"].as_str().unwrap();
    let bids: Vec<BidInput> = serde_json::from_value(case["bids"].clone()).unwrap();
    let outputs: BTreeMap<String, Vec<Value>> =
        serde_json::from_value(case["model_outputs"].clone()).unwrap();
    let ev =
        evaluate(&rubric, tender_id, &bids, &outputs).unwrap_or_else(|e| panic!("{name}: {e}"));
    let got = serde_json::to_value(&ev).unwrap();
    assert_eq!(
        got, case["expected"],
        "{name}: evaluation differs from reference.py"
    );
}

#[test]
fn scoring_2_bids() {
    let v = load("test-vectors/scoring-2-bids.json");
    run_case("scoring-2-bids", &v["rubric"], &v);
    let rk = &v["expected"]["ranking"];
    assert_eq!(rk[0][1], 7800);
    assert_eq!(rk[1][1], 6400);
}

#[test]
fn scoring_3_bids_injection() {
    let v = load("test-vectors/scoring-3-bids-injection.json");
    run_case("scoring-3-bids-injection", &v["rubric"], &v);
    assert_eq!(
        v["expected"]["ranking"][2],
        serde_json::json!([2, 5700, 24])
    );
}

macro_rules! edge_case {
    ($test:ident, $name:literal) => {
        #[test]
        fn $test() {
            let v = load("test-vectors/scoring-edge-cases.json");
            let rubric = load(v["rubric_ref"].as_str().unwrap());
            let case = v["cases"]
                .as_array()
                .unwrap()
                .iter()
                .find(|c| c["name"] == $name)
                .expect($name);
            run_case($name, &rubric, case);
        }
    };
}

edge_case!(edge_tie_break_lower_price, "tie_break_lower_price");
edge_case!(
    edge_over_budget_cap_is_ineligible,
    "over_budget_cap_is_ineligible"
);
edge_case!(
    edge_quote_not_in_proposal_is_clamped,
    "quote_not_in_proposal_is_clamped"
);
edge_case!(
    edge_one_model_failed_uses_lower_median,
    "one_model_failed_uses_lower_median"
);
edge_case!(
    edge_copied_ciphertext_account_mismatch,
    "copied_ciphertext_account_mismatch"
);
edge_case!(edge_decrypt_failed, "decrypt_failed");
edge_case!(edge_malformed_plaintext_types, "malformed_plaintext_types");
edge_case!(
    edge_injection_hidden_with_invisible_characters,
    "injection_hidden_with_invisible_characters"
);
edge_case!(edge_no_eligible_bids, "no_eligible_bids");

#[test]
fn every_edge_case_has_a_test() {
    let v = load("test-vectors/scoring-edge-cases.json");
    let names: Vec<&str> = v["cases"]
        .as_array()
        .unwrap()
        .iter()
        .map(|c| c["name"].as_str().unwrap())
        .collect();
    assert_eq!(
        names,
        [
            "tie_break_lower_price",
            "over_budget_cap_is_ineligible",
            "quote_not_in_proposal_is_clamped",
            "one_model_failed_uses_lower_median",
            "copied_ciphertext_account_mismatch",
            "decrypt_failed",
            "malformed_plaintext_types",
            "injection_hidden_with_invisible_characters",
            "no_eligible_bids",
        ]
    );
}

#[test]
fn weights_and_indices_are_checked() {
    let v = load("test-vectors/scoring-2-bids.json");
    let mut rubric_json = v["rubric"].clone();
    rubric_json["criteria"][0]["weight_bp"] = 3000.into();
    let rubric: Rubric = serde_json::from_value(rubric_json).unwrap();
    let bids: Vec<BidInput> = serde_json::from_value(v["bids"].clone()).unwrap();
    let outputs: BTreeMap<String, Vec<Value>> =
        serde_json::from_value(v["model_outputs"].clone()).unwrap();
    assert_eq!(
        evaluate(&rubric, "1", &bids, &outputs).unwrap_err().code(),
        "E_WEIGHTS"
    );

    let rubric: Rubric = serde_json::from_value(v["rubric"].clone()).unwrap();
    let mut swapped = bids.clone();
    swapped.swap(0, 1);
    assert_eq!(
        evaluate(&rubric, "1", &swapped, &outputs)
            .unwrap_err()
            .code(),
        "E_BID_INDICES"
    );
}

#[test]
fn unknown_criterion_type_is_refused() {
    let v = load("test-vectors/scoring-2-bids.json");
    let mut rubric_json = v["rubric"].clone();
    rubric_json["criteria"][0]["type"] = "price_highest_wins".into();
    assert!(serde_json::from_value::<Rubric>(rubric_json).is_err());
}

#[test]
fn thirty_digit_prices_fit_and_thirty_one_do_not() {
    let v = load("test-vectors/scoring-2-bids.json");
    let mut rubric_json = v["rubric"].clone();
    rubric_json["budget_cap_minor"] = "9".repeat(30).into();
    let rubric: Rubric = serde_json::from_value(rubric_json).unwrap();
    let mut bids: Vec<BidInput> = serde_json::from_value(v["bids"].clone()).unwrap();
    let outputs: BTreeMap<String, Vec<Value>> =
        serde_json::from_value(v["model_outputs"].clone()).unwrap();
    bids[0].plaintext.as_mut().unwrap()["price_minor"] = "9".repeat(30).into();
    bids[1].plaintext.as_mut().unwrap()["price_minor"] = "9".repeat(31).into();
    let ev = evaluate(&rubric, "1", &bids, &outputs).unwrap();
    assert!(ev.bids[0].eligible);
    assert_eq!(ev.bids[0].criteria["price"].bp(), 10_000);
    assert_eq!(ev.bids[1].reasons, ["bad_price"]);
    assert_eq!(
        ev.lowest_eligible_price_minor.as_deref(),
        Some("9".repeat(30).as_str())
    );
}

// ----------------------------------------------------------------- merkle ---

#[test]
fn merkle_vectors() {
    let v = load("test-vectors/merkle.json");
    let leaves: Vec<[u8; 32]> = v["leaves_input"]
        .as_array()
        .unwrap()
        .iter()
        .map(|x| {
            merkle_leaf(
                x["bidder"].as_str().unwrap(),
                x["submitted_at_ns"].as_u64().unwrap(),
                x["ciphertext_utf8"].as_str().unwrap().as_bytes(),
            )
            .unwrap()
        })
        .collect();
    let expected_leaves: Vec<&str> = v["leaves"]
        .as_array()
        .unwrap()
        .iter()
        .map(|l| l.as_str().unwrap())
        .collect();
    assert_eq!(
        leaves.iter().map(|l| hex(l)).collect::<Vec<_>>(),
        expected_leaves
    );

    for tree in v["trees"].as_array().unwrap() {
        let n = tree["n"].as_u64().unwrap() as usize;
        let subset = &leaves[..n];
        let root = merkle_root(subset).unwrap();
        assert_eq!(hex(&root), tree["root"].as_str().unwrap(), "root for n={n}");
        for i in 0..n {
            let proof = merkle_proof(subset, i).unwrap();
            let expected: Vec<ProofStep> =
                serde_json::from_value(tree["proofs"][i.to_string()].clone()).unwrap();
            assert_eq!(proof, expected, "proof {i} for n={n}");
            assert!(merkle_verify(&subset[i], &proof, &root));
            if n > 1 {
                assert!(!merkle_verify(&subset[(i + 1) % n], &proof, &root));
            }
        }
        assert!(merkle_proof(subset, n).is_none());
    }
    assert!(merkle_root(&[]).is_err());
    assert_eq!(parse_hash(&hex(&leaves[0])), Some(leaves[0]));
}

// ------------------------------------------------------------- hashes/keys ---

#[test]
fn hashes_and_keys_vectors() {
    let v = load("test-vectors/hashes-and-keys.json");
    let rubric = load("examples/rubric.example.json");
    let bytes = jcs(&rubric).unwrap();
    assert_eq!(bytes.len() as u64, v["rubric_jcs_length"].as_u64().unwrap());
    assert_eq!(
        hex(&sha256(&bytes)),
        v["rubric_jcs_sha256"].as_str().unwrap()
    );

    let contract = v["nep413_recipient"].as_str().unwrap();
    let tk = &v["tender_key"];
    assert_eq!(tk["salt"].as_str().unwrap().as_bytes(), SALT_TENDER);
    let sk = tender_key(
        &from_hex(tk["master_secret_hex"].as_str().unwrap()),
        contract,
        "1",
    )
    .unwrap();
    assert_eq!(hex(&sk), tk["sk_hex"].as_str().unwrap());
    assert_eq!(
        hex(&pubkey_compressed(&sk).unwrap()),
        tk["pk_compressed_hex"].as_str().unwrap()
    );

    for (field, salt, account) in [
        ("debrief_key", SALT_DEBRIEF, "vendor-a.testnet"),
        ("committee_key", SALT_COMMITTEE, "buyer.testnet"),
    ] {
        let k = &v[field];
        assert_eq!(k["salt"].as_str().unwrap().as_bytes(), salt, "{field} salt");
        assert_eq!(
            k["info"].as_str().unwrap(),
            format!("{contract}:1:{account}")
        );
        let sk = reader_key(
            &from_hex(k["signature_hex"].as_str().unwrap()),
            salt,
            contract,
            "1",
            account,
        )
        .unwrap();
        assert_eq!(hex(&sk), k["sk_hex"].as_str().unwrap(), "{field} sk");
        assert_eq!(
            hex(&pubkey_compressed(&sk).unwrap()),
            k["pk_compressed_hex"].as_str().unwrap(),
            "{field} pk"
        );
    }

    let msg = key_derivation_message(contract, "1", "debrief");
    assert_eq!(msg, v["nep413_message"].as_str().unwrap());
    assert_eq!(
        hex(&sha256(msg.as_bytes())),
        v["nep413_nonce_hex"].as_str().unwrap()
    );
}

// ---------------------------------------------------------- compact result ---

#[test]
fn compact_result_vector_byte_for_byte() {
    let v = load("test-vectors/compact-result.json");
    let scoring = load("test-vectors/scoring-3-bids-injection.json");
    let rubric: Rubric = serde_json::from_value(scoring["rubric"].clone()).unwrap();
    let bids: Vec<BidInput> = serde_json::from_value(scoring["bids"].clone()).unwrap();
    let outputs: BTreeMap<String, Vec<Value>> =
        serde_json::from_value(scoring["model_outputs"].clone()).unwrap();
    let ev = evaluate(&rubric, "1", &bids, &outputs).unwrap();

    let input = &v["input"];
    let h = |k: &str| parse_hash(input[k].as_str().unwrap()).unwrap();
    assert_eq!(h("bundle_hash"), sha256(b"example-bundle"));
    let attempt = u8::try_from(input["attempt"].as_u64().unwrap()).unwrap();
    let out = compact_result(
        input["tender_id"].as_str().unwrap(),
        &h("bids_root"),
        &h("rubric_hash"),
        &h("bundle_hash"),
        attempt,
        &ev,
    )
    .unwrap();
    assert_eq!(
        String::from_utf8(out.clone()).unwrap(),
        v["json"].as_str().unwrap()
    );
    assert_eq!(out.len() as u64, v["length"].as_u64().unwrap());
    assert!(out.len() <= COMPACT_RESULT_MAX_BYTES);
}

#[test]
fn compact_result_worst_case_and_limit() {
    let v = load("test-vectors/compact-result.json");
    let scoring = load("test-vectors/scoring-3-bids-injection.json");
    let rubric: Rubric = serde_json::from_value(scoring["rubric"].clone()).unwrap();
    let bids: Vec<BidInput> = serde_json::from_value(scoring["bids"].clone()).unwrap();
    let outputs: BTreeMap<String, Vec<Value>> =
        serde_json::from_value(scoring["model_outputs"].clone()).unwrap();
    let mut ev = evaluate(&rubric, "1", &bids, &outputs).unwrap();
    let h = parse_hash(v["input"]["bids_root"].as_str().unwrap()).unwrap();

    ev.ranking = (0..8).map(|i| (i, 10_000, 127)).collect();
    let worst = compact_result("123456789", &h, &h, &h, 3, &ev).unwrap();
    assert_eq!(
        worst.len() as u64,
        v["worst_case_length_8_bids"].as_u64().unwrap()
    );

    ev.ranking = (0..60).map(|i| (i, 10_000, 127)).collect();
    assert_eq!(
        compact_result("1", &h, &h, &h, 1, &ev).unwrap_err().code(),
        "E_RESULT_TOO_LARGE"
    );
}

// ---------------------------------------------------------- spec fidelity ---

#[test]
fn injection_patterns_match_reference_py() {
    let reference = std::fs::read_to_string(specs("reference/reference.py")).unwrap();
    let start = reference.find("INJECTION_PATTERNS = [").unwrap();
    let block = &reference[start..start + reference[start..].find("\n]").unwrap()];
    let patterns: Vec<&str> = block
        .lines()
        .filter_map(|l| l.trim().strip_prefix("r\""))
        .map(|l| l.trim_end_matches(',').trim_end_matches('"'))
        .collect();
    assert_eq!(patterns, evaluator_core::scoring::INJECTION_PATTERNS);
}

#[test]
fn limits_and_flags_match_reference_py() {
    let reference = std::fs::read_to_string(specs("reference/reference.py")).unwrap();
    assert!(reference.contains(r#"LIMITS = {"methodology": 2000, "track_record": 1200}"#));
    assert_eq!(
        evaluator_core::scoring::LIMITS,
        [("methodology", 2000), ("track_record", 1200)]
    );
    use evaluator_core::flags::*;
    for (name, value) in [
        ("INELIGIBLE", INELIGIBLE),
        ("DECRYPT_FAILED", DECRYPT_FAILED),
        ("ACCOUNT_MISMATCH", ACCOUNT_MISMATCH),
        ("INJECTION_SUSPECTED", INJECTION_SUSPECTED),
        ("DISAGREEMENT", DISAGREEMENT),
        ("EVIDENCE_MISSING", EVIDENCE_MISSING),
        ("EVAL_INCOMPLETE", EVAL_INCOMPLETE),
    ] {
        let bit = value.trailing_zeros();
        assert!(
            reference.contains(&format!("\"{name}\": 1 << {bit},")),
            "{name}"
        );
    }
}

#[test]
fn hkdf_matches_rfc5869_case_1() {
    // RFC 5869 A.1, first 32 bytes of the 42-byte OKM.
    let okm = hkdf_sha256(
        &[0x0b; 22],
        &from_hex("000102030405060708090a0b0c"),
        &from_hex("f0f1f2f3f4f5f6f7f8f9"),
    )
    .unwrap();
    assert_eq!(
        hex(&okm),
        "3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf"
    );
}

#[test]
fn clamp_never_raises_a_score() {
    // D-019: a rubric may set evidence_clamp_score above evidence_required_from_score; a quote-less
    // score must still not go up.
    let v = load("test-vectors/scoring-edge-cases.json");
    let mut rubric_json = load(v["rubric_ref"].as_str().unwrap());
    rubric_json["aggregation"]["evidence_clamp_score"] = 4.into();
    let rubric: Rubric = serde_json::from_value(rubric_json).unwrap();
    let case = v["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["name"] == "quote_not_in_proposal_is_clamped")
        .unwrap();
    let bids: Vec<BidInput> = serde_json::from_value(case["bids"].clone()).unwrap();
    let outputs: BTreeMap<String, Vec<Value>> =
        serde_json::from_value(case["model_outputs"].clone()).unwrap();
    let ev = evaluate(&rubric, "1", &bids, &outputs).unwrap();
    let detail = serde_json::to_value(&ev.bids[0].criteria["methodology"]).unwrap();
    // Model 0 claimed 4 without a valid quote: min(4, 4) = 4, flagged, never 5 or more.
    assert_eq!(detail["models"][0]["raw"], 4);
    assert_eq!(detail["models"][0]["score"], 4);
    assert_eq!(detail["models"][0]["clamped"], true);
}

#[test]
fn eligibility_reasons_keep_reference_order() {
    // Expected values from reference.py check_eligibility (python3 -I, specs/reference on sys.path).
    let rubric: Rubric = serde_json::from_value(load("examples/rubric.example.json")).unwrap();
    let check = |plaintext: Value| {
        let bid = BidInput {
            index: 0,
            submitter: "vendor-a.testnet".into(),
            decrypt_ok: true,
            plaintext: Some(plaintext),
        };
        evaluator_core::scoring::check_eligibility(&rubric, "1", &bid).unwrap()
    };
    let all_bad = serde_json::json!({"v": 1, "tender_id": "9", "bidder": "someone-else.testnet", "price_minor": "0",
        "delivery_days": 0, "methodology": 42, "track_record": "x".repeat(1201), "salt": "00".repeat(16)});
    assert_eq!(
        check(all_bad),
        (
            5,
            vec![
                "wrong_tender".to_string(),
                "account_mismatch".into(),
                "bad_price".into(),
                "bad_delivery_days".into(),
                "bad_methodology".into(),
                "too_long_track_record".into(),
            ]
        )
    );
    let missing = serde_json::json!({"v": 1, "tender_id": "1", "bidder": "vendor-a.testnet",
        "price_minor": "16000000000", "delivery_days": 31, "methodology": "  \n", "track_record": null});
    assert_eq!(
        check(missing),
        (
            1,
            vec![
                "missing_methodology".to_string(),
                "missing_track_record".into()
            ]
        )
    );
    let over = serde_json::json!({"v": 1, "tender_id": "1", "bidder": "vendor-a.testnet",
        "price_minor": "16000000000", "delivery_days": 31, "methodology": "m", "track_record": "t"});
    assert_eq!(
        check(over),
        (
            1,
            vec!["over_budget_cap".to_string(), "over_max_delivery".into()]
        )
    );
}

#[test]
fn huge_weights_are_refused_not_overflowed() {
    let v = load("test-vectors/scoring-2-bids.json");
    let mut rubric_json = v["rubric"].clone();
    rubric_json["criteria"][0]["weight_bp"] = u64::MAX.into();
    let rubric: Rubric = serde_json::from_value(rubric_json).unwrap();
    let bids: Vec<BidInput> = serde_json::from_value(v["bids"].clone()).unwrap();
    let outputs: BTreeMap<String, Vec<Value>> =
        serde_json::from_value(v["model_outputs"].clone()).unwrap();
    assert_eq!(
        evaluate(&rubric, "1", &bids, &outputs).unwrap_err().code(),
        "E_WEIGHTS"
    );
}
