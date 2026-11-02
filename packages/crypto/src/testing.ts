// For tests and vectors only. The real tender key is derived inside the OutLayer TEE
// from MASTER_SECRET, which never exists outside it; no app code imports this.
import { utf8ToBytes } from "./bytes.ts";
import { SALT_TENDER, deriveSecp256k1 } from "./keys.ts";

export function tenderKey(masterSecret: Uint8Array, contractId: string, tenderId: string): Uint8Array {
  return deriveSecp256k1(masterSecret, utf8ToBytes(SALT_TENDER), utf8ToBytes(`${contractId}:${tenderId}`));
}
