//! Tender contract. Spec: docs/03-contract.md. Error codes: README.md in this crate.
//!
//! T03: create tender, tender key (OutLayer derive_pubkey), escrow funding, deposits, bids,
//! withdrawals, cancellation, views, events. Close/evaluate is T04, award/payout T08.
#![deny(clippy::unwrap_used, clippy::expect_used)]

mod bids;
pub mod evaluate;
mod events;
pub mod merkle;
pub mod rubric;
mod tender;
pub mod types;
mod views;

#[cfg(test)]
mod tests;

use near_sdk::store::{IterableMap, LookupMap, LookupSet, Vector};
use near_sdk::{AccountId, BorshStorageKey, Gas, NearToken, PanicOnDefault, env, near};
pub use types::*;

// ------------------------------------------------------------- constants ---

/// Bids per tender (D-007).
pub const MAX_BIDS: usize = 5;
/// Decoded ciphertext bytes.
pub const MAX_CIPHERTEXT_BYTES: usize = 4500;
/// First run plus two retries (D-004); also the key-request budget.
pub const MAX_ATTEMPTS: u8 = 3;
pub const MAX_RATIONALE_CHARS: usize = 1000;
pub const MIN_DEVIATION_RATIONALE_CHARS: usize = 20;
pub const MAX_COMMITTEE: usize = 10;
/// The eval fee is split into this many equal OutLayer deposits: derive_pubkey and evaluate,
/// up to MAX_ATTEMPTS each.
pub const EXECUTIONS_BUDGETED: u128 = 2 * MAX_ATTEMPTS as u128;
/// Largest OutLayer callback payload read (compact result ≤ 900 bytes, JSON-string escaped).
pub const MAX_CALLBACK_BYTES: usize = 4096;

/// OutLayer `request_execution` and our callback (docs/03: start 150 + 50 Tgas; G1 measures).
pub const GAS_REQUEST_EXECUTION: Gas = Gas::from_tgas(100);
pub const GAS_ON_PUBKEY: Gas = Gas::from_tgas(30);
pub const GAS_FT_TRANSFER: Gas = Gas::from_tgas(15);
pub const GAS_ON_ESCROW_REFUND: Gas = Gas::from_tgas(10);
pub const ONE_YOCTO: NearToken = NearToken::from_yoctonear(1);

/// Callback for an evaluate request: validation, bond transfers, escrow refund on final failure.
pub const GAS_ON_EVALUATE: Gas = Gas::from_tgas(50);
/// OutLayer: `input_data` bytes without extra deposit and extra resume gas, and the resume gas it
/// reserves per byte beyond that (contract source, references.md).
pub const OUTLAYER_INPUT_FREE_BYTES: usize = 32 * 1024;
pub const OUTLAYER_CALLBACK_GAS_PER_INPUT_BYTE: u64 = 25_000_000;
/// Largest evaluate input the contract will ever send: 100 Tgas request + 50 Tgas callback + the
/// close itself must fit in 300 Tgas with 25 Mgas per byte over 32 KiB (D-020).
pub const MAX_EVAL_INPUT_BYTES: usize = 37_000;
/// Upper bound of one bid entry in the evaluate input (64-char account, 4500-byte ciphertext).
pub const MAX_BID_ENTRY_BYTES: usize = 6_250;
/// Upper bound of the evaluate input outside bids, rubric and committee.
pub const EVAL_INPUT_OVERHEAD_BYTES: usize = 400;
/// Storage the buyer pays at creation for what the tender adds later: frozen set, attempts,
/// result (D-020).
pub const STORAGE_RESERVE_BYTES: u64 = 2_500;

/// Resource limits for the evaluate execution (⚠️ tune at G1/G3; OutLayer caps 500 B / 4096 MB / 180 s).
pub const EVAL_MAX_INSTRUCTIONS: u64 = 200_000_000_000;
pub const EVAL_MAX_MEMORY_MB: u32 = 512;
pub const EVAL_MAX_SECONDS: u64 = 180;

/// Resource limits for the derive_pubkey execution (⚠️ tune at G1).
pub const DERIVE_MAX_INSTRUCTIONS: u64 = 10_000_000_000;
pub const DERIVE_MAX_MEMORY_MB: u32 = 128;
pub const DERIVE_MAX_SECONDS: u64 = 30;

/// Event standard name (docs/03-contract.md "Events").
pub const EVENT_STANDARD: &str = "sealedchoice";
pub const EVENT_VERSION: &str = "1.0.0";

// ----------------------------------------------------------------- state ---

#[derive(BorshStorageKey)]
#[near]
enum StorageKey {
    Evaluators,
    Tenders,
    Bids,
    Balances,
    CiphertextHashes,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    /// Can only add evaluator versions; no power over existing tenders.
    owner: AccountId,
    outlayer: AccountId,
    /// Append-only list of allowed evaluator builds.
    evaluators: Vector<EvaluatorRef>,
    secrets_ref: SecretsRef,
    tenders: IterableMap<u64, Tender>,
    /// (tender_id, slot) -> bid.
    bids: LookupMap<(u64, u32), Bid>,
    /// Pre-deposited bond + storage for bidders using a function-call key.
    balances: LookupMap<(u64, AccountId), NearToken>,
    /// Every ciphertext hash ever submitted to a tender, withdrawn bids included (I13).
    ciphertext_hashes: LookupSet<(u64, String)>,
    next_tender_id: u64,
    min_deadline_delay_ns: u64,
}

#[near]
impl Contract {
    /// `#[private]`: only the contract account itself can initialize (deploy and init in one
    /// transaction), so nobody can front-run init and pick the owner or a fake OutLayer.
    #[init]
    #[private]
    pub fn new(
        owner: AccountId,
        outlayer: AccountId,
        secrets_ref: SecretsRef,
        min_deadline_delay_ns: u64,
    ) -> Self {
        Self {
            owner,
            outlayer,
            evaluators: Vector::new(StorageKey::Evaluators),
            secrets_ref,
            tenders: IterableMap::new(StorageKey::Tenders),
            bids: LookupMap::new(StorageKey::Bids),
            balances: LookupMap::new(StorageKey::Balances),
            ciphertext_hashes: LookupSet::new(StorageKey::CiphertextHashes),
            next_tender_id: 1,
            min_deadline_delay_ns,
        }
    }

    /// Owner only, append-only. Returns the new evaluator index. Existing tenders keep their copy.
    pub fn add_evaluator(&mut self, evaluator: EvaluatorRef) -> u32 {
        require(env::predecessor_account_id() == self.owner, "E_NOT_OWNER");
        require(
            rubric::is_sha256_hex(&evaluator.wasm_sha256),
            "E_BAD_EVALUATOR",
        );
        require(
            evaluator.wasm_url.starts_with("https://"),
            "E_BAD_EVALUATOR",
        );
        require(evaluator.build_target == "wasm32-wasip2", "E_BAD_EVALUATOR");
        require(!evaluator.source_tag.is_empty(), "E_BAD_EVALUATOR");
        self.evaluators.push(evaluator.clone());
        let index = self.evaluators.len() - 1;
        events::emit(
            "evaluator_added",
            near_sdk::serde_json::json!({"index": index, "evaluator": evaluator}),
        );
        index
    }
}

// --------------------------------------------------------------- helpers ---

/// Panics with an `E_*` code. Never returns.
pub(crate) fn fail(code: &str) -> ! {
    env::panic_str(code)
}

pub(crate) fn require(cond: bool, code: &str) {
    if !cond {
        fail(code)
    }
}

pub(crate) fn now_ns() -> u64 {
    env::block_timestamp()
}

impl Contract {
    pub(crate) fn tender(&self, id: u64) -> &Tender {
        self.tenders.get(&id).unwrap_or_else(|| fail("E_NO_TENDER"))
    }

    pub(crate) fn tender_mut(&mut self, id: u64) -> &mut Tender {
        self.tenders
            .get_mut(&id)
            .unwrap_or_else(|| fail("E_NO_TENDER"))
    }

    pub(crate) fn storage_cost(bytes: u64) -> NearToken {
        env::storage_byte_cost().saturating_mul(u128::from(bytes))
    }
}
