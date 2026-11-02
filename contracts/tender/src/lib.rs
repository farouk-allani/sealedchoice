//! Tender contract. Spec: docs/03-contract.md. Built from T03 on.
#![deny(clippy::unwrap_used, clippy::expect_used)]

use near_sdk::near;

#[near(contract_state)]
#[derive(Default)]
pub struct Contract {}

#[near]
impl Contract {
    /// Crate version, so a deployed wasm can be matched to its source.
    pub fn version(&self) -> String {
        env!("CARGO_PKG_VERSION").to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn version_matches_crate() {
        assert_eq!(Contract::default().version(), env!("CARGO_PKG_VERSION"));
    }
}
