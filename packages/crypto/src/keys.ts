// HKDF-SHA256 -> secp256k1 key derivation and the NEP-413 reader-key message
// (docs/05-crypto-and-keys.md, reference.py hkdf_sha256 / derive_secp256k1 / reader_key).
import { secp256k1 } from "@noble/curves/secp256k1";
import { hkdf } from "@noble/hashes/hkdf";
import { sha256 } from "@noble/hashes/sha2";
import { bytesToHex, concatBytes, utf8ToBytes } from "./bytes.ts";

export const SALT_TENDER = "sealedchoice/tender-key/v1";
export const SALT_DEBRIEF = "sealedchoice/debrief-key/v1";
export const SALT_COMMITTEE = "sealedchoice/committee-key/v1";

export type ReaderPurpose = "debrief" | "committee";

const SALTS: Record<ReaderPurpose, string> = { debrief: SALT_DEBRIEF, committee: SALT_COMMITTEE };

const N: bigint = secp256k1.CURVE.n;

export function hkdfSha256(ikm: Uint8Array, salt: Uint8Array, info: Uint8Array, length = 32): Uint8Array {
  return hkdf(sha256, ikm, salt, info, length);
}

function toBigInt(b: Uint8Array): bigint {
  return b.length === 0 ? 0n : BigInt(`0x${bytesToHex(b)}`);
}

/** k = HKDF-SHA256(ikm, salt, info || u8(ctr), 32) for ctr = 0, 1, … until 1 <= k < n. */
export function deriveSecp256k1(ikm: Uint8Array, salt: Uint8Array, info: Uint8Array): Uint8Array {
  for (let ctr = 0; ctr < 256; ctr++) {
    const k = hkdfSha256(ikm, salt, concatBytes(info, Uint8Array.of(ctr)));
    const n = toBigInt(k);
    if (n >= 1n && n < N) return k;
  }
  throw new Error("unreachable: no valid scalar in 256 tries");
}

/** 33-byte compressed public key of a 32-byte secret key. */
export function publicKeyCompressed(sk: Uint8Array): Uint8Array {
  return secp256k1.getPublicKey(sk, true);
}

/** True if `hex` is a valid compressed secp256k1 point (what the contract accepts as a reader key). */
export function isCompressedPublicKeyHex(hex: string): boolean {
  if (!/^0[23][0-9a-f]{64}$/.test(hex)) return false;
  try {
    secp256k1.ProjectivePoint.fromHex(hex).assertValidity();
    return true;
  } catch {
    return false;
  }
}

/**
 * Reader key (debrief or committee) from the raw 64-byte ed25519 NEP-413 signature of
 * `keyDerivationMessage(...)`. The private key never leaves the browser.
 */
export function readerKey(
  signature: Uint8Array,
  purpose: ReaderPurpose,
  contractId: string,
  tenderId: string,
  accountId: string,
): Uint8Array {
  if (signature.length !== 64) throw new RangeError("expected a raw 64-byte ed25519 signature");
  return deriveSecp256k1(signature, utf8ToBytes(SALTS[purpose]), utf8ToBytes(`${contractId}:${tenderId}:${accountId}`));
}

/** Exact text the reader signs with NEP-413 signMessage (recipient = contract id). */
export function keyDerivationMessage(contractId: string, tenderId: string, purpose: ReaderPurpose): string {
  return (
    "SealedChoice key derivation v1\n" +
    `Contract: ${contractId}\nTender: ${tenderId}\nPurpose: ${purpose}\n` +
    "This signature does not authorize any transaction."
  );
}

/** NEP-413 nonce for the key-derivation message: sha256(message), 32 bytes. */
export function nep413Nonce(message: string): Uint8Array {
  return sha256(utf8ToBytes(message));
}
