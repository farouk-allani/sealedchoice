//! Offline harness (T05 step 5): the evaluator WASM, built for wasm32-wasip2, run under wasmtime
//! with the FAKE master secret of specs/test-vectors/hashes-and-keys.json and fixture model outputs.
//!
//! - `evaluate` (offline build): reproduces scoring-3-bids-injection.json through decrypt → score →
//!   envelopes → bundle → compact result; stdout carries only the compact result; neither stdout nor
//!   stderr holds bid text or the secret; the stored bundle validates against
//!   evidence-bundle.schema.json; every debrief and the committee report decrypt with the test reader
//!   keys and validate against debrief.schema.json.
//! - `derive_pubkey` (release build, no fixtures compiled in): matches the vector, two runs agree, a
//!   different tender id gives a different key.
//!
//! The two WASMs are built by this test into target/harness-wasm-{offline,release}, separate target
//! directories so the nested cargo does not wait on the lock held by `cargo test`.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use base64::Engine as _;
use base64::engine::general_purpose::STANDARD;
use evaluator_core::merkle::{hex, sha256};
use evaluator_wasm::env_names;
use evaluator_wasm::testkit::{self, CONTRACT};
use serde_json::{Value, json};
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use wasmtime::component::{Component, Linker, ResourceTable};
use wasmtime::{Engine, Store};
use wasmtime_wasi::p2::bindings::sync::Command;
use wasmtime_wasi::p2::pipe::{MemoryInputPipe, MemoryOutputPipe};
use wasmtime_wasi::{FsPerms, WasiCtx, WasiCtxView, WasiView};

fn workspace() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

/// Builds evaluator-wasm for wasm32-wasip2 (release profile) with the given features.
fn build(features: &[&str], dir: &str) -> PathBuf {
    let target = workspace().join("target").join(dir);
    let mut cmd = std::process::Command::new(env!("CARGO"));
    cmd.args([
        "build",
        "-p",
        "evaluator-wasm",
        "--target",
        "wasm32-wasip2",
        "--release",
    ])
    .current_dir(workspace())
    .env("CARGO_TARGET_DIR", &target);
    if !features.is_empty() {
        cmd.args(["--features", &features.join(",")]);
    }
    let status = cmd.status().expect("run cargo build for the WASM");
    assert!(status.success(), "WASM build failed ({features:?})");
    target.join("wasm32-wasip2/release/evaluator-wasm.wasm")
}

fn offline_wasm() -> &'static PathBuf {
    static P: OnceLock<PathBuf> = OnceLock::new();
    P.get_or_init(|| build(&["offline"], "harness-wasm-offline"))
}

fn release_wasm() -> &'static PathBuf {
    static P: OnceLock<PathBuf> = OnceLock::new();
    P.get_or_init(|| build(&[], "harness-wasm-release"))
}

struct State {
    ctx: WasiCtx,
    table: ResourceTable,
}

impl WasiView for State {
    fn ctx(&mut self) -> WasiCtxView<'_> {
        WasiCtxView {
            ctx: &mut self.ctx,
            table: &mut self.table,
        }
    }
}

struct Run {
    ok: bool,
    stdout: Vec<u8>,
    stderr: Vec<u8>,
}

/// One execution: stdin, environment and preopened directories (host path, guest path, writable).
fn run_wasm(
    wasm: &Path,
    stdin: &[u8],
    env: &[(&str, String)],
    dirs: &[(&Path, &str, bool)],
) -> Run {
    let engine = Engine::default();
    let component = Component::from_file(&engine, wasm).unwrap();
    let mut linker = Linker::<State>::new(&engine);
    wasmtime_wasi::p2::add_to_linker_sync(&mut linker).unwrap();
    let stdout = MemoryOutputPipe::new(1 << 20);
    let stderr = MemoryOutputPipe::new(1 << 20);
    let mut b = WasiCtx::builder();
    b.stdin(MemoryInputPipe::new(stdin.to_vec()))
        .stdout(stdout.clone())
        .stderr(stderr.clone());
    for (k, v) in env {
        b.env(k, v);
    }
    for (host, guest, writable) in dirs {
        let perms = if *writable {
            FsPerms::ReadWrite
        } else {
            FsPerms::ReadOnly
        };
        b.preopened_dir(host, guest, perms).unwrap();
    }
    let mut store = Store::new(
        &engine,
        State {
            ctx: b.build(),
            table: ResourceTable::new(),
        },
    );
    let command = Command::instantiate(&mut store, &component, &linker).unwrap();
    let ok = command.wasi_cli_run().call_run(&mut store).unwrap().is_ok();
    drop(store);
    Run {
        ok,
        stdout: stdout.contents().to_vec(),
        stderr: stderr.contents().to_vec(),
    }
}

fn base_env() -> Vec<(&'static str, String)> {
    vec![
        (env_names::SENDER_ID, CONTRACT.to_string()),
        (env_names::MASTER_SECRET, testkit::keys().master_secret_hex),
        (env_names::BLOCK_HEIGHT, "123456".to_string()),
    ]
}

fn scratch(name: &str) -> PathBuf {
    let d = workspace()
        .join("target/harness-run")
        .join(format!("{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(d.join("fixtures")).unwrap();
    std::fs::create_dir_all(d.join("store")).unwrap();
    d
}

fn validator(schema: &str) -> jsonschema::Validator {
    let s = testkit::spec_json(&format!("schemas/{schema}"));
    jsonschema::validator_for(&s).unwrap()
}

/// debrief.schema.json `$defs/committee_report`, with `$ref: "#"` resolving to the debrief.
fn committee_report_validator() -> jsonschema::Validator {
    let debrief = testkit::spec_json("schemas/debrief.schema.json");
    let id = debrief["$id"].as_str().unwrap().to_string();
    let registry = jsonschema::Registry::new()
        .add(&id, &debrief)
        .unwrap()
        .prepare()
        .unwrap();
    jsonschema::options()
        .with_registry(&registry)
        .build(&json!({"$ref": format!("{id}#/$defs/committee_report")}))
        .unwrap()
}

fn assert_valid(v: &jsonschema::Validator, instance: &Value, what: &str) {
    let errors: Vec<String> = v.iter_errors(instance).map(|e| e.to_string()).collect();
    assert!(errors.is_empty(), "{what} does not validate: {errors:?}");
}

#[test]
fn evaluate_reproduces_the_three_bid_injection_vector_through_the_wasm() {
    let case = testkit::case("scoring-3-bids-injection.json", 1);
    let dir = scratch("evaluate");
    std::fs::write(
        dir.join("fixtures/fixtures.json"),
        case.fixtures.to_string(),
    )
    .unwrap();
    let mut env = base_env();
    env.push((
        env_names::OFFLINE_FIXTURES,
        "/fixtures/fixtures.json".into(),
    ));
    env.push((env_names::OFFLINE_BUNDLE_DIR, "/store".into()));
    let fixtures_dir = dir.join("fixtures");
    let store_dir = dir.join("store");
    let r = run_wasm(
        offline_wasm(),
        case.input.to_string().as_bytes(),
        &env,
        &[
            (&fixtures_dir, "/fixtures", false),
            (&store_dir, "/store", true),
        ],
    );
    let stderr = String::from_utf8_lossy(&r.stderr).to_string();
    assert!(r.ok, "the WASM failed: {stderr}");

    // stdout: exactly the compact result, nothing else.
    let compact: Value = serde_json::from_slice(&r.stdout).expect("stdout is one JSON object");
    assert_eq!(
        r.stdout,
        evaluator_core::jcs(&compact).unwrap(),
        "stdout is exactly its JCS"
    );
    assert!(r.stdout.len() <= evaluator_core::COMPACT_RESULT_MAX_BYTES);
    assert_eq!(
        compact["rk"], case.expected["ranking"],
        "totals and flags of the vector"
    );
    assert_eq!(
        compact["rk"],
        json!([[0, 7466, 0], [1, 5955, 0], [2, 5700, 24]])
    );
    assert_eq!(compact["status"], "ok");
    assert_eq!(compact["tid"], "1");
    assert_eq!(compact["attempt"], 1);
    assert_eq!(compact["root"], case.input["bids_root"]);

    // Neither stream carries bid text, the secret or the tender key.
    let k = testkit::keys();
    let both = format!("{}\n{stderr}", String::from_utf8_lossy(&r.stdout));
    for t in &case.bid_texts {
        for piece in t
            .split(['.', '\n'])
            .map(str::trim)
            .filter(|p| p.len() >= 12)
        {
            assert!(!both.contains(piece), "bid text leaked: {piece:?}");
        }
    }
    for secret in [
        &k.master_secret_hex,
        &k.tender_sk_hex,
        &k.debrief_sk_hex,
        &k.committee_sk_hex,
    ] {
        assert!(!both.contains(secret.as_str()), "a secret leaked");
    }
    assert!(
        stderr.contains("3 bids, 3 eligible, 9 model calls"),
        "{stderr}"
    );

    // The stored bundle: named by its hash, the one in the compact result, schema-valid.
    let name = format!("{}.json", compact["bundle"].as_str().unwrap());
    let files: Vec<String> = std::fs::read_dir(&store_dir)
        .unwrap()
        .map(|e| e.unwrap().file_name().to_string_lossy().to_string())
        .collect();
    assert_eq!(files, vec![name.clone()]);
    let bytes = std::fs::read(store_dir.join(&name)).unwrap();
    assert_eq!(format!("{}.json", hex(&sha256(&bytes))), name);
    let bundle: Value = serde_json::from_slice(&bytes).unwrap();
    assert_valid(&validator("evidence-bundle.schema.json"), &bundle, "bundle");
    let mut result = compact.clone();
    result.as_object_mut().unwrap().remove("bundle");
    assert_eq!(bundle["result"], result);
    let public = String::from_utf8_lossy(&bytes).to_string();
    let prices: Vec<String> =
        testkit::spec_json("test-vectors/scoring-3-bids-injection.json")["bids"]
            .as_array()
            .unwrap()
            .iter()
            .map(|b| b["plaintext"]["price_minor"].as_str().unwrap().to_string())
            .collect();
    for p in &prices {
        assert!(
            !public.contains(p.as_str()),
            "no price in the public bundle"
        );
    }
    eprintln!("bundle: {} bytes", bytes.len());

    // Debriefs: decrypt with the bidder's reader key, schema-valid, scores of the vector.
    let debrief_schema = validator("debrief.schema.json");
    let expected = case.expected["bids"].as_array().unwrap();
    for d in bundle["debriefs"].as_array().unwrap() {
        let plain = testkit::open(d["ecies_b64"].as_str().unwrap(), &k.debrief_sk_hex);
        assert_eq!(hex(&sha256(&plain)), d["plaintext_sha256"]);
        let debrief: Value = serde_json::from_slice(&plain).unwrap();
        assert_valid(&debrief_schema, &debrief, "debrief");
        let i = debrief["bid_index"].as_u64().unwrap() as usize;
        assert_eq!(debrief["criteria"], expected[i]["criteria"]);
        assert_eq!(debrief["total_bp"], expected[i]["total_bp"]);
        assert_eq!(debrief["flags"], expected[i]["flags"]);
        assert_eq!(debrief["rank"], json!(i + 1));
        // Its raw calls are the ones the public bundle hashes.
        for raw in debrief["raw_calls"].as_array().unwrap() {
            let req = STANDARD
                .decode(raw["request_b64"].as_str().unwrap())
                .unwrap();
            let call = bundle["model_calls"]
                .as_array()
                .unwrap()
                .iter()
                .find(|c| c["chat_id"] == raw["chat_id"])
                .unwrap();
            assert_eq!(call["request_sha256"], hex(&sha256(&req)));
            let req = String::from_utf8_lossy(&req);
            assert!(!req.contains("price_minor"), "no price field in a prompt");
            for p in &prices {
                assert!(!req.contains(p.as_str()), "no price in a prompt");
            }
        }
    }

    // Committee report: one body, one key envelope per member; each member's key opens the body,
    // whose plaintext validates against debrief.schema.json $defs/committee_report (every bid entry
    // has the debrief shape) and carries the decrypted proposals.
    let members = testkit::committee();
    let report_env = &bundle["committee_report"];
    assert_eq!(report_env["cipher"], "aes-256-gcm");
    assert_eq!(report_env["keys"].as_array().unwrap().len(), members.len());
    let report_schema = committee_report_validator();
    assert!(
        !report_schema.is_valid(&json!({"v": 1, "bids": [{"v": 1}]})),
        "the report schema is loaded"
    );
    let mut opened = Vec::new();
    for (i, (account, _, sk)) in members.iter().enumerate() {
        assert_eq!(report_env["keys"][i]["member"], account.as_str());
        let plain = testkit::open_report(report_env, i, sk);
        assert_eq!(hex(&sha256(&plain)), report_env["plaintext_sha256"]);
        let report: Value = serde_json::from_slice(&plain).unwrap();
        assert_valid(&report_schema, &report, "committee report");
        assert_eq!(report["rk"], compact["rk"]);
        for b in report["bids"].as_array().unwrap() {
            assert_valid(&debrief_schema, b, "committee report entry");
            let proposal = STANDARD
                .decode(b["proposal_b64"].as_str().unwrap())
                .unwrap();
            let p: Value = serde_json::from_slice(&proposal).unwrap();
            assert_eq!(
                p["bidder"],
                case.input["bids"][b["bid_index"].as_u64().unwrap() as usize]["bidder"]
            );
        }
        opened.push(plain);
    }
    assert!(
        opened.windows(2).all(|w| w[0] == w[1]),
        "every member reads the same report"
    );
}

#[test]
fn evaluate_refuses_a_wrong_sender_with_an_error_object() {
    let case = testkit::case("scoring-2-bids.json", 1);
    let dir = scratch("refuse");
    std::fs::write(
        dir.join("fixtures/fixtures.json"),
        case.fixtures.to_string(),
    )
    .unwrap();
    let mut env = base_env();
    env[0].1 = "someone-else.testnet".into();
    env.push((
        env_names::OFFLINE_FIXTURES,
        "/fixtures/fixtures.json".into(),
    ));
    env.push((env_names::OFFLINE_BUNDLE_DIR, "/store".into()));
    let fixtures_dir = dir.join("fixtures");
    let store_dir = dir.join("store");
    let r = run_wasm(
        offline_wasm(),
        case.input.to_string().as_bytes(),
        &env,
        &[
            (&fixtures_dir, "/fixtures", false),
            (&store_dir, "/store", true),
        ],
    );
    assert!(!r.ok);
    assert_eq!(r.stdout, br#"{"error":"E_SENDER","v":1}"#);
    assert_eq!(
        std::fs::read_dir(&store_dir).unwrap().count(),
        0,
        "nothing stored"
    );
}

#[test]
fn derive_pubkey_through_the_release_wasm() {
    let k = testkit::keys();
    let input = |tid: &str| {
        json!({"action": "derive_pubkey", "contract_id": CONTRACT, "tender_id": tid}).to_string()
    };
    let a = run_wasm(release_wasm(), input("1").as_bytes(), &base_env(), &[]);
    let b = run_wasm(release_wasm(), input("1").as_bytes(), &base_env(), &[]);
    let c = run_wasm(release_wasm(), input("2").as_bytes(), &base_env(), &[]);
    assert!(a.ok && b.ok && c.ok);
    assert_eq!(
        String::from_utf8(a.stdout.clone()).unwrap(),
        format!("{{\"pk\":\"{}\",\"tid\":\"1\",\"v\":1}}", k.tender_pk_hex),
        "matches hashes-and-keys.json"
    );
    assert_eq!(a.stdout, b.stdout, "two runs agree");
    assert_ne!(a.stdout, c.stdout, "another tender id, another key");
    for r in [&a, &b, &c] {
        let all = format!(
            "{}{}",
            String::from_utf8_lossy(&r.stdout),
            String::from_utf8_lossy(&r.stderr)
        );
        assert!(!all.contains(&k.master_secret_hex) && !all.contains(&k.tender_sk_hex));
    }

    // The release build has no fixtures: evaluate stops before printing a result.
    let case = testkit::case("scoring-2-bids.json", 1);
    let r = run_wasm(
        release_wasm(),
        case.input.to_string().as_bytes(),
        &base_env(),
        &[],
    );
    assert!(!r.ok);
    assert_eq!(r.stdout, br#"{"error":"E_SERVICE","v":1}"#);
}

#[test]
fn a_reader_key_off_the_curve_does_not_stop_the_wasm() {
    let mut case = testkit::case("scoring-3-bids-injection.json", 1);
    let off_curve = format!("02{}", "00".repeat(32));
    case.input["bids"][2]["debrief_pubkey"] = json!(off_curve);
    case.input["committee"][0]["pubkey"] = json!(off_curve);
    let dir = scratch("reader-key");
    std::fs::write(
        dir.join("fixtures/fixtures.json"),
        case.fixtures.to_string(),
    )
    .unwrap();
    let mut env = base_env();
    env.push((
        env_names::OFFLINE_FIXTURES,
        "/fixtures/fixtures.json".into(),
    ));
    env.push((env_names::OFFLINE_BUNDLE_DIR, "/store".into()));
    let fixtures_dir = dir.join("fixtures");
    let store_dir = dir.join("store");
    let r = run_wasm(
        offline_wasm(),
        case.input.to_string().as_bytes(),
        &env,
        &[
            (&fixtures_dir, "/fixtures", false),
            (&store_dir, "/store", true),
        ],
    );
    assert!(r.ok, "{}", String::from_utf8_lossy(&r.stderr));
    let compact: Value = serde_json::from_slice(&r.stdout).unwrap();
    assert_eq!(compact["rk"], case.expected["ranking"]);
    let name = format!("{}.json", compact["bundle"].as_str().unwrap());
    let bundle: Value =
        serde_json::from_slice(&std::fs::read(store_dir.join(name)).unwrap()).unwrap();
    assert_valid(&validator("evidence-bundle.schema.json"), &bundle, "bundle");
    assert_eq!(bundle["debriefs"][2]["error"], "E_READER_KEY");
    assert_eq!(
        bundle["committee_report"]["keys"][0]["error"],
        "E_READER_KEY"
    );
}
