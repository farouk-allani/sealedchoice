//! Everything outside the WASM, one trait each, so part 2 (after gates G1 and G3) adds real
//! implementations without touching the pipeline:
//! - `ModelClient`: one NEAR AI Cloud chat call per (eligible bid, model). G3 fixes the request
//!   body, headers and response shape; the implementation builds the request and extracts the
//!   answer text, the pipeline only keeps the exact bytes.
//! - `SignatureSource`: the per-call signature (`GET /v1/signature/{chat_id}`, G3).
//! - `AttestationSource`: the attestation report(s) for this run's nonce (G1/G3 find the path).
//! - `BundleStore`: the content-addressed bundle store; same contract as apps/web's
//!   `BundleBackend.putIfAbsent` (T06, D-021).
//! - `ExecutionInfo`: facts about this OutLayer execution the WASM cannot compute (its own WASM
//!   hash, the request id). G1 finds how OutLayer exposes them.
//!
//! `Unavailable` implements all of them by refusing: the default build has no real service until
//! part 2. The `offline` feature adds fixture-backed implementations for the harness only.

use serde_json::Value;

/// Reads one environment variable (a trait so tests can pass a map).
pub trait Environment {
    fn var(&self, name: &str) -> Option<String>;
}

/// The process environment.
pub struct ProcessEnv;

impl Environment for ProcessEnv {
    fn var(&self, name: &str) -> Option<String> {
        std::env::var(name).ok()
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ServiceError(pub &'static str);

/// One model call to make.
pub struct ModelRequest<'a> {
    pub bid_index: usize,
    pub model_index: usize,
    /// Exact model id from the rubric.
    pub model: &'a str,
    pub system: &'a str,
    pub user: &'a str,
}

/// What a model call produced. `request` and `response` are the exact body bytes (their hashes go
/// in the public bundle, the bytes in the debrief and committee report).
pub struct ModelReply {
    pub chat_id: String,
    /// Tries made (1, or 2 after one retry on transport error / 5xx / 429; scoring-prompt.md).
    pub attempts: u32,
    pub request: Vec<u8>,
    pub response: Vec<u8>,
    /// The model's answer text, or None when the response carried none.
    pub content: Option<String>,
}

pub trait ModelClient {
    fn complete(&self, req: &ModelRequest<'_>) -> Result<ModelReply, ServiceError>;
}

pub trait SignatureSource {
    /// The verbatim signature body for one chat (fields: text, signature, signing_address,
    /// signing_algo, ...).
    fn signature(&self, chat_id: &str, model: &str) -> Result<Value, ServiceError>;
}

pub trait AttestationSource {
    /// Attestation report(s) for `nonce_hex`, covering the models this run uses.
    fn reports(&self, nonce_hex: &str, models: &[String]) -> Result<Vec<Value>, ServiceError>;
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PutOutcome {
    Created,
    /// The same bytes were already stored.
    Exists,
    /// Different bytes are stored under this hash (cannot happen honestly).
    Conflict,
}

pub trait BundleStore {
    fn put_if_absent(&self, sha256_hex: &str, body: &[u8]) -> Result<PutOutcome, ServiceError>;
}

pub trait ExecutionInfo {
    /// sha256 (lowercase hex) of the WASM being executed.
    fn wasm_sha256(&self) -> Result<String, ServiceError>;
    /// OutLayer's id for this execution request.
    fn request_id(&self) -> Result<Value, ServiceError>;
}

/// All services one run uses.
pub struct Services<'a> {
    pub models: &'a dyn ModelClient,
    pub signatures: &'a dyn SignatureSource,
    pub attestation: &'a dyn AttestationSource,
    pub store: &'a dyn BundleStore,
    pub execution: &'a dyn ExecutionInfo,
}

/// The default build until part 2: every external call refuses, so `evaluate` stops with
/// `E_SERVICE` before printing anything. `derive_pubkey` needs none of them.
pub struct Unavailable;

const NOT_YET: ServiceError = ServiceError("not available in this build (part 2, gates G1/G3)");

impl ModelClient for Unavailable {
    fn complete(&self, _: &ModelRequest<'_>) -> Result<ModelReply, ServiceError> {
        Err(NOT_YET)
    }
}
impl SignatureSource for Unavailable {
    fn signature(&self, _: &str, _: &str) -> Result<Value, ServiceError> {
        Err(NOT_YET)
    }
}
impl AttestationSource for Unavailable {
    fn reports(&self, _: &str, _: &[String]) -> Result<Vec<Value>, ServiceError> {
        Err(NOT_YET)
    }
}
impl BundleStore for Unavailable {
    fn put_if_absent(&self, _: &str, _: &[u8]) -> Result<PutOutcome, ServiceError> {
        Err(NOT_YET)
    }
}
impl ExecutionInfo for Unavailable {
    fn wasm_sha256(&self) -> Result<String, ServiceError> {
        Err(NOT_YET)
    }
    fn request_id(&self) -> Result<Value, ServiceError> {
        Err(NOT_YET)
    }
}

impl Unavailable {
    pub fn services() -> Services<'static> {
        static U: Unavailable = Unavailable;
        Services {
            models: &U,
            signatures: &U,
            attestation: &U,
            store: &U,
            execution: &U,
        }
    }
}
