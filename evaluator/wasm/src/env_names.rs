//! Every environment variable the evaluator reads, in one place. OutLayer delivers secrets and
//! execution facts as environment variables. Every name here was measured on testnet at gates G1
//! and G3 (docs/references.md); none is provisional any more. Changing one is a one-line change.

/// The **calling contract**: the account that called `request_execution`, which must equal the
/// input's `contract_id` (docs/05-crypto-and-keys.md). Measured at G1 (request 6845): OutLayer
/// puts the transaction **signer** in `NEAR_SENDER_ID` — the buyer who calls
/// `close_and_evaluate` — and the calling contract in `NEAR_PREDECESSOR_ID`. Checking the signer
/// would refuse every honest run and admit only a transaction signed by the contract account
/// itself, which is the full-access-key case in docs/07-threat-model.md.
pub const PREDECESSOR_ID: &str = "NEAR_PREDECESSOR_ID";

/// Block height of the request (docs/references.md lists it). Optional in the bundle.
pub const BLOCK_HEIGHT: &str = "NEAR_BLOCK_HEIGHT";

/// The tender-key master secret: an OutLayer `PROTECTED_` hex32 secret generated inside the TEE
/// and bound to this WASM hash, 64 hex characters. Confirmed at G1 with the spike's own row
/// (`PROTECTED_SPIKE_MASTER`): a generated secret must carry the `PROTECTED_` prefix, which
/// OutLayer refuses on manual ones.
pub const MASTER_SECRET: &str = "PROTECTED_MASTER_SECRET";

/// The NEAR AI Cloud key: a **manual** OutLayer secret, so it must not carry `PROTECTED_`
/// (G3, created from the dashboard for the spike under this exact name).
pub const NEARAI_API_KEY: &str = "NEARAI_API_KEY";

/// Bearer token for the bundle store's `PUT /api/bundles/<sha256>` (T06), a manual secret.
pub const BUNDLE_STORE_TOKEN: &str = "BUNDLE_STORE_TOKEN";

/// Base URL of the bundle store, e.g. `https://sealedchoice.com` (T06).
pub const BUNDLE_STORE_URL: &str = "BUNDLE_STORE_URL";

/// OutLayer's id for this execution; goes into the bundle so a verifier can fetch the
/// attestation record for the run (G1: `/attestations/by-request/{id}`).
pub const REQUEST_ID: &str = "NEAR_REQUEST_ID";

/// Offline build only (feature `offline`): JSON file with the fixture model outputs, signatures,
/// attestation reports and execution facts the harness supplies.
pub const OFFLINE_FIXTURES: &str = "EVALUATOR_FIXTURES";

/// Offline build only: directory of the local bundle store (same layout as apps/web's local
/// driver: `<dir>/<sha256>.json`).
pub const OFFLINE_BUNDLE_DIR: &str = "BUNDLE_STORE_DIR";
