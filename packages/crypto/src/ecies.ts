// ECIES with the config pinned explicitly (docs/05-crypto-and-keys.md): secp256k1,
// uncompressed ephemeral key, HKDF key from uncompressed points, AES-256-GCM, 16-byte nonce.
// Wire: ephemeral_pk(65) || nonce(16) || tag(16) || ciphertext. Same as eciespy 0.4.7 and
// the Rust `ecies` crate defaults; we never read eciesjs's mutable global ECIES_CONFIG.
import { decrypt, encrypt } from "eciesjs";
import { Config } from "eciesjs/config";
import { hexToBytes } from "./bytes.ts";

/** Ephemeral public key (65) + nonce (16) + tag (16). */
export const ECIES_OVERHEAD = 97;

function pinnedConfig(): Config {
  const c = new Config();
  c.ellipticCurve = "secp256k1";
  c.isEphemeralKeyCompressed = false;
  c.isHkdfKeyCompressed = false;
  c.symmetricAlgorithm = "aes-256-gcm";
  c.symmetricNonceLength = 16;
  return c;
}

const CONFIG = pinnedConfig();

const asBytes = (k: string | Uint8Array): Uint8Array => (typeof k === "string" ? hexToBytes(k) : k);

/** Encrypt to a secp256k1 public key (33-byte compressed or 65-byte uncompressed; hex or bytes). */
export function eciesEncrypt(publicKey: string | Uint8Array, plaintext: Uint8Array): Uint8Array {
  return encrypt(asBytes(publicKey), plaintext, CONFIG);
}

/** Decrypt with a 32-byte secp256k1 secret key (hex or bytes). Throws if the tag does not verify. */
export function eciesDecrypt(secretKey: string | Uint8Array, ciphertext: Uint8Array): Uint8Array {
  if (ciphertext.length < ECIES_OVERHEAD) throw new RangeError("ciphertext shorter than the ECIES overhead");
  return decrypt(asBytes(secretKey), ciphertext, CONFIG);
}
