//! HKDF-SHA256 -> secp256k1 key derivation (docs/05-crypto-and-keys.md,
//! reference.py `hkdf_sha256` / `derive_secp256k1` / `tender_key` / `reader_key`).
//! Private keys returned here must never be printed, logged or put in the bundle: they come back
//! as `SecretKey`, which has no `Debug`, `Display`, `Clone` or `Serialize` and is zeroized on drop.

use hkdf::Hkdf;
use k256::elliptic_curve::sec1::ToSec1Point;
use sha2::Sha256;
use zeroize::Zeroize;

/// A derived secp256k1 secret key (tender key, reader key). Read it with `expose` only to hand
/// it to a cryptographic call; it cannot be printed or copied, and its bytes are zeroized on drop.
pub struct SecretKey([u8; 32]);

impl SecretKey {
    pub fn expose(&self) -> &[u8; 32] {
        &self.0
    }

    /// 33-byte compressed public key.
    pub fn public_compressed(&self) -> Option<[u8; 33]> {
        pubkey_compressed(&self.0)
    }
}

impl Drop for SecretKey {
    fn drop(&mut self) {
        self.0.zeroize();
    }
}

pub const SALT_TENDER: &[u8] = b"sealedchoice/tender-key/v1";
pub const SALT_DEBRIEF: &[u8] = b"sealedchoice/debrief-key/v1";
pub const SALT_COMMITTEE: &[u8] = b"sealedchoice/committee-key/v1";

/// secp256k1 group order n, big-endian.
const SECP256K1_N: [u8; 32] = [
    0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xfe,
    0xba, 0xae, 0xdc, 0xe6, 0xaf, 0x48, 0xa0, 0x3b, 0xbf, 0xd2, 0x5e, 0x8c, 0xd0, 0x36, 0x41, 0x41,
];

/// HKDF-SHA256 with a 32-byte output (the only length we use). None only if HKDF refuses it.
pub fn hkdf_sha256(ikm: &[u8], salt: &[u8], info: &[u8]) -> Option<[u8; 32]> {
    let mut okm = [0u8; 32];
    Hkdf::<Sha256>::new(Some(salt), ikm)
        .expand(info, &mut okm)
        .ok()?;
    Some(okm)
}

/// 1 <= k < n, comparing big-endian bytes.
pub fn is_valid_scalar(k: &[u8; 32]) -> bool {
    k.iter().any(|&b| b != 0) && k.as_slice() < SECP256K1_N.as_slice()
}

/// k = HKDF-SHA256(ikm, salt, info || u8(ctr), 32) for ctr = 0, 1, … until 1 <= k < n.
pub fn derive_secp256k1(ikm: &[u8], salt: &[u8], info: &[u8]) -> Option<SecretKey> {
    let mut buf = Vec::with_capacity(info.len() + 1);
    for ctr in 0..=u8::MAX {
        buf.clear();
        buf.extend_from_slice(info);
        buf.push(ctr);
        let mut k = hkdf_sha256(ikm, salt, &buf)?;
        if is_valid_scalar(&k) {
            let key = SecretKey(k);
            k.zeroize();
            return Some(key);
        }
        k.zeroize();
    }
    None
}

/// Per-tender bid-encryption key. Inside the TEE only (master secret = OutLayer PROTECTED_ secret).
pub fn tender_key(master_secret: &[u8], contract_id: &str, tender_id: &str) -> Option<SecretKey> {
    derive_secp256k1(
        master_secret,
        SALT_TENDER,
        format!("{contract_id}:{tender_id}").as_bytes(),
    )
}

/// Reader key from a NEP-413 signature (the browser derives these; here for the vectors).
pub fn reader_key(
    signature: &[u8],
    salt: &[u8],
    contract_id: &str,
    tender_id: &str,
    account_id: &str,
) -> Option<SecretKey> {
    derive_secp256k1(
        signature,
        salt,
        format!("{contract_id}:{tender_id}:{account_id}").as_bytes(),
    )
}

/// 33-byte compressed public key.
pub fn pubkey_compressed(sk: &[u8; 32]) -> Option<[u8; 33]> {
    let secret = k256::SecretKey::from_slice(sk).ok()?;
    let point = secret.public_key().to_sec1_point(true);
    point.as_bytes().try_into().ok()
}

/// Exact text the reader signs with NEP-413 signMessage (reference.py `key_derivation_message`).
pub fn key_derivation_message(contract_id: &str, tender_id: &str, purpose: &str) -> String {
    format!(
        "SealedChoice key derivation v1\nContract: {contract_id}\nTender: {tender_id}\nPurpose: {purpose}\nThis signature does not authorize any transaction."
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scalar_range_is_one_to_n_minus_one() {
        assert!(!is_valid_scalar(&[0u8; 32]));
        assert!(is_valid_scalar(&{
            let mut k = [0u8; 32];
            k[31] = 1;
            k
        }));
        assert!(!is_valid_scalar(&SECP256K1_N));
        let mut n_minus_1 = SECP256K1_N;
        n_minus_1[31] -= 1;
        assert!(is_valid_scalar(&n_minus_1));
        assert!(!is_valid_scalar(&[0xff; 32]));
    }
}
