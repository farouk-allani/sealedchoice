//! Every environment variable the evaluator reads, in one place. OutLayer delivers secrets and
//! execution facts as environment variables; the names marked ⚠️ are provisional until the gate
//! named next to them fixes them (docs/references.md). Changing one is a one-line change here.

/// Account that called `request_execution`: must equal the input's `contract_id`
/// (docs/05-crypto-and-keys.md). ⚠️ G1 confirms the name and meaning.
pub const SENDER_ID: &str = "NEAR_SENDER_ID";

/// Block height of the request (docs/references.md lists it). Optional in the bundle.
pub const BLOCK_HEIGHT: &str = "NEAR_BLOCK_HEIGHT";

/// The tender-key master secret (OutLayer PROTECTED_ hex32 secret bound to the WASM hash).
/// Its value is 64 hex characters. ⚠️ G1 fixes the name (a PROTECTED_ prefix may apply).
pub const MASTER_SECRET: &str = "MASTER_SECRET";

/// Offline build only (feature `offline`): JSON file with the fixture model outputs, signatures,
/// attestation reports and execution facts the harness supplies.
pub const OFFLINE_FIXTURES: &str = "EVALUATOR_FIXTURES";

/// Offline build only: directory of the local bundle store (same layout as apps/web's local
/// driver: `<dir>/<sha256>.json`).
pub const OFFLINE_BUNDLE_DIR: &str = "BUNDLE_STORE_DIR";
