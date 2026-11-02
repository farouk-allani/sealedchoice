//! Bidder side: deposit, withdraw_balance, submit_bid, withdraw_bid.

use crate::events::emit;
use crate::rubric::{hex, is_compressed_pubkey_hex};
use crate::*;
use near_sdk::Promise;
use near_sdk::base64::Engine;
use near_sdk::base64::engine::general_purpose::STANDARD;
use near_sdk::json_types::U64;
use near_sdk::serde_json::json;

#[near]
impl Contract {
    /// Payable. Credits the caller's balance for this tender (bond + storage for a later
    /// `submit_bid` from a function-call key, which cannot attach deposits). The storage of a
    /// new balance entry is paid from the deposit.
    #[payable]
    pub fn deposit(&mut self, tender_id: u64) -> NearToken {
        let t = self.tender(tender_id);
        require(
            matches!(
                t.status,
                Status::PendingKey | Status::AwaitingFunds | Status::Open
            ),
            "E_BAD_STATUS",
        );
        require(now_ns() < t.deadline_ns.0, "E_DEADLINE_PASSED");
        let caller = env::predecessor_account_id();
        let attached = env::attached_deposit();
        require(!attached.is_zero(), "E_INSUFFICIENT_DEPOSIT");

        let key = (tender_id, caller.clone());
        let storage_before = env::storage_usage();
        let previous = self.balances.get(&key).copied();
        self.balances.insert(
            key.clone(),
            previous.unwrap_or(NearToken::from_yoctonear(0)),
        );
        self.balances.flush();
        let storage = Self::storage_cost(env::storage_usage().saturating_sub(storage_before));
        let credit = attached
            .checked_sub(storage)
            .unwrap_or_else(|| fail("E_INSUFFICIENT_DEPOSIT"));
        let balance = previous
            .unwrap_or(NearToken::from_yoctonear(0))
            .saturating_add(credit);
        self.balances.insert(key, balance);
        emit(
            "deposited",
            json!({"tender_id": tender_id.to_string(), "account": caller, "credited": credit, "balance": balance}),
        );
        balance
    }

    /// Returns the caller's whole balance for this tender. Any time.
    pub fn withdraw_balance(&mut self, tender_id: u64) -> NearToken {
        let caller = env::predecessor_account_id();
        let balance = self
            .balances
            .remove(&(tender_id, caller.clone()))
            .unwrap_or_else(|| fail("E_NO_BALANCE"));
        if !balance.is_zero() {
            Promise::new(caller.clone()).transfer(balance).detach();
        }
        emit(
            "balance_withdrawn",
            json!({"tender_id": tender_id.to_string(), "account": caller, "amount": balance}),
        );
        balance
    }

    /// Payable (or uses the caller's balance). Stores the sealed bid; returns the receipt.
    /// Rules: Open, before the deadline (I2), one active bid per account, at most MAX_BIDS,
    /// ciphertext ≤ MAX_CIPHERTEXT_BYTES and never seen in this tender (I13), valid debrief key,
    /// attached + balance ≥ bond + storage. Excess attached deposit is refunded.
    #[payable]
    pub fn submit_bid(
        &mut self,
        tender_id: u64,
        ciphertext_b64: String,
        debrief_pubkey: String,
    ) -> BidReceipt {
        let storage_before = env::storage_usage();
        let caller = env::predecessor_account_id();
        let now = now_ns();
        let t = self.tender(tender_id);
        require(t.status == Status::Open, "E_NOT_OPEN");
        require(now < t.deadline_ns.0, "E_DEADLINE_PASSED");
        require(!self.has_active_bid(tender_id, &caller), "E_ALREADY_BID");
        require(t.active_slots.len() < MAX_BIDS, "E_MAX_BIDS");
        let ciphertext = STANDARD
            .decode(ciphertext_b64.as_bytes())
            .unwrap_or_else(|_| fail("E_BAD_CIPHERTEXT"));
        require(!ciphertext.is_empty(), "E_BAD_CIPHERTEXT");
        require(
            ciphertext.len() <= MAX_CIPHERTEXT_BYTES,
            "E_CIPHERTEXT_TOO_LARGE",
        );
        require(is_compressed_pubkey_hex(&debrief_pubkey), "E_BAD_PUBKEY");
        let ciphertext_sha256 = hex(&env::sha256(&ciphertext));
        require(
            !self
                .ciphertext_hashes
                .contains(&(tender_id, ciphertext_sha256.clone())),
            "E_DUPLICATE_CIPHERTEXT",
        );
        let bond = t.bond;
        let slot = t.bid_slots;

        self.ciphertext_hashes
            .insert((tender_id, ciphertext_sha256.clone()));
        self.bids.insert(
            (tender_id, slot),
            Bid {
                bidder: caller.clone(),
                submitted_at_ns: U64(now),
                ciphertext,
                ciphertext_sha256: ciphertext_sha256.clone(),
                debrief_pubkey: debrief_pubkey.clone(),
                bond,
                withdrawn: false,
                bond_settled: false,
            },
        );
        {
            let t = self.tender_mut(tender_id);
            t.bid_slots += 1;
            t.active_slots.push(slot);
        }
        self.flush_all();
        let storage = Self::storage_cost(env::storage_usage().saturating_sub(storage_before));
        self.charge(tender_id, &caller, bond.saturating_add(storage));

        emit(
            "bid_submitted",
            json!({
                "tender_id": tender_id.to_string(),
                "slot": slot,
                "bidder": caller,
                "ciphertext_sha256": ciphertext_sha256,
                "submitted_at_ns": U64(now),
                "debrief_pubkey": debrief_pubkey,
                "bond": bond,
            }),
        );
        BidReceipt {
            slot,
            ciphertext_sha256,
            submitted_at_ns: U64(now),
        }
    }

    /// Before the deadline only. Refunds the bond once (I10) and frees the slot. The ciphertext
    /// hash stays used (I13).
    pub fn withdraw_bid(&mut self, tender_id: u64) {
        let caller = env::predecessor_account_id();
        let t = self.tender(tender_id);
        require(t.status == Status::Open, "E_NOT_OPEN");
        require(now_ns() < t.deadline_ns.0, "E_DEADLINE_PASSED");
        let slot = self
            .active_slot_of(tender_id, &caller)
            .unwrap_or_else(|| fail("E_NO_ACTIVE_BID"));
        if let Some(bid) = self.bids.get_mut(&(tender_id, slot)) {
            bid.withdrawn = true;
        }
        self.tender_mut(tender_id)
            .active_slots
            .retain(|s| *s != slot);
        let (bidder, bond) = self
            .settle_bond(tender_id, slot)
            .unwrap_or_else(|| fail("E_BOND_SETTLED"));
        if !bond.is_zero() {
            Promise::new(bidder.clone()).transfer(bond).detach();
        }
        emit(
            "bid_withdrawn",
            json!({"tender_id": tender_id.to_string(), "slot": slot, "bidder": bidder, "bond_refunded": bond}),
        );
    }
}

impl Contract {
    fn active_slot_of(&self, tender_id: u64, account: &AccountId) -> Option<u32> {
        let t = self.tenders.get(&tender_id)?;
        t.active_slots.iter().copied().find(|slot| {
            self.bids
                .get(&(tender_id, *slot))
                .is_some_and(|b| &b.bidder == account && !b.withdrawn)
        })
    }

    fn has_active_bid(&self, tender_id: u64, account: &AccountId) -> bool {
        self.active_slot_of(tender_id, account).is_some()
    }

    /// Takes `need` from the attached deposit first, then from the balance; refunds excess attached.
    fn charge(&mut self, tender_id: u64, account: &AccountId, need: NearToken) {
        let attached = env::attached_deposit();
        if attached >= need {
            let change = attached.saturating_sub(need);
            if !change.is_zero() {
                Promise::new(account.clone()).transfer(change).detach();
            }
            return;
        }
        let shortfall = need.saturating_sub(attached);
        let key = (tender_id, account.clone());
        let balance = self
            .balances
            .get(&key)
            .copied()
            .unwrap_or(NearToken::from_yoctonear(0));
        let left = balance
            .checked_sub(shortfall)
            .unwrap_or_else(|| fail("E_INSUFFICIENT_DEPOSIT"));
        self.balances.insert(key, left);
    }

    fn flush_all(&mut self) {
        self.tenders.flush();
        self.bids.flush();
        self.balances.flush();
    }
}
