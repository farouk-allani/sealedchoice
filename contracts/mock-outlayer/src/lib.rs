//! Imitates `outlayer.testnet` in sandbox tests. Built at T04.
#![deny(clippy::unwrap_used, clippy::expect_used)]

use near_sdk::near;

#[near(contract_state)]
#[derive(Default)]
pub struct MockOutlayer {}

#[near]
impl MockOutlayer {
    pub fn version(&self) -> String {
        env!("CARGO_PKG_VERSION").to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn version_matches_crate() {
        assert_eq!(MockOutlayer::default().version(), env!("CARGO_PKG_VERSION"));
    }
}
