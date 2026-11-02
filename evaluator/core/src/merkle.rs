//! Bid-set Merkle tree (docs/05-crypto-and-keys.md, reference.py `merkle_*`).
//!
//! leaf   = sha256(0x00 || u32le(len(bidder)) || bidder || u64le(submitted_at_ns) || sha256(ciphertext))
//! parent = sha256(0x01 || left || right); an odd last node is promoted unchanged.

use crate::EvalError;
use sha2::{Digest, Sha256};

pub type Hash = [u8; 32];

pub fn sha256(data: &[u8]) -> Hash {
    Sha256::digest(data).into()
}

/// Lowercase hex.
pub fn hex(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut s = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        s.push(char::from(HEX[usize::from(b >> 4)]));
        s.push(char::from(HEX[usize::from(b & 0xf)]));
    }
    s
}

/// Parses 64 lowercase hex characters.
pub fn parse_hash(s: &str) -> Option<Hash> {
    let b = s.as_bytes();
    if b.len() != 64 {
        return None;
    }
    let nibble = |c: u8| match c {
        b'0'..=b'9' => Some(c - b'0'),
        b'a'..=b'f' => Some(c - b'a' + 10),
        _ => None,
    };
    let mut out = [0u8; 32];
    for (i, o) in out.iter_mut().enumerate() {
        *o = (nibble(b[2 * i])? << 4) | nibble(b[2 * i + 1])?;
    }
    Some(out)
}

/// Bidder ids longer than u32::MAX bytes cannot be leaves (NEAR ids are at most 64).
pub fn merkle_leaf(bidder: &str, submitted_at_ns: u64, ciphertext: &[u8]) -> Option<Hash> {
    let b = bidder.as_bytes();
    let len = u32::try_from(b.len()).ok()?;
    let mut h = Sha256::new();
    h.update([0x00]);
    h.update(len.to_le_bytes());
    h.update(b);
    h.update(submitted_at_ns.to_le_bytes());
    h.update(sha256(ciphertext));
    Some(h.finalize().into())
}

pub fn merkle_parent(left: &Hash, right: &Hash) -> Hash {
    let mut h = Sha256::new();
    h.update([0x01]);
    h.update(left);
    h.update(right);
    h.finalize().into()
}

fn next_level(level: &[Hash]) -> Vec<Hash> {
    level
        .chunks(2)
        .map(|pair| match pair {
            [l, r] => merkle_parent(l, r),
            [single] => *single,
            _ => unreachable_pair(),
        })
        .collect()
}

// chunks(2) only yields slices of length 1 or 2.
fn unreachable_pair() -> Hash {
    [0u8; 32]
}

pub fn merkle_root(leaves: &[Hash]) -> Result<Hash, EvalError> {
    let mut level = leaves.to_vec();
    if level.is_empty() {
        return Err(EvalError::EmptyBidSet);
    }
    while level.len() > 1 {
        level = next_level(&level);
    }
    Ok(level[0])
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct ProofStep {
    /// Position of the sibling: "L" or "R".
    pub side: String,
    /// Sibling hash, lowercase hex.
    pub hash: String,
}

/// Proof from leaf `index` to the root; promoted levels add no step. None if out of range.
pub fn merkle_proof(leaves: &[Hash], index: usize) -> Option<Vec<ProofStep>> {
    if index >= leaves.len() {
        return None;
    }
    let mut proof = Vec::new();
    let mut level = leaves.to_vec();
    let mut i = index;
    while level.len() > 1 {
        if i.is_multiple_of(2) {
            if let Some(sib) = level.get(i + 1) {
                proof.push(ProofStep {
                    side: "R".into(),
                    hash: hex(sib),
                });
            }
        } else {
            proof.push(ProofStep {
                side: "L".into(),
                hash: hex(&level[i - 1]),
            });
        }
        level = next_level(&level);
        i /= 2;
    }
    Some(proof)
}

pub fn merkle_verify(leaf: &Hash, proof: &[ProofStep], root: &Hash) -> bool {
    let mut cur = *leaf;
    for step in proof {
        let Some(sib) = parse_hash(&step.hash) else {
            return false;
        };
        cur = match step.side.as_str() {
            "L" => merkle_parent(&sib, &cur),
            "R" => merkle_parent(&cur, &sib),
            _ => return false,
        };
    }
    cur == *root
}
