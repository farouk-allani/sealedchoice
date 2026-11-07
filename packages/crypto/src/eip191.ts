/**
 * EIP-191 "personal sign" recovery, for check 8 of the public verification checklist
 * (docs/06-evidence-and-verification.md).
 *
 * NEAR AI Cloud signs each model call inside the provider's enclave and publishes
 * `{ text, signature, signing_address }`. The signature is ECDSA over the keccak-256 digest of
 * `"\x19Ethereum Signed Message:\n" + byteLength + text`, so verifying it means recovering the
 * address and comparing, not checking a signature against a key we were given.
 *
 * Browser-safe: no Node built-ins. Uses the `@noble` 1.x line that D-016 pins, so the browser
 * bundle keeps one copy of secp256k1 (D-034 explains why not viem, which the task file suggested).
 */
import { secp256k1 } from "@noble/curves/secp256k1";
import { keccak_256 } from "@noble/hashes/sha3";
import { bytesToHex, concatBytes, utf8ToBytes } from "./bytes.ts";

export class SignatureFormatError extends Error {
  override name = "SignatureFormatError";
}

/** 0x + 40 lowercase hex. Addresses are compared in this form, never by checksum casing. */
const ADDRESS = /^0x[0-9a-f]{40}$/;

const strip0x = (hex: string): string => (hex.startsWith("0x") || hex.startsWith("0X") ? hex.slice(2) : hex);

/** The keccak-256 digest EIP-191 actually signs. Exported so a test can pin it. */
export function personalSignDigest(text: string): Uint8Array {
  const body = utf8ToBytes(text);
  // The length in the prefix counts BYTES, not characters: a non-ASCII `text` differs.
  const prefix = utf8ToBytes(`\u0019Ethereum Signed Message:\n${body.length}`);
  return keccak_256(concatBytes(prefix, body));
}

/** The 20-byte address of an uncompressed public key, `0x` + 40 lowercase hex. */
export function addressOfPublicKey(uncompressed: Uint8Array): string {
  if (uncompressed.length !== 65 || uncompressed[0] !== 0x04) {
    throw new SignatureFormatError("expected a 65-byte uncompressed secp256k1 public key");
  }
  return `0x${bytesToHex(keccak_256(uncompressed.slice(1)).slice(-20))}`;
}

/**
 * Recovers the signer of an EIP-191 personal-sign signature.
 *
 * `signature` is 65 bytes as hex, optionally `0x`-prefixed: r (32) || s (32) || v (1), where v is
 * 27, 28, or the raw recovery bit 0 or 1. Throws `SignatureFormatError` on anything malformed, so
 * a bundle with a truncated signature fails the check loudly rather than silently not matching.
 */
export function recoverPersonalSignAddress(text: string, signature: string): string {
  const hex = strip0x(signature.trim());
  if (!/^[0-9a-fA-F]{130}$/.test(hex)) {
    throw new SignatureFormatError(`expected a 65-byte hex signature, got ${hex.length / 2} bytes`);
  }
  const raw = hex.toLowerCase();
  const v = Number.parseInt(raw.slice(128), 16);
  // Accept both the Ethereum convention (27/28) and a bare recovery bit.
  const recovery = v === 27 || v === 28 ? v - 27 : v;
  if (recovery !== 0 && recovery !== 1) {
    throw new SignatureFormatError(`unexpected recovery byte 0x${raw.slice(128)}`);
  }
  const digest = personalSignDigest(text);
  let sig;
  try {
    // `fromCompact` rejects an out-of-range s, which is what we want: a malleable or malformed
    // signature is a failed check, not a different signer.
    sig = secp256k1.Signature.fromCompact(raw.slice(0, 128)).addRecoveryBit(recovery);
  } catch (e) {
    throw new SignatureFormatError(`not a valid secp256k1 signature: ${e instanceof Error ? e.message : String(e)}`);
  }
  const point = sig.recoverPublicKey(digest);
  return addressOfPublicKey(point.toRawBytes(false));
}

/**
 * True when `signature` was made over `text` by `expectedAddress`. Never throws: a malformed
 * signature or address is simply not a match, which is what a check wants to report.
 */
export function verifyPersonalSign(text: string, signature: string, expectedAddress: string): boolean {
  const want = expectedAddress.trim().toLowerCase();
  if (!ADDRESS.test(want)) return false;
  try {
    return recoverPersonalSignAddress(text, signature) === want;
  } catch {
    return false;
  }
}
