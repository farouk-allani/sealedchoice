//! Rubric checks done at creation (docs/03-contract.md "Parse the rubric …") and the JCS
//! serializer that proves `rubric_json` is canonical, so `rubric_hash = sha256(rubric_json)`
//! equals sha256(JCS(rubric)) as every other implementation computes it.

use crate::MAX_RUBRIC_BYTES;
use near_sdk::serde::Deserialize;
use near_sdk::serde_json::{self, Value};
use near_sdk::{AccountId, env};
use std::collections::BTreeMap;

pub const BP: u64 = 10_000;
pub const MAX_SAFE_INT: u64 = (1 << 53) - 1;

/// What the contract keeps from the rubric; the rest is only hashed and passed on.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedRubric {
    pub hash_hex: String,
    pub currency_token: AccountId,
    pub budget_cap: u128,
    pub approvals_required: u8,
    pub acceptance_window_ns: u64,
}

#[derive(Deserialize)]
#[serde(crate = "near_sdk::serde")]
struct RubricHead {
    currency: Currency,
    budget_cap_minor: String,
    criteria: Vec<CriterionHead>,
    models: Vec<String>,
    award_policy: AwardPolicy,
}

#[derive(Deserialize)]
#[serde(crate = "near_sdk::serde")]
struct Currency {
    asset: String,
}

#[derive(Deserialize)]
#[serde(crate = "near_sdk::serde")]
struct CriterionHead {
    weight_bp: u64,
}

#[derive(Deserialize)]
#[serde(crate = "near_sdk::serde")]
struct AwardPolicy {
    approvals_required: u64,
    acceptance_window_hours: u64,
}

// ---------------------------------------------- the rubric as the evaluator reads it (I14) ---
//
// Same field names and types as evaluator/core `Rubric` and evaluator/wasm `PromptRubric`, so a
// rubric that deserializes here deserializes there (`usize` there is `u32` here: the evaluator
// runs on wasm32). Serde reading the fields is the check, so most are never read afterwards.

/// Proposal fields a qualitative criterion may show a model (evaluator/wasm `PROMPT_FIELDS`):
/// price, delivery and identity never reach a prompt.
pub const PROMPT_FIELDS: [&str; 2] = ["methodology", "track_record"];

/// Anchors the prompt's user template shows for every qualitative criterion.
const PROMPT_ANCHORS: [&str; 6] = ["0", "1", "2", "3", "4", "5"];

#[derive(Deserialize)]
#[serde(crate = "near_sdk::serde")]
#[allow(dead_code)]
struct ScoringShape {
    budget_cap_minor: String,
    max_delivery_days: u64,
    criteria: Vec<ScoringCriterion>,
    eligibility: ScoringEligibility,
    models: Vec<String>,
    aggregation: ScoringAggregation,
}

#[derive(Deserialize)]
#[serde(crate = "near_sdk::serde", tag = "type")]
#[allow(dead_code)]
enum ScoringCriterion {
    #[serde(rename = "price_lowest_ratio")]
    PriceLowestRatio { id: String, weight_bp: u64 },
    #[serde(rename = "qualitative")]
    Qualitative {
        id: String,
        weight_bp: u64,
        source_fields: Vec<String>,
    },
}

#[derive(Deserialize)]
#[serde(crate = "near_sdk::serde")]
#[allow(dead_code)]
struct ScoringEligibility {
    require_price_lte_cap: bool,
    require_delivery_lte_max: bool,
    required_fields: Vec<String>,
}

#[derive(Deserialize)]
#[serde(crate = "near_sdk::serde")]
#[allow(dead_code)]
struct ScoringAggregation {
    min_valid_outputs: u32,
    disagreement_threshold: u8,
    evidence_min_chars: u32,
    evidence_required_from_score: u8,
    evidence_clamp_score: u8,
}

#[derive(Deserialize)]
#[serde(crate = "near_sdk::serde")]
#[allow(dead_code)]
struct PromptShape {
    title: String,
    scope: String,
    criteria: Vec<PromptCriterion>,
}

#[derive(Deserialize)]
#[serde(crate = "near_sdk::serde")]
#[allow(dead_code)]
struct PromptCriterion {
    id: String,
    #[serde(rename = "type")]
    kind: String,
    #[serde(default)]
    question: Option<String>,
    #[serde(default)]
    anchors: Option<BTreeMap<String, String>>,
    #[serde(default)]
    source_fields: Vec<String>,
}

/// I14: refuses every rubric the evaluator refuses (evaluator/wasm `check_rubric`), so a tender
/// that takes bids can be evaluated. JCS, weights, the budget cap and 3 models are checked in
/// `parse_rubric` before this.
fn check_evaluable(value: &Value) -> Result<(), &'static str> {
    let scoring = ScoringShape::deserialize(value).map_err(|_| "E_RUBRIC_FIELDS")?;
    let prompt = PromptShape::deserialize(value).map_err(|_| "E_RUBRIC_FIELDS")?;
    let qualitative = || prompt.criteria.iter().filter(|c| c.kind == "qualitative");
    if qualitative()
        .flat_map(|c| c.source_fields.iter())
        .any(|f| !PROMPT_FIELDS.contains(&f.as_str()))
    {
        return Err("E_RUBRIC_SOURCE_FIELDS");
    }
    // At least two models' answers behind every result (D-024 outage rule); 3 models exactly.
    if !(2..=3).contains(&scoring.aggregation.min_valid_outputs) {
        return Err("E_RUBRIC_AGGREGATION");
    }
    let renders = |c: &PromptCriterion| {
        c.question.is_some()
            && c.anchors
                .as_ref()
                .is_some_and(|a| PROMPT_ANCHORS.iter().all(|k| a.contains_key(*k)))
    };
    if !qualitative().all(renders) {
        return Err("E_RUBRIC_PROMPT");
    }
    Ok(())
}

/// Validates the rubric and returns the parts the contract stores.
/// Errors are the `E_*` codes listed in contracts/tender/README.md.
pub fn parse_rubric(rubric_json: &str, committee_len: usize) -> Result<ParsedRubric, &'static str> {
    if rubric_json.len() > MAX_RUBRIC_BYTES {
        return Err("E_RUBRIC_TOO_LARGE");
    }
    let value: Value = serde_json::from_str(rubric_json).map_err(|_| "E_RUBRIC_JSON")?;
    if jcs(&value)?.as_slice() != rubric_json.as_bytes() {
        return Err("E_RUBRIC_NOT_CANONICAL");
    }
    if value.get("v").and_then(Value::as_u64) != Some(1) {
        return Err("E_RUBRIC_VERSION");
    }
    let head = RubricHead::deserialize(&value).map_err(|_| "E_RUBRIC_FIELDS")?;

    let weights = head
        .criteria
        .iter()
        .try_fold(0u64, |acc, c| acc.checked_add(c.weight_bp));
    if head.criteria.is_empty() || weights != Some(BP) {
        return Err("E_RUBRIC_WEIGHTS");
    }
    if head.models.len() != 3
        || head.models.iter().any(String::is_empty)
        || head.models[0] == head.models[1]
        || head.models[0] == head.models[2]
        || head.models[1] == head.models[2]
    {
        return Err("E_RUBRIC_MODELS");
    }
    let budget_cap = parse_amount(&head.budget_cap_minor).ok_or("E_RUBRIC_CAP")?;
    let token = head
        .currency
        .asset
        .strip_prefix("nep141:")
        .ok_or("E_RUBRIC_TOKEN")?;
    let currency_token: AccountId = token.parse().map_err(|_| "E_RUBRIC_TOKEN")?;
    let approvals = head.award_policy.approvals_required;
    if approvals == 0 || approvals > 5 || approvals as usize > committee_len {
        return Err("E_RUBRIC_APPROVALS");
    }
    let hours = head.award_policy.acceptance_window_hours;
    if !(1..=720).contains(&hours) {
        return Err("E_RUBRIC_WINDOW");
    }
    check_evaluable(&value)?;
    Ok(ParsedRubric {
        hash_hex: hex(&env::sha256(rubric_json.as_bytes())),
        currency_token,
        budget_cap,
        approvals_required: approvals as u8,
        acceptance_window_ns: hours * 3_600 * 1_000_000_000,
    })
}

/// `[1-9][0-9]{0,29}` as u128 (reference.py `is_pos_int_str`).
pub fn parse_amount(s: &str) -> Option<u128> {
    let b = s.as_bytes();
    let ok = (1..=30).contains(&b.len())
        && (b'1'..=b'9').contains(&b[0])
        && b[1..].iter().all(u8::is_ascii_digit);
    if ok { s.parse().ok() } else { None }
}

/// A compressed secp256k1 public key: 66 lowercase hex characters, prefix 02 or 03, and a point
/// on the curve (I15). The evaluator cannot encrypt to a key that is not a point, so its reader
/// would get no debrief or report.
pub fn is_compressed_pubkey(s: &str) -> bool {
    let b = s.as_bytes();
    let format = b.len() == 66
        && b[0] == b'0'
        && (b[1] == b'2' || b[1] == b'3')
        && b.iter().all(|c| matches!(c, b'0'..=b'9' | b'a'..=b'f'));
    format && unhex(s).is_some_and(|bytes| k256::PublicKey::from_sec1_bytes(&bytes).is_ok())
}

/// Lowercase hex to bytes.
fn unhex(s: &str) -> Option<Vec<u8>> {
    let nibble = |c: u8| match c {
        b'0'..=b'9' => Some(c - b'0'),
        b'a'..=b'f' => Some(c - b'a' + 10),
        _ => None,
    };
    if !s.len().is_multiple_of(2) {
        return None;
    }
    s.as_bytes()
        .chunks(2)
        .map(|p| Some(nibble(p[0])? << 4 | nibble(p[1])?))
        .collect()
}

pub fn is_sha256_hex(s: &str) -> bool {
    s.len() == 64 && s.bytes().all(|c| matches!(c, b'0'..=b'9' | b'a'..=b'f'))
}

pub fn hex(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut s = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        s.push(char::from(HEX[usize::from(b >> 4)]));
        s.push(char::from(HEX[usize::from(b & 0xf)]));
    }
    s
}

/// RFC 8785 for our subset (same rules as evaluator/core/src/jcs.rs and reference.py `jcs`):
/// ASCII keys sorted, no whitespace, integers within ±(2^53 − 1), no floats.
pub fn jcs(v: &Value) -> Result<Vec<u8>, &'static str> {
    let mut out = String::new();
    write(v, &mut out)?;
    Ok(out.into_bytes())
}

fn write(v: &Value, out: &mut String) -> Result<(), &'static str> {
    match v {
        Value::Null => out.push_str("null"),
        Value::Bool(b) => out.push_str(if *b { "true" } else { "false" }),
        Value::Number(n) => {
            if let Some(u) = n.as_u64() {
                if u > MAX_SAFE_INT {
                    return Err("E_RUBRIC_NOT_CANONICAL");
                }
                out.push_str(&u.to_string());
            } else if let Some(i) = n.as_i64() {
                if i.unsigned_abs() > MAX_SAFE_INT {
                    return Err("E_RUBRIC_NOT_CANONICAL");
                }
                out.push_str(&i.to_string());
            } else {
                return Err("E_RUBRIC_NOT_CANONICAL");
            }
        }
        Value::String(s) => write_string(s, out),
        Value::Array(items) => {
            out.push('[');
            for (i, item) in items.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                write(item, out)?;
            }
            out.push(']');
        }
        Value::Object(map) => {
            let mut keys: Vec<&String> = map.keys().collect();
            if keys.iter().any(|k| !k.is_ascii()) {
                return Err("E_RUBRIC_NOT_CANONICAL");
            }
            keys.sort();
            out.push('{');
            for (i, k) in keys.into_iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                write_string(k, out);
                out.push(':');
                if let Some(val) = map.get(k) {
                    write(val, out)?;
                }
            }
            out.push('}');
        }
    }
    Ok(())
}

fn write_string(s: &str, out: &mut String) {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    out.push('"');
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\u{8}' => out.push_str("\\b"),
            '\t' => out.push_str("\\t"),
            '\n' => out.push_str("\\n"),
            '\u{c}' => out.push_str("\\f"),
            '\r' => out.push_str("\\r"),
            c if (c as u32) < 0x20 => {
                let b = c as u32 as usize;
                out.push_str("\\u00");
                out.push(char::from(HEX[b >> 4]));
                out.push(char::from(HEX[b & 0xf]));
            }
            c => out.push(c),
        }
    }
    out.push('"');
}
