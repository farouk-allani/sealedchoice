//! Tender contract. Spec: docs/03-contract.md. Error codes: README.md in this crate.
//!
//! T03: create tender, tender key (OutLayer derive_pubkey), escrow funding, deposits, bids,
//! withdrawals, cancellation, views, events. Close/evaluate is T04, award/payout T08.
#![deny(clippy::unwrap_used, clippy::expect_used)]

mod bids;
pub mod constants;
pub mod evaluate;
mod events;
pub mod merkle;
pub mod rubric;
mod tender;
pub mod types;
mod views;

#[cfg(test)]
mod tests;

pub use constants::*;
use near_sdk::store::{IterableMap, LookupMap, LookupSet, Vector};
use near_sdk::{AccountId, BorshStorageKey, Gas, NearToken, PanicOnDefault, env, near};
pub use types::*;

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
