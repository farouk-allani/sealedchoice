//! Bid-set Merkle tree with `env::sha256` (docs/05-crypto-and-keys.md, reference.py `merkle_*`).
//!
//! leaf   = sha256(0x00 || u32le(len(bidder)) || bidder || u64le(submitted_at_ns) || sha256(ciphertext))
//! parent = sha256(0x01 || left || right); an odd last node is promoted unchanged.

use near_sdk::env;

pub type Hash = [u8; 32];

fn sha256(data: &[u8]) -> Hash {
    let mut out = [0u8; 32];
    out.copy_from_slice(&env::sha256(data));
    out
}

pub fn leaf(bidder: &str, submitted_at_ns: u64, ciphertext: &[u8]) -> Hash {
    let b = bidder.as_bytes();
    let mut pre = Vec::with_capacity(1 + 4 + b.len() + 8 + 32);
    pre.push(0x00);
    // NEAR account ids are at most 64 bytes, so the length always fits in u32.
    pre.extend_from_slice(&(b.len() as u32).to_le_bytes());
    pre.extend_from_slice(b);
    pre.extend_from_slice(&submitted_at_ns.to_le_bytes());
    pre.extend_from_slice(&sha256(ciphertext));
    sha256(&pre)
}

pub fn parent(left: &Hash, right: &Hash) -> Hash {
    let mut pre = Vec::with_capacity(65);
    pre.push(0x01);
    pre.extend_from_slice(left);
    pre.extend_from_slice(right);
    sha256(&pre)
}

/// Root of a non-empty leaf list; None for an empty one.
pub fn root(leaves: &[Hash]) -> Option<Hash> {
    let mut level = leaves.to_vec();
    if level.is_empty() {
        return None;
    }
    while level.len() > 1 {
        level = level
            .chunks(2)
            .map(|pair| match pair {
                [l, r] => parent(l, r),
                _ => pair[0],
            })
            .collect();
    }
    level.first().copied()
}
