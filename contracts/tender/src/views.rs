//! Read-only methods (docs/03-contract.md "Views").

use crate::*;
use near_sdk::base64::Engine;
use near_sdk::base64::engine::general_purpose::STANDARD;
use near_sdk::json_types::U64;

/// Page size cap for list views.
const MAX_PAGE: u64 = 50;

#[near]
impl Contract {
    pub fn version(&self) -> String {
        env!("CARGO_PKG_VERSION").to_string()
    }

    pub fn get_config(&self) -> ConfigView {
        ConfigView {
            owner: self.owner.clone(),
            outlayer: self.outlayer.clone(),
            secrets_ref: self.secrets_ref.clone(),
            min_deadline_delay_ns: U64(self.min_deadline_delay_ns),
            next_tender_id: self.next_tender_id,
        }
    }

    pub fn get_evaluators(&self) -> Vec<EvaluatorRef> {
        self.evaluators.iter().cloned().collect()
    }

    pub fn get_tender(&self, tender_id: u64) -> Option<Tender> {
        self.tenders.get(&tender_id).cloned()
    }

    /// Tenders with id ≥ `from` (default 1), at most `limit` (default and max 50), by id.
    pub fn list_tenders(&self, from: Option<u64>, limit: Option<u64>) -> Vec<Tender> {
        let from = from.unwrap_or(1).max(1);
        let limit = limit.unwrap_or(MAX_PAGE).min(MAX_PAGE);
        (from..self.next_tender_id)
            .take(limit as usize)
            .filter_map(|id| self.tenders.get(&id).cloned())
            .collect()
    }

    /// Every slot ever used, without ciphertexts.
    pub fn get_bids(&self, tender_id: u64) -> Vec<BidView> {
        let Some(t) = self.tenders.get(&tender_id) else {
            return Vec::new();
        };
        (0..t.bid_slots)
            .filter_map(|slot| {
                self.bids.get(&(tender_id, slot)).map(|b| BidView {
                    slot,
                    bidder: b.bidder.clone(),
                    submitted_at_ns: b.submitted_at_ns,
                    ciphertext_sha256: b.ciphertext_sha256.clone(),
                    ciphertext_len: u32::try_from(b.ciphertext.len()).unwrap_or(u32::MAX),
                    debrief_pubkey: b.debrief_pubkey.clone(),
                    bond: b.bond,
                    withdrawn: b.withdrawn,
                    bond_settled: b.bond_settled,
                })
            })
            .collect()
    }

    /// Ciphertext of one slot, base64 (standard alphabet, padded).
    pub fn get_bid_ciphertext(&self, tender_id: u64, slot: u32) -> Option<String> {
        self.bids
            .get(&(tender_id, slot))
            .map(|b| STANDARD.encode(&b.ciphertext))
    }

    pub fn get_frozen(&self, tender_id: u64) -> Option<Frozen> {
        self.tenders.get(&tender_id).and_then(|t| t.frozen.clone())
    }

    pub fn get_attempts(&self, tender_id: u64) -> Vec<Attempt> {
        self.tenders
            .get(&tender_id)
            .map(|t| t.attempts.clone())
            .unwrap_or_default()
    }

    /// The accepted compact result, verbatim.
    pub fn get_result(&self, tender_id: u64) -> Option<String> {
        self.tenders
            .get(&tender_id)
            .and_then(|t| t.result_json.clone())
    }

    pub fn get_award(&self, tender_id: u64) -> Option<Award> {
        self.tenders.get(&tender_id).and_then(|t| t.award.clone())
    }

    pub fn get_balance(&self, tender_id: u64, account_id: AccountId) -> NearToken {
        self.balances
            .get(&(tender_id, account_id))
            .copied()
            .unwrap_or(NearToken::from_yoctonear(0))
    }

    /// Whether a ciphertext hash was ever submitted to this tender (I13).
    pub fn is_ciphertext_used(&self, tender_id: u64, ciphertext_sha256: String) -> bool {
        self.ciphertext_hashes
            .contains(&(tender_id, ciphertext_sha256))
    }
}
