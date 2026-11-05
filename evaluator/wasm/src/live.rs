//! The real services (T05 part 2): NEAR AI Cloud, the attestation endpoint and the bundle store,
//! over `wasi-http` from inside the OutLayer TEE. Every shape here was measured at G3 and T06, not
//! read from a doc page; `docs/references.md` records each measurement.
//!
//! The service traits are synchronous and `wstd`'s HTTP client is async, so each call bridges with
//! `wstd::runtime::block_on`. The pipeline stays sequential on purpose: G3 measured 10 calls plus
//! 10 signature fetches at 8.9 s of a 180 s budget, so there is nothing to win by making the
//! evidence harder to follow.
//!
//! Nothing here prints. Secrets reach exactly one place, the `Authorization` header.

use crate::env_names;
use crate::services::{
    AttestationSource, BundleStore, Environment, ExecutionInfo, ModelClient, ModelFailure,
    ModelReply, ModelRequest, PutOutcome, ServiceError, SignatureSource,
};
use serde_json::{Value, json};
use wstd::http::{Body, BodyExt, Client, Method, Request};
use zeroize::Zeroizing;

/// NEAR AI Cloud, OpenAI-compatible (docs/references.md).
const NEARAI_BASE: &str = "https://cloud-api.near.ai/v1";
/// Per docs/04 §7 and `specs/scoring-prompt.md`.
const MAX_TOKENS: u64 = 900;

/// A response we actually received.
struct HttpResponse {
    status: u16,
    body: Vec<u8>,
}

/// One request. `bearer` is the only place a secret is used, and it is never logged.
fn send(
    method: Method,
    url: &str,
    bearer: Option<&str>,
    body: Option<Vec<u8>>,
) -> Result<HttpResponse, String> {
    wstd::runtime::block_on(async move {
        let mut req = Request::builder().method(method).uri(url);
        if let Some(token) = bearer {
            req = req.header("authorization", format!("Bearer {token}"));
        }
        if body.is_some() {
            req = req.header("content-type", "application/json");
        }
        let req = req
            .body(Body::from(body.unwrap_or_default()))
            .map_err(|e| format!("request: {e}"))?;
        let res = Client::new()
            .send(req)
            .await
            .map_err(|e| format!("send: {e}"))?;
        let status = res.status().as_u16();
        let body = res
            .into_body()
            .into_boxed_body()
            .collect()
            .await
            .map_err(|e| format!("read: {e}"))?
            .to_bytes()
            .to_vec();
        Ok(HttpResponse { status, body })
    })
}

/// 5xx, 429 and "no response at all" are worth one retry; any other status is the server's answer
/// and repeating it would only waste the budget (`specs/scoring-prompt.md`, D-024).
fn worth_retrying(res: &Result<HttpResponse, String>) -> bool {
    match res {
        Err(_) => true,
        Ok(r) => r.status == 429 || (500..600).contains(&r.status),
    }
}

// ---------------------------------------------------------------- models

/// Reads a secret once, keeping the failure instead of raising it. Construction must not fail:
/// `derive_pubkey` calls no service at all, and a tender key must still be derivable on a run
/// where the model key or the bundle store was never configured.
fn secret(env: &dyn Environment, name: &'static str, missing: &'static str) -> SecretSlot {
    match env.var(name) {
        Some(v) if !v.trim().is_empty() => Ok(Zeroizing::new(v.trim().to_string())),
        _ => Err(ServiceError(missing)),
    }
}

type SecretSlot = Result<Zeroizing<String>, ServiceError>;

pub struct NearAi {
    api_key: SecretSlot,
}

impl NearAi {
    pub fn from_env(env: &dyn Environment) -> Self {
        Self {
            api_key: secret(env, env_names::NEARAI_API_KEY, "NEARAI_API_KEY is not set"),
        }
    }

    fn key(&self) -> Result<&str, ServiceError> {
        self.api_key
            .as_ref()
            .map(|k| k.as_str())
            .map_err(Clone::clone)
    }

    /// The exact bytes we send. `reasoning_effort: "none"` is not optional: G3 measured both
    /// TEE-backed models spending the whole `max_tokens` budget on reasoning and returning **empty
    /// content** without it (Qwen3.6: 31 s and `finish_reason: length`).
    fn request_body(&self, req: &ModelRequest<'_>) -> Vec<u8> {
        serde_json::to_vec(&json!({
            "model": req.model,
            "temperature": 0,
            "seed": 1,
            "max_tokens": MAX_TOKENS,
            "reasoning_effort": "none",
            "response_format": {"type": "json_object"},
            "messages": [
                {"role": "system", "content": req.system},
                {"role": "user", "content": req.user},
            ],
        }))
        .unwrap_or_default()
    }
}

impl ModelClient for NearAi {
    /// `POST /v1/check_api_key`, **not** a model listing: G3 measured `GET /v1/models` answering
    /// 200 with no key at all and with a bogus one, so a listing cannot tell "our key is broken"
    /// from "this bid's call failed" (D-024). This endpoint answers 200 `{"valid":true,…}`, 401
    /// for a bad or missing key and 402 when the account has no credit, and costs no tokens.
    fn preflight(&self) -> Result<(), ModelFailure> {
        let key = self.key().map_err(|e| ModelFailure {
            attempts: 0,
            request: Vec::new(),
            response: Vec::new(),
            http_status: None,
            reason: e.0,
        })?;
        let url = format!("{NEARAI_BASE}/check_api_key");
        let body = b"{}".to_vec();
        let mut attempts = 0;
        let mut last = send(Method::POST, &url, Some(key), Some(body.clone()));
        attempts += 1;
        if worth_retrying(&last) {
            last = send(Method::POST, &url, Some(key), Some(body.clone()));
            attempts += 1;
        }
        match last {
            Ok(r) if (200..300).contains(&r.status) => Ok(()),
            Ok(r) => Err(ModelFailure {
                attempts,
                request: body,
                response: r.body,
                http_status: Some(r.status),
                reason: "key check refused",
            }),
            Err(_) => Err(ModelFailure {
                attempts,
                request: body,
                response: Vec::new(),
                http_status: None,
                reason: "key check unreachable",
            }),
        }
    }

    fn complete(&self, req: &ModelRequest<'_>) -> Result<ModelReply, ModelFailure> {
        let body = self.request_body(req);
        let key = self.key().map_err(|e| ModelFailure {
            attempts: 0,
            request: body.clone(),
            response: Vec::new(),
            http_status: None,
            reason: e.0,
        })?;
        let url = format!("{NEARAI_BASE}/chat/completions");
        let mut attempts = 0;
        let mut last = send(Method::POST, &url, Some(key), Some(body.clone()));
        attempts += 1;
        if worth_retrying(&last) {
            last = send(Method::POST, &url, Some(key), Some(body.clone()));
            attempts += 1;
        }

        let res = match last {
            Ok(r) => r,
            Err(_) => {
                return Err(ModelFailure {
                    attempts,
                    request: body,
                    response: Vec::new(),
                    http_status: None,
                    reason: "model unreachable",
                });
            }
        };
        // Ok only for 2xx, whatever the body: the pipeline's outage rule depends on it (D-024).
        if !(200..300).contains(&res.status) {
            return Err(ModelFailure {
                attempts,
                request: body,
                response: res.body,
                http_status: Some(res.status),
                reason: "model refused the request",
            });
        }
        // A 2xx whose body is not the shape we expect is still an answer, not an outage: the
        // pipeline records it as an invalid output and the bid keeps its other models.
        let parsed: Value = serde_json::from_slice(&res.body).unwrap_or(Value::Null);
        let chat_id = parsed
            .get("id")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        let content = parsed
            .pointer("/choices/0/message/content")
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty())
            .map(str::to_string);
        Ok(ModelReply {
            chat_id,
            attempts,
            request: body,
            response: res.body,
            content,
        })
    }
}

// ------------------------------------------------------------ signatures

pub struct NearAiSignatures {
    api_key: SecretSlot,
}

impl NearAiSignatures {
    pub fn from_env(env: &dyn Environment) -> Self {
        Self {
            api_key: secret(env, env_names::NEARAI_API_KEY, "NEARAI_API_KEY is not set"),
        }
    }
}

impl SignatureSource for NearAiSignatures {
    /// G3: `?signing_algo=ecdsa` alone is enough, the `model` parameter is not required. The body
    /// is stored verbatim in the bundle, so nothing is reshaped here.
    fn signature(&self, chat_id: &str, _model: &str) -> Result<Value, ServiceError> {
        if chat_id.is_empty() {
            return Err(ServiceError("no chat id to fetch a signature for"));
        }
        // The chat id is whatever the model response carried, so it is upstream-chosen text in a
        // path we send a bearer token to. Percent-encoding keeps it one path segment: without it
        // an id like `../check_api_key` re-points this GET at another endpoint and puts that
        // answer, verbatim, into a public bundle.
        let key = self.api_key.as_ref().map_err(Clone::clone)?;
        let url = format!(
            "{NEARAI_BASE}/signature/{}?signing_algo=ecdsa",
            urlencode(chat_id)
        );
        let mut last = send(Method::GET, &url, Some(key), None);
        if worth_retrying(&last) {
            last = send(Method::GET, &url, Some(key), None);
        }
        match last {
            Ok(r) if (200..300).contains(&r.status) => {
                serde_json::from_slice(&r.body).map_err(|_| ServiceError("signature is not JSON"))
            }
            Ok(_) => Err(ServiceError("signature refused")),
            Err(_) => Err(ServiceError("signature unreachable")),
        }
    }
}

// ----------------------------------------------------------- attestation

pub struct NearAiAttestation {
    api_key: SecretSlot,
}

impl NearAiAttestation {
    pub fn from_env(env: &dyn Environment) -> Self {
        Self {
            api_key: secret(env, env_names::NEARAI_API_KEY, "NEARAI_API_KEY is not set"),
        }
    }

    fn fetch(&self, query: &str) -> Option<Value> {
        let key = self.api_key.as_ref().ok()?;
        let url = format!("{NEARAI_BASE}/attestation/report?{query}");
        let mut last = send(Method::GET, &url, Some(key), None);
        if worth_retrying(&last) {
            last = send(Method::GET, &url, Some(key), None);
        }
        match last {
            Ok(r) if (200..300).contains(&r.status) => serde_json::from_slice(&r.body).ok(),
            _ => None,
        }
    }
}

impl AttestationSource for NearAiAttestation {
    /// Two kinds of report, both bound to our nonce (G3: `report_data` is
    /// `signing_address(32) || nonce(32)`, so a fresh nonce ties the quote to this run).
    ///
    /// - `?nonce=…` alone returns the **gateway's** quote, which every run gets.
    /// - `?nonce=…&model=<id>` returns the **provider's** quote, and only for a model that runs in
    ///   a TEE. G3 measured it answering for the two models D-028 picks and 503-ing for every
    ///   `gateway`-signed one, so a missing per-model report is information, not a failure: it is
    ///   recorded as such and the run continues, because the signature's `signature_kind` is what
    ///   actually proves where a response was signed.
    fn reports(&self, nonce_hex: &str, models: &[String]) -> Result<Vec<Value>, ServiceError> {
        let mut reports = Vec::with_capacity(models.len() + 1);
        if let Some(gateway) = self.fetch(&format!("nonce={nonce_hex}")) {
            reports.push(json!({"scope": "gateway", "report": gateway}));
        }
        for model in models {
            let query = format!("nonce={nonce_hex}&model={}", urlencode(model));
            match self.fetch(&query) {
                Some(r) => reports.push(json!({"scope": "model", "model": model, "report": r})),
                None => reports.push(json!({
                    "scope": "model",
                    "model": model,
                    "report": Value::Null,
                    "note": "no provider attestation for this model",
                })),
            }
        }
        if reports.iter().all(|r| r["report"].is_null()) {
            return Err(ServiceError("no attestation report could be fetched"));
        }
        Ok(reports)
    }
}

/// Percent-encodes what a model id can contain: `/` and the characters a query string treats
/// specially. Model ids are rubric-supplied, so this must not assume they are tame.
fn urlencode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char);
            }
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

// ---------------------------------------------------------- bundle store

pub struct HttpBundleStore {
    base: Result<String, ServiceError>,
    token: SecretSlot,
}

impl HttpBundleStore {
    pub fn from_env(env: &dyn Environment) -> Self {
        Self {
            base: match env.var(env_names::BUNDLE_STORE_URL) {
                // https only: `put_if_absent` sends BUNDLE_STORE_TOKEN as a bearer, and an
                // `http://` row would put it on the wire in cleartext.
                Some(u) if u.trim().starts_with("https://") => {
                    Ok(u.trim().trim_end_matches('/').to_string())
                }
                Some(u) if !u.trim().is_empty() => {
                    Err(ServiceError("BUNDLE_STORE_URL is not https"))
                }
                _ => Err(ServiceError("BUNDLE_STORE_URL is not set")),
            },
            token: secret(
                env,
                env_names::BUNDLE_STORE_TOKEN,
                "BUNDLE_STORE_TOKEN is not set",
            ),
        }
    }
}

impl BundleStore for HttpBundleStore {
    /// `PUT /api/bundles/<sha256>` (T06, verified against the deployment 2026-11-05): 201 stored,
    /// 200 the same bytes were already there, 409 different bytes under that hash. One retry, then
    /// the run fails: T05 step 8 forbids a result without a stored bundle.
    fn put_if_absent(&self, sha256_hex: &str, body: &[u8]) -> Result<PutOutcome, ServiceError> {
        let base = self.base.as_ref().map_err(Clone::clone)?;
        let token = self.token.as_ref().map_err(Clone::clone)?;
        let url = format!("{base}/api/bundles/{sha256_hex}");
        let mut last = send(Method::PUT, &url, Some(token), Some(body.to_vec()));
        if worth_retrying(&last) {
            last = send(Method::PUT, &url, Some(token), Some(body.to_vec()));
        }
        match last {
            Ok(r) if r.status == 201 => Ok(PutOutcome::Created),
            Ok(r) if r.status == 200 => Ok(PutOutcome::Exists),
            Ok(r) if r.status == 409 => Ok(PutOutcome::Conflict),
            Ok(r) if r.status == 401 => Err(ServiceError("bundle store refused the token")),
            Ok(r) if r.status == 413 => Err(ServiceError("bundle is larger than the store allows")),
            Ok(_) => Err(ServiceError("bundle store refused the upload")),
            Err(_) => Err(ServiceError("bundle store unreachable")),
        }
    }
}

// --------------------------------------------------------------- run facts

pub struct OutLayerExecution {
    request_id: Result<Value, ServiceError>,
}

impl OutLayerExecution {
    /// `NEAR_REQUEST_ID` is OutLayer's id for this execution (G1). It is a decimal string in the
    /// environment; the bundle schema accepts a string or an integer, and an integer is what the
    /// attestation endpoints take, so it is normalised here.
    pub fn from_env(env: &dyn Environment) -> Self {
        let request_id = match env.var(env_names::REQUEST_ID) {
            Some(raw) if !raw.trim().is_empty() => {
                let raw = raw.trim().to_string();
                Ok(raw
                    .parse::<u64>()
                    .map_or_else(|_| Value::String(raw.clone()), |n| json!(n)))
            }
            _ => Err(ServiceError("NEAR_REQUEST_ID is not set")),
        };
        Self { request_id }
    }
}

impl ExecutionInfo for OutLayerExecution {
    fn request_id(&self) -> Result<Value, ServiceError> {
        self.request_id.clone()
    }
}

/// Everything a real run needs, read from the environment OutLayer provides.
pub struct Live {
    pub models: NearAi,
    pub signatures: NearAiSignatures,
    pub attestation: NearAiAttestation,
    pub store: HttpBundleStore,
    pub execution: OutLayerExecution,
}

impl Live {
    /// Never fails. Each service keeps its own missing-secret error and raises it when it is used,
    /// so `derive_pubkey` - which calls no service - still answers on a run configured with
    /// nothing but the master secret.
    pub fn from_env(env: &dyn Environment) -> Self {
        Self {
            models: NearAi::from_env(env),
            signatures: NearAiSignatures::from_env(env),
            attestation: NearAiAttestation::from_env(env),
            store: HttpBundleStore::from_env(env),
            execution: OutLayerExecution::from_env(env),
        }
    }

    pub fn services(&self) -> crate::services::Services<'_> {
        crate::services::Services {
            models: &self.models,
            signatures: &self.signatures,
            attestation: &self.attestation,
            store: &self.store,
            execution: &self.execution,
        }
    }
}
