//! Evaluator run by OutLayer (wasm32-wasip2). Spec: docs/04-evaluator.md, task T05.
//!
//! stdin: the contract's input JSON (`derive_pubkey` or `evaluate`). stdout: exactly one JCS
//! object, the tender key `{"pk","tid","v"}` or the compact result (≤ 900 bytes), or on refusal
//! `{"error","v"}`. stderr: fixed codes and counts only, never a secret, a key, bid text or a
//! model answer. Scoring is `evaluator_core`; this crate does I/O and envelopes around it.

pub mod env_names;
pub mod error;
pub mod input;
/// The real services. WASI only: they are built on `wasi-http`, and a host build has no such
/// thing. `cargo test` therefore exercises the pipeline against fixtures, and the live path is
/// exercised by the wasmtime harness and by the OutLayer run itself.
#[cfg(all(target_family = "wasm", not(feature = "offline")))]
pub mod live;
#[cfg(any(feature = "offline", feature = "testkit", test))]
pub mod offline;
pub mod pipeline;
pub mod prompt;
pub mod report;
pub mod services;
#[cfg(any(feature = "testkit", test))]
pub mod testkit;
#[cfg(test)]
mod tests;

use error::RunError;
use services::{Environment, Services};

/// Runs one request and returns what goes to stdout.
pub fn run(stdin: &[u8], env: &dyn Environment, svc: &Services<'_>) -> Result<Vec<u8>, RunError> {
    match input::parse(stdin)? {
        input::Input::DerivePubkey(i) => pipeline::derive_pubkey(&i, env),
        input::Input::Evaluate(i) => pipeline::evaluate(&i, env, svc),
        input::Input::Quote => Err(RunError::NotImplemented("quote comes with T13")),
        input::Input::PayoutStatus => Err(RunError::NotImplemented("payout_status comes with T13")),
    }
}

/// `{"error":"E_…","v":1}`: what a refusal prints on stdout (the contract records it as a failed
/// attempt).
pub fn error_object(e: &RunError) -> Vec<u8> {
    format!("{{\"error\":\"{}\",\"v\":1}}", e.code()).into_bytes()
}
