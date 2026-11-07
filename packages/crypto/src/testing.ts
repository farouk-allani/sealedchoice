// For tests and vectors only. The real tender key is derived inside the OutLayer TEE
// from MASTER_SECRET, which never exists outside it; no app code imports this.
import { secp256k1 } from "@noble/curves/secp256k1";
import { bytesToHex, utf8ToBytes } from "./bytes.ts";
import { addressOfPublicKey, personalSignDigest } from "./eip191.ts";
import { SALT_TENDER, deriveSecp256k1 } from "./keys.ts";

export function tenderKey(masterSecret: Uint8Array, contractId: string, tenderId: string): Uint8Array {
  return deriveSecp256k1(masterSecret, utf8ToBytes(SALT_TENDER), utf8ToBytes(`${contractId}:${tenderId}`));
}

/**
 * Signs `text` the way an enclave does (EIP-191 personal sign), so a test can build evidence that
 * check 8 really recovers rather than being handed an address to trust. Test-only: no app code
 * signs anything with a key it holds.
 */
export function signPersonalSign(text: string, privateKey: Uint8Array): { signature: string; address: string } {
  const sig = secp256k1.sign(personalSignDigest(text), privateKey, { prehash: false });
  const v = (sig.recovery + 27).toString(16).padStart(2, "0");
  return {
    signature: `0x${bytesToHex(sig.toCompactRawBytes())}${v}`,
    address: addressOfPublicKey(secp256k1.getPublicKey(privateKey, false)),
  };
}
