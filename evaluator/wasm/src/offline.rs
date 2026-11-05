//! Offline build only (feature `offline`): fixture-backed services for the harness
//! (evaluator/harness). Never in a release build: the release WASM is built without the feature, so
//! its hash (the one the contract pins and the secrets are bound to) contains none of this code.
//!
//! The fixture file (path in `EVALUATOR_FIXTURES`):
//! `{"request_id": string|int, "model_outputs": {"<bid index>": [output|null per
//! model]}}`. A `null` output is a failed call. Request and response bytes are fixture JSON, not
//! NEAR AI's format (G3 fixes that); signatures and attestation reports are marked as fixtures.

use crate::env_names;
use crate::services::{
    AttestationSource, BundleStore, Environment, ExecutionInfo, ModelClient, ModelFailure,
    ModelReply, ModelRequest, PutOutcome, ServiceError, SignatureSource,
};
use evaluator_core::merkle::{hex, sha256};
use serde_json::{Value, json};
use std::collections::BTreeMap;
use std::io::Write;
use std::path::PathBuf;

pub struct Fixtures {
    request_id: Value,
    model_outputs: BTreeMap<String, Vec<Value>>,
}

impl Fixtures {
    pub fn load(env: &dyn Environment) -> Result<Self, ServiceError> {
        let path = env
            .var(env_names::OFFLINE_FIXTURES)
            .ok_or(ServiceError("offline: EVALUATOR_FIXTURES not set"))?;
        let text = std::fs::read_to_string(path)
            .map_err(|_| ServiceError("offline: fixture file unreadable"))?;
        let v: Value =
            serde_json::from_str(&text).map_err(|_| ServiceError("offline: fixtures not JSON"))?;
        Self::from_value(&v)
    }

    pub fn from_value(v: &Value) -> Result<Self, ServiceError> {
        let model_outputs = serde_json::from_value(v["model_outputs"].clone())
            .map_err(|_| ServiceError("offline: model_outputs"))?;
        Ok(Fixtures {
            request_id: v["request_id"].clone(),
            model_outputs,
        })
    }
}

impl ModelClient for Fixtures {
    /// The fixtures answer every call, so the key check passes.
    fn preflight(&self) -> Result<(), ModelFailure> {
        Ok(())
    }
    fn complete(&self, req: &ModelRequest<'_>) -> Result<ModelReply, ModelFailure> {
        let request = serde_json::to_vec(&json!({
            "fixture": true,
            "model": req.model,
            "messages": [
                {"role": "system", "content": req.system},
                {"role": "user", "content": req.user},
            ],
        }))
        .unwrap_or_default();
        let Some(output) = self
            .model_outputs
            .get(&req.bid_index.to_string())
            .and_then(|v| v.get(req.model_index))
            .filter(|o| !o.is_null())
        else {
            // A null fixture is a call that failed twice (one retry, scoring-prompt.md).
            return Err(ModelFailure {
                attempts: 2,
                request,
                response: br#"{"fixture":true,"error":"unavailable"}"#.to_vec(),
                http_status: Some(503),
                reason: "offline: the fixture has no answer for this call",
            });
        };
        let chat_id = format!("offline-{}-{}", req.bid_index, req.model_index);
        let content = output.to_string();
        let response =
            serde_json::to_vec(&json!({"fixture": true, "id": chat_id, "content": content}))
                .unwrap_or_default();
        Ok(ModelReply {
            chat_id,
            attempts: 1,
            request,
            response,
            content: Some(content),
        })
    }
}

impl SignatureSource for Fixtures {
    fn signature(&self, chat_id: &str, model: &str) -> Result<Value, ServiceError> {
        Ok(json!({
            "text": format!("{model}:{chat_id}"),
            "signature": "offline-fixture",
            "signing_address": "offline-fixture",
            "signing_algo": "offline-fixture",
            "signature_kind": "offline-fixture",
        }))
    }
}

impl AttestationSource for Fixtures {
    fn reports(&self, nonce_hex: &str, models: &[String]) -> Result<Vec<Value>, ServiceError> {
        Ok(vec![
            json!({"kind": "offline-fixture", "nonce": nonce_hex, "models": models}),
        ])
    }
}

impl ExecutionInfo for Fixtures {
    fn request_id(&self) -> Result<Value, ServiceError> {
        Ok(self.request_id.clone())
    }
}

/// `<dir>/<sha256>.json`, write-once: the layout of apps/web's local driver (T06), so the web
/// route with `BUNDLE_STORE_BACKEND=local` and `BUNDLE_STORE_DIR=<dir>` serves what the harness
/// stored.
pub struct LocalStore {
    dir: PathBuf,
}

impl LocalStore {
    pub fn from_env(env: &dyn Environment) -> Result<Self, ServiceError> {
        let dir = env
            .var(env_names::OFFLINE_BUNDLE_DIR)
            .ok_or(ServiceError("offline: BUNDLE_STORE_DIR not set"))?;
        Ok(LocalStore { dir: dir.into() })
    }
}

impl BundleStore for LocalStore {
    fn put_if_absent(&self, sha256_hex: &str, body: &[u8]) -> Result<PutOutcome, ServiceError> {
        if hex(&sha256(body)) != sha256_hex {
            return Err(ServiceError("offline: body does not hash to the name"));
        }
        let path = self.dir.join(format!("{sha256_hex}.json"));
        match std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
        {
            Ok(mut f) => {
                f.write_all(body)
                    .map_err(|_| ServiceError("offline: write failed"))?;
                Ok(PutOutcome::Created)
            }
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
                let existing =
                    std::fs::read(&path).map_err(|_| ServiceError("offline: read failed"))?;
                Ok(if existing == body {
                    PutOutcome::Exists
                } else {
                    PutOutcome::Conflict
                })
            }
            Err(_) => Err(ServiceError("offline: open failed")),
        }
    }
}
