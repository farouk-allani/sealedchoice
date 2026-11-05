//! Minimal NEP-141 + NEP-145 + NEP-148 token, after near-sdk's fungible-token example. Used by the
//! sandbox suite and deployed on **testnet** as the demo's tUSDC (T07). Never on mainnet: it mints
//! its whole supply to one owner at init and has no other issuance control.
#![deny(clippy::unwrap_used, clippy::expect_used)]

use near_contract_standards::fungible_token::metadata::{
    FT_METADATA_SPEC, FungibleTokenMetadata, FungibleTokenMetadataProvider,
};
use near_contract_standards::fungible_token::{
    FungibleToken, FungibleTokenCore, FungibleTokenResolver,
};
use near_contract_standards::storage_management::{
    StorageBalance, StorageBalanceBounds, StorageManagement,
};
use near_sdk::json_types::U128;
use near_sdk::{AccountId, BorshStorageKey, NearToken, PanicOnDefault, PromiseOrValue, near};

#[derive(BorshStorageKey)]
#[near]
enum StorageKey {
    FungibleToken,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct MockFt {
    token: FungibleToken,
    metadata: FungibleTokenMetadata,
}

#[near]
impl MockFt {
    /// `decimals` is the rubric's `currency.decimals`: the demo uses 6, like real USDC, so a
    /// `budget_cap_minor` of "15000000000" reads as 15,000 tokens everywhere.
    #[init]
    pub fn new(owner_id: AccountId, total_supply: U128, symbol: String, decimals: u8) -> Self {
        let mut this = Self {
            token: FungibleToken::new(StorageKey::FungibleToken),
            metadata: FungibleTokenMetadata {
                spec: FT_METADATA_SPEC.to_string(),
                name: format!("SealedChoice demo {symbol}"),
                symbol,
                icon: None,
                reference: None,
                reference_hash: None,
                decimals,
            },
        };
        this.token.internal_register_account(&owner_id);
        this.token.internal_deposit(&owner_id, total_supply.0);
        this
    }
}

#[near]
impl FungibleTokenCore for MockFt {
    #[payable]
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>) {
        self.token.ft_transfer(receiver_id, amount, memo)
    }

    #[payable]
    fn ft_transfer_call(
        &mut self,
        receiver_id: AccountId,
        amount: U128,
        memo: Option<String>,
        msg: String,
    ) -> PromiseOrValue<U128> {
        self.token.ft_transfer_call(receiver_id, amount, memo, msg)
    }

    fn ft_total_supply(&self) -> U128 {
        self.token.ft_total_supply()
    }

    fn ft_balance_of(&self, account_id: AccountId) -> U128 {
        self.token.ft_balance_of(account_id)
    }
}

#[near]
impl FungibleTokenResolver for MockFt {
    #[private]
    fn ft_resolve_transfer(
        &mut self,
        sender_id: AccountId,
        receiver_id: AccountId,
        amount: U128,
    ) -> U128 {
        self.token
            .internal_ft_resolve_transfer(&sender_id, receiver_id, amount)
            .0
            .into()
    }
}

#[near]
impl StorageManagement for MockFt {
    #[payable]
    fn storage_deposit(
        &mut self,
        account_id: Option<AccountId>,
        registration_only: Option<bool>,
    ) -> StorageBalance {
        self.token.storage_deposit(account_id, registration_only)
    }

    #[payable]
    fn storage_withdraw(&mut self, amount: Option<NearToken>) -> StorageBalance {
        self.token.storage_withdraw(amount)
    }

    #[payable]
    fn storage_unregister(&mut self, force: Option<bool>) -> bool {
        self.token.internal_storage_unregister(force).is_some()
    }

    fn storage_balance_bounds(&self) -> StorageBalanceBounds {
        self.token.storage_balance_bounds()
    }

    fn storage_balance_of(&self, account_id: AccountId) -> Option<StorageBalance> {
        self.token.storage_balance_of(account_id)
    }
}

#[near]
impl FungibleTokenMetadataProvider for MockFt {
    fn ft_metadata(&self) -> FungibleTokenMetadata {
        self.metadata.clone()
    }
}
