//! Every limit, gas amount, deposit rule and OutLayer number the contract uses, in one file.
//!
//! Numbers marked ⚠️ are provisional until gate G1 (and G3 where noted) measures them on testnet
//! against the real OutLayer: retuning them is a change to this file only (docs/03-contract.md
//! "Constants", DECISIONS D-018, D-020). Format definitions shared with the spec (flag bits, basis
//! points, the safe-integer bound) stay with the code that parses those formats.

use near_sdk::{Gas, NearToken};

// ------------------------------------------------------------ tender limits ---

/// Bids per tender (D-007). ⚠️ G1/G3: raise only if OutLayer input, time budget and AI latency
/// allow it (docs/04-evaluator.md §7).
pub const MAX_BIDS: usize = 5;
/// Decoded ciphertext bytes: plaintext limits (2000 + 1200 bytes of text plus fields) + ECIES overhead.
pub const MAX_CIPHERTEXT_BYTES: usize = 4500;
/// First run plus two retries (D-004); also the key-request budget.
pub const MAX_ATTEMPTS: u8 = 3;
pub const MAX_RATIONALE_CHARS: usize = 1000;
pub const MIN_DEVIATION_RATIONALE_CHARS: usize = 20;
pub const MAX_COMMITTEE: usize = 10;
/// Rubric JSON size limit (it travels in every OutLayer evaluate input).
pub const MAX_RUBRIC_BYTES: usize = 16 * 1024;
/// Compact result size limit (OutLayer stdout).
pub const MAX_RESULT_BYTES: usize = 900;
/// Failure reasons are stored truncated to this many characters.
pub const MAX_REASON_CHARS: usize = 200;
/// Page size cap for list views.
pub const MAX_PAGE: u64 = 50;

// ------------------------------------------------------------ eval fee ---

/// The eval fee is split into this many equal OutLayer deposits: derive_pubkey and evaluate,
/// up to MAX_ATTEMPTS each.
pub const EXECUTIONS_BUDGETED: u128 = 2 * MAX_ATTEMPTS as u128;
/// Storage the buyer pays at creation for what the tender adds later: tender key, frozen set,
/// 3 attempts, the ≤ 900-byte result (D-020). Not refunded. ⚠️ G1 measures the real growth.
pub const STORAGE_RESERVE_BYTES: u64 = 2_500;

// ------------------------------------------------------------ gas ---

/// OutLayer `request_execution`. OutLayer reserves ≥ 50 Tgas of it for its resume callback, plus
/// OUTLAYER_CALLBACK_GAS_PER_INPUT_BYTE for each input byte over 32 KiB, which
/// `evaluate::request_gas_for_input` adds on top. ⚠️ G1.
pub const GAS_REQUEST_EXECUTION: Gas = Gas::from_tgas(100);
/// Callback of a derive_pubkey request. ⚠️ G1.
pub const GAS_ON_PUBKEY: Gas = Gas::from_tgas(30);
/// Callback of an evaluate request: validation, bond transfers, escrow refund on final failure. ⚠️ G1.
pub const GAS_ON_EVALUATE: Gas = Gas::from_tgas(50);
/// NEP-141 `ft_transfer` of the escrow, and its callback. ⚠️ G1 (testnet token).
pub const GAS_FT_TRANSFER: Gas = Gas::from_tgas(15);
pub const GAS_ON_ESCROW_REFUND: Gas = Gas::from_tgas(10);
pub const ONE_YOCTO: NearToken = NearToken::from_yoctonear(1);
/// Largest OutLayer callback payload read (compact result ≤ 900 bytes, JSON-string escaped).
pub const MAX_CALLBACK_BYTES: usize = 4096;

// ------------------------------------------------------------ OutLayer ---

/// Read in the OutLayer contract source (out-layer/outlayer aaf60a2, docs/references.md):
/// `input_data` bytes free of extra deposit and gas; beyond them OutLayer reserves 25 Mgas of resume
/// gas per byte (0.025 Tgas per KB: never the limit) and holds a storage deposit of 10^19 yocto per
/// byte, which the request's deposit must cover (D-020). ⚠️ G1 confirms on testnet.
/// `contracts/mock-outlayer` copies these three values.
pub const OUTLAYER_INPUT_FREE_BYTES: usize = 32 * 1024;
pub const OUTLAYER_CALLBACK_GAS_PER_INPUT_BYTE: u64 = 25_000_000;
pub const OUTLAYER_STORAGE_PRICE_PER_BYTE: u128 = 10_000_000_000_000_000_000;
/// Upper bound of one bid entry in the evaluate input (64-char account, 4500-byte ciphertext).
pub const MAX_BID_ENTRY_BYTES: usize = 6_250;
/// Upper bound of the evaluate input outside bids, rubric and committee.
pub const EVAL_INPUT_OVERHEAD_BYTES: usize = 400;

/// Resource limits for the evaluate execution. ⚠️ G1/G3 (OutLayer caps 500 B instructions /
/// 4096 MB / 180 s).
pub const EVAL_MAX_INSTRUCTIONS: u64 = 200_000_000_000;
pub const EVAL_MAX_MEMORY_MB: u32 = 512;
pub const EVAL_MAX_SECONDS: u64 = 180;

/// Resource limits for the derive_pubkey execution. ⚠️ G1.
pub const DERIVE_MAX_INSTRUCTIONS: u64 = 10_000_000_000;
pub const DERIVE_MAX_MEMORY_MB: u32 = 128;
pub const DERIVE_MAX_SECONDS: u64 = 30;

// ------------------------------------------------------------ events ---

/// Event standard name (docs/03-contract.md "Events").
pub const EVENT_STANDARD: &str = "sealedchoice";
pub const EVENT_VERSION: &str = "1.0.0";
