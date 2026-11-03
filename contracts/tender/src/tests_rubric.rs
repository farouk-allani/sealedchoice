//! I14 (every rubric the evaluator refuses is refused at creation) and I15 (reader keys are
//! secp256k1 points). The evaluator side is the real `evaluator_wasm::pipeline::check_rubric`.

use super::*;
use crate::rubric::is_compressed_pubkey;
use evaluator_wasm::pipeline::check_rubric;

type Mutate = fn(&mut Value);

fn qual(v: &mut Value) -> &mut Value {
    &mut v["criteria"][1]
}

/// (what, mutation, the contract's code; None = both accept).
const CASES: &[(&str, Mutate, Option<&str>)] = &[
    ("example", |_| {}, None),
    // Shapes the scoring core reads.
    (
        "no title",
        |v| drop(v.as_object_mut().unwrap().remove("title")),
        Some("E_RUBRIC_FIELDS"),
    ),
    (
        "scope not a string",
        |v| v["scope"] = json!(5),
        Some("E_RUBRIC_FIELDS"),
    ),
    (
        "no max_delivery_days",
        |v| drop(v.as_object_mut().unwrap().remove("max_delivery_days")),
        Some("E_RUBRIC_FIELDS"),
    ),
    (
        "negative max_delivery_days",
        |v| v["max_delivery_days"] = json!(-1),
        Some("E_RUBRIC_FIELDS"),
    ),
    (
        "no eligibility",
        |v| drop(v.as_object_mut().unwrap().remove("eligibility")),
        Some("E_RUBRIC_FIELDS"),
    ),
    (
        "eligibility flag not a bool",
        |v| v["eligibility"]["require_price_lte_cap"] = json!("yes"),
        Some("E_RUBRIC_FIELDS"),
    ),
    (
        "required_fields not a list",
        |v| v["eligibility"]["required_fields"] = json!("price_minor"),
        Some("E_RUBRIC_FIELDS"),
    ),
    (
        "aggregation field missing",
        |v| {
            drop(
                v["aggregation"]
                    .as_object_mut()
                    .unwrap()
                    .remove("evidence_clamp_score"),
            )
        },
        Some("E_RUBRIC_FIELDS"),
    ),
    (
        "u8 field over 255",
        |v| v["aggregation"]["disagreement_threshold"] = json!(256),
        Some("E_RUBRIC_FIELDS"),
    ),
    (
        "negative u8 field",
        |v| v["aggregation"]["evidence_clamp_score"] = json!(-1),
        Some("E_RUBRIC_FIELDS"),
    ),
    (
        "unknown criterion type",
        |v| v["criteria"][0]["type"] = json!("price_highest"),
        Some("E_RUBRIC_FIELDS"),
    ),
    (
        "criterion id not a string",
        |v| qual(v)["id"] = json!(7),
        Some("E_RUBRIC_FIELDS"),
    ),
    (
        "qualitative without source_fields",
        |v| drop(qual(v).as_object_mut().unwrap().remove("source_fields")),
        Some("E_RUBRIC_FIELDS"),
    ),
    // Shapes the prompt reads (also on price criteria, which the prompt never shows).
    (
        "price question not a string",
        |v| v["criteria"][0]["question"] = json!(5),
        Some("E_RUBRIC_FIELDS"),
    ),
    (
        "price source_fields null",
        |v| v["criteria"][0]["source_fields"] = json!(null),
        Some("E_RUBRIC_FIELDS"),
    ),
    (
        "anchor not a string",
        |v| qual(v)["anchors"]["0"] = json!(1),
        Some("E_RUBRIC_FIELDS"),
    ),
    // AI never sees prices.
    (
        "qualitative reads price_minor",
        |v| qual(v)["source_fields"] = json!(["price_minor"]),
        Some("E_RUBRIC_SOURCE_FIELDS"),
    ),
    (
        "qualitative reads delivery_days",
        |v| qual(v)["source_fields"] = json!(["methodology", "delivery_days"]),
        Some("E_RUBRIC_SOURCE_FIELDS"),
    ),
    (
        "qualitative reads bidder",
        |v| v["criteria"][2]["source_fields"] = json!(["bidder"]),
        Some("E_RUBRIC_SOURCE_FIELDS"),
    ),
    // At least two models' answers behind a result (D-024).
    (
        "min_valid_outputs 0",
        |v| v["aggregation"]["min_valid_outputs"] = json!(0),
        Some("E_RUBRIC_AGGREGATION"),
    ),
    (
        "min_valid_outputs 1",
        |v| v["aggregation"]["min_valid_outputs"] = json!(1),
        Some("E_RUBRIC_AGGREGATION"),
    ),
    (
        "min_valid_outputs 4",
        |v| v["aggregation"]["min_valid_outputs"] = json!(4),
        Some("E_RUBRIC_AGGREGATION"),
    ),
    (
        "min_valid_outputs 3",
        |v| v["aggregation"]["min_valid_outputs"] = json!(3),
        None,
    ),
    // The user template renders.
    (
        "no question",
        |v| drop(qual(v).as_object_mut().unwrap().remove("question")),
        Some("E_RUBRIC_PROMPT"),
    ),
    (
        "question null",
        |v| qual(v)["question"] = json!(null),
        Some("E_RUBRIC_PROMPT"),
    ),
    (
        "no anchors",
        |v| drop(qual(v).as_object_mut().unwrap().remove("anchors")),
        Some("E_RUBRIC_PROMPT"),
    ),
    (
        "anchor 5 missing",
        |v| {
            drop(
                v["criteria"][2]["anchors"]
                    .as_object_mut()
                    .unwrap()
                    .remove("5"),
            )
        },
        Some("E_RUBRIC_PROMPT"),
    ),
    // Extra content the evaluator ignores.
    (
        "extra field on a criterion",
        |v| v["criteria"][0]["note"] = json!("x"),
        None,
    ),
    (
        "extra anchor",
        |v| qual(v)["anchors"]["6"] = json!("beyond the scale"),
        None,
    ),
    (
        "question on the price criterion",
        |v| v["criteria"][0]["question"] = json!("lowest?"),
        None,
    ),
];

#[test]
fn i14_every_rubric_the_evaluator_refuses_is_refused_at_creation() {
    call(BUYER, NearToken::from_yoctonear(0), NOW);
    for (what, mutate, code) in CASES {
        let mut v = rubric_value();
        mutate(&mut v);
        let text = canonical(&v);
        let evaluator = check_rubric(&text).map(|_| ()).map_err(|e| e.code());
        let contract = parse_rubric(&text, 2).map(|_| ());
        match code {
            Some(code) => {
                assert!(evaluator.is_err(), "{what}: the evaluator accepts it");
                assert_eq!(contract, Err(*code), "{what}");
            }
            None => {
                assert_eq!(evaluator, Ok(()), "{what}: evaluator");
                assert_eq!(contract, Ok(()), "{what}: contract");
            }
        }
    }
}

#[test]
fn i14_usize_fields_are_bounded_as_on_wasm32() {
    // The evaluator runs on wasm32, where its usize fields stop at 2^32 - 1; a host build of it
    // would accept this, the deployed one does not, and neither does the contract.
    call(BUYER, NearToken::from_yoctonear(0), NOW);
    for field in ["min_valid_outputs", "evidence_min_chars"] {
        let mut v = rubric_value();
        v["aggregation"][field] = json!(1u64 << 32);
        assert_eq!(
            parse_rubric(&canonical(&v), 2),
            Err("E_RUBRIC_FIELDS"),
            "{field}"
        );
    }
}

#[test]
#[should_panic(expected = "E_RUBRIC_PROMPT")]
fn i14_create_tender_refuses_a_rubric_the_prompt_cannot_show() {
    let mut c = setup();
    let mut v = rubric_value();
    qual(&mut v).as_object_mut().unwrap().remove("anchors");
    create_with(&mut c, canonical(&v), committee(), DEADLINE);
}

/// x = 0 is not on secp256k1 (7 is not a square mod p) and x = p is not a field element; both
/// pass a hex-format check. A run before I15 failed on them (D-024).
fn off_curve() -> [String; 3] {
    [
        format!("02{}", "00".repeat(32)),
        format!("03{}", "00".repeat(32)),
        "02fffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2f".to_string(),
    ]
}

#[test]
fn i15_reader_keys_are_curve_points() {
    for name in ["tender_key", "debrief_key", "committee_key"] {
        let key = pk(name);
        assert!(is_compressed_pubkey(&key), "{name}");
        // The other y for the same x is the negated point: also on the curve.
        let flipped = if key.starts_with("02") { "03" } else { "02" };
        assert!(
            is_compressed_pubkey(&format!("{flipped}{}", &key[2..])),
            "{name}"
        );
    }
    for key in off_curve() {
        assert!(!is_compressed_pubkey(&key), "{key}");
    }
    assert!(!is_compressed_pubkey(&pk("debrief_key").to_uppercase()));
    assert!(!is_compressed_pubkey(&format!(
        "04{}",
        &pk("debrief_key")[2..]
    )));
    assert!(!is_compressed_pubkey(&pk("debrief_key")[..64]));
}

#[test]
fn i15_submit_bid_refuses_an_off_curve_debrief_key() {
    for key in off_curve() {
        let mut c = setup();
        let id = open(&mut c);
        call(VENDORS[0], milli(200), NOW + 10);
        let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            c.submit_bid(id, ciphertext(1), key.clone());
        }));
        let msg = r.expect_err("accepted an off-curve key");
        let text = msg
            .downcast_ref::<String>()
            .cloned()
            .or_else(|| msg.downcast_ref::<&str>().map(|s| s.to_string()))
            .unwrap_or_default();
        assert!(text.contains("E_BAD_PUBKEY"), "{key}: {text}");
    }
}

#[test]
#[should_panic(expected = "E_BAD_PUBKEY")]
fn i15_create_tender_refuses_an_off_curve_committee_key() {
    let mut c = setup();
    let mut m = committee();
    m[1].report_pubkey = off_curve()[0].clone();
    create_with(&mut c, rubric_json(), m, DEADLINE);
}

#[test]
fn i15_an_off_curve_tender_key_leaves_the_tender_pending() {
    let mut c = setup();
    let id = create(&mut c);
    callback(
        NOW + 1,
        PromiseResult::Successful(key_payload(&id.to_string(), &off_curve()[1])),
    );
    assert!(!c.on_pubkey(id));
    assert_eq!(c.get_tender(id).unwrap().status, Status::PendingKey);
    assert!(get_logs().iter().any(|l| l == "E_BAD_PUBKEY"));
}
