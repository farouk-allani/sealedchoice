//! Test support shared by this crate's tests and the wasmtime harness (feature `testkit`):
//! the FAKE keys from specs/test-vectors/hashes-and-keys.json, an `evaluate` input built from a
//! scoring vector (bids encrypted to the fake tender key), the matching fixture file, and
//! in-memory services. Never compiled into the WASM.

use crate::offline::Fixtures;
use crate::services::{BundleStore, Environment, PutOutcome, ServiceError, Services};
use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use evaluator_core::jcs;
use evaluator_core::merkle::{hex, merkle_leaf, merkle_root, sha256};
use serde_json::{Value, json};
use std::cell::RefCell;
use std::collections::BTreeMap;
use std::path::PathBuf;

/// The contract id the key vectors were made for.
pub const CONTRACT: &str = "tenders.sealedchoice.testnet";
/// A WASM hash for the fixtures (the offline build cannot know its own).
pub const FIXTURE_WASM_SHA256: &str =
    "0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f";

pub fn specs_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../specs")
}

pub fn spec_json(rel: &str) -> Value {
    let text = std::fs::read_to_string(specs_dir().join(rel))
        .unwrap_or_else(|e| panic!("read specs/{rel}: {e}"));
    serde_json::from_str(&text).unwrap_or_else(|e| panic!("parse specs/{rel}: {e}"))
}

pub fn unhex(s: &str) -> Vec<u8> {
    (0..s.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&s[i..i + 2], 16).unwrap_or_else(|e| panic!("hex: {e}")))
        .collect()
}

/// The FAKE keys of hashes-and-keys.json.
pub struct Keys {
    pub master_secret_hex: String,
    pub tender_pk_hex: String,
    pub tender_sk_hex: String,
    pub debrief_pk_hex: String,
    pub debrief_sk_hex: String,
    pub committee_pk_hex: String,
    pub committee_sk_hex: String,
}

pub fn keys() -> Keys {
    let v = spec_json("test-vectors/hashes-and-keys.json");
    let s = |k: &str, f: &str| v[k][f].as_str().unwrap_or_default().to_string();
    Keys {
        master_secret_hex: s("tender_key", "master_secret_hex"),
        tender_pk_hex: s("tender_key", "pk_compressed_hex"),
        tender_sk_hex: s("tender_key", "sk_hex"),
        debrief_pk_hex: s("debrief_key", "pk_compressed_hex"),
        debrief_sk_hex: s("debrief_key", "sk_hex"),
        committee_pk_hex: s("committee_key", "pk_compressed_hex"),
        committee_sk_hex: s("committee_key", "sk_hex"),
    }
}

/// Committee members of the generated inputs: both decrypt with a vector key.
pub fn committee() -> Vec<(String, String, String)> {
    let k = keys();
    vec![
        (
            "buyer.testnet".into(),
            k.committee_pk_hex.clone(),
            k.committee_sk_hex.clone(),
        ),
        (
            "reviewer.testnet".into(),
            k.debrief_pk_hex.clone(),
            k.debrief_sk_hex.clone(),
        ),
    ]
}

/// An `evaluate` run built from a scoring vector.
pub struct Case {
    pub input: Value,
    pub fixtures: Value,
    pub expected: Value,
    /// Every proposal text field, for leak checks on stdout and stderr.
    pub bid_texts: Vec<String>,
}

/// `vector`: e.g. "scoring-3-bids-injection.json".
pub fn case(vector: &str, attempt: u8) -> Case {
    case_from(&spec_json(&format!("test-vectors/{vector}")), attempt)
}

/// One scoring case (a vector file, or one entry of scoring-edge-cases.json). Each plaintext is the
/// JCS of the vector's plaintext (plain JSON when JCS refuses it, as for an integer beyond 2^53: a
/// bidder can send any bytes), ECIES-encrypted to the fake tender key; bids the vector marks as
/// not decryptable get bytes that do not decrypt.
pub fn case_from(v: &Value, attempt: u8) -> Case {
    let rubric = if v["rubric"].is_object() {
        v["rubric"].clone()
    } else {
        spec_json("examples/rubric.example.json")
    };
    let rubric_json = String::from_utf8(jcs(&rubric).unwrap_or_default()).unwrap_or_default();
    let k = keys();
    let tender_pk = unhex(&k.tender_pk_hex);
    let mut bids = Vec::new();
    let mut leaves = Vec::new();
    let mut bid_texts = Vec::new();
    for (i, b) in v["bids"]
        .as_array()
        .cloned()
        .unwrap_or_default()
        .iter()
        .enumerate()
    {
        let ct = if b["decrypt_ok"].as_bool() == Some(true) {
            let plain = jcs(&b["plaintext"])
                .or_else(|_| serde_json::to_vec(&b["plaintext"]))
                .unwrap_or_else(|e| panic!("vector plaintext: {e}"));
            for f in ["methodology", "track_record"] {
                if let Some(t) = b["plaintext"][f].as_str() {
                    bid_texts.push(t.to_string());
                }
            }
            ecies::encrypt(&tender_pk, &plain).unwrap_or_else(|e| panic!("encrypt: {e:?}"))
        } else {
            vec![0x04; 200]
        };
        let bidder = b["submitter"].as_str().unwrap_or_default().to_string();
        let at = 1_762_000_000_000_000_000u64 + i as u64;
        leaves.push(merkle_leaf(&bidder, at, &ct).unwrap_or_else(|| panic!("leaf")));
        bids.push(json!({
            "index": i,
            "bidder": bidder,
            "submitted_at_ns": at.to_string(),
            "ciphertext_b64": STANDARD.encode(&ct),
            "debrief_pubkey": k.debrief_pk_hex,
        }));
    }
    let root = merkle_root(&leaves).unwrap_or_else(|e| panic!("root: {e}"));
    let input = json!({
        "action": "evaluate",
        "contract_id": CONTRACT,
        "tender_id": v["tender_id"],
        "attempt": attempt,
        "rubric_json": rubric_json,
        "bids_root": hex(&root),
        "bids": bids,
        "committee": committee().iter().map(|(a, pk, _)| json!({"account": a, "pubkey": pk})).collect::<Vec<_>>(),
        // What the tender pinned (D-029). The fixture `ExecutionInfo` reports the same hash, so a
        // test can tell "the contract pinned X" apart from "X actually ran".
        "evaluator": {"wasm_sha256": FIXTURE_WASM_SHA256, "source_tag": "evaluator-test"},
    });
    let fixtures = json!({
        "wasm_sha256": FIXTURE_WASM_SHA256,
        "request_id": "offline-request-1",
        "model_outputs": v["model_outputs"],
    });
    Case {
        input,
        fixtures,
        expected: v["expected"].clone(),
        bid_texts,
    }
}

/// Environment from a map.
pub struct MapEnv(pub BTreeMap<String, String>);

impl Environment for MapEnv {
    fn var(&self, name: &str) -> Option<String> {
        self.0.get(name).cloned()
    }
}

/// `NEAR_PREDECESSOR_ID` = the calling contract, master secret = the FAKE vector secret.
pub fn env() -> MapEnv {
    MapEnv(BTreeMap::from([
        (
            crate::env_names::PREDECESSOR_ID.to_string(),
            CONTRACT.to_string(),
        ),
        (
            crate::env_names::MASTER_SECRET.to_string(),
            keys().master_secret_hex,
        ),
        (
            crate::env_names::BLOCK_HEIGHT.to_string(),
            "123456".to_string(),
        ),
    ]))
}

/// Bundle store in memory.
#[derive(Default)]
pub struct MemStore(pub RefCell<BTreeMap<String, Vec<u8>>>);

impl BundleStore for MemStore {
    fn put_if_absent(&self, sha256_hex: &str, body: &[u8]) -> Result<PutOutcome, ServiceError> {
        if hex(&sha256(body)) != sha256_hex {
            return Err(ServiceError("memstore: body does not hash to the name"));
        }
        let mut m = self.0.borrow_mut();
        match m.get(sha256_hex) {
            Some(b) if b == body => Ok(PutOutcome::Exists),
            Some(_) => Ok(PutOutcome::Conflict),
            None => {
                m.insert(sha256_hex.to_string(), body.to_vec());
                Ok(PutOutcome::Created)
            }
        }
    }
}

/// Fixture services plus a memory store.
pub fn services<'a>(fixtures: &'a Fixtures, store: &'a MemStore) -> Services<'a> {
    Services {
        models: fixtures,
        signatures: fixtures,
        attestation: fixtures,
        store,
        execution: fixtures,
    }
}

/// Decrypts an ECIES envelope (base64) with a hex secret key.
pub fn open(ecies_b64: &str, sk_hex: &str) -> Vec<u8> {
    let ct = STANDARD
        .decode(ecies_b64)
        .unwrap_or_else(|e| panic!("envelope base64: {e}"));
    ecies::decrypt(&unhex(sk_hex), &ct).unwrap_or_else(|e| panic!("envelope decrypt: {e:?}"))
}

/// Opens the committee report for member `member` (index into `keys`): ECIES-decrypts the 32-byte
/// key with `sk_hex`, then AES-256-GCM-decrypts the body (nonce = first 12 bytes, tag appended).
pub fn open_report(report: &Value, member: usize, sk_hex: &str) -> Vec<u8> {
    use aes_gcm::aead::Aead;
    use aes_gcm::{Aes256Gcm, KeyInit, Nonce};
    assert_eq!(report["cipher"], crate::report::REPORT_CIPHER);
    let key = open(
        report["keys"][member]["ecies_b64"]
            .as_str()
            .unwrap_or_else(|| panic!("no key envelope for member {member}")),
        sk_hex,
    );
    assert_eq!(key.len(), 32, "the envelope holds only the key");
    let body = STANDARD
        .decode(report["body_b64"].as_str().unwrap_or_default())
        .unwrap_or_else(|e| panic!("report body base64: {e}"));
    let n = crate::report::REPORT_NONCE_BYTES;
    let cipher = Aes256Gcm::new_from_slice(&key).unwrap_or_else(|e| panic!("key: {e}"));
    let nonce = Nonce::try_from(&body[..n]).unwrap_or_else(|e| panic!("nonce: {e}"));
    cipher
        .decrypt(&nonce, &body[n..])
        .unwrap_or_else(|e| panic!("report body decrypt: {e}"))
}
