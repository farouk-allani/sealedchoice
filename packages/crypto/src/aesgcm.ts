/**
 * AES-256-GCM for the committee report body (docs/06, evidence-bundle.schema.json).
 *
 * The report is encrypted once under a fresh 32-byte key, and that key is ECIES-encrypted to each
 * committee member separately (D-024), so a five-member committee stores one body and five small
 * envelopes rather than five copies of a 700 KB report.
 *
 * This uses the platform's `crypto.subtle` rather than a library. D-016 pins `@noble` to one line
 * so the browser bundle carries a single copy of the primitives; `@noble/ciphers` is only a
 * transitive dependency here, and taking it on directly would add a second AES implementation to
 * the bundle for one call. `crypto.subtle` is in Node 22 and every browser we target and costs
 * nothing to ship. The price is that it is async, which this path already is.
 */

/** Nonce length the bundle format fixes, in bytes. Not the 16 that `ecies.ts` uses. */
export const AES_GCM_NONCE_BYTES = 12;
/** GCM tag length, in bytes. */
export const AES_GCM_TAG_BYTES = 16;

export class AesGcmError extends Error {
  override name = "AesGcmError";
}

/**
 * Decrypt `nonce(12) || ciphertext || tag(16)` under a 32-byte key, with no associated data.
 *
 * Throws `AesGcmError` when the tag does not verify, which is the only signal that the body was
 * altered or the key is wrong: a caller must not fall back to showing undecrypted bytes.
 */
export async function aesGcmDecrypt(key: Uint8Array, body: Uint8Array): Promise<Uint8Array> {
  if (key.length !== 32) throw new AesGcmError(`expected a 32-byte key, got ${key.length}`);
  if (body.length < AES_GCM_NONCE_BYTES + AES_GCM_TAG_BYTES) {
    throw new AesGcmError(`body is shorter than a nonce and a tag (${body.length} bytes)`);
  }
  const nonce = body.subarray(0, AES_GCM_NONCE_BYTES);
  const sealed = body.subarray(AES_GCM_NONCE_BYTES);
  const subtle = globalThis.crypto?.subtle;
  if (subtle === undefined) throw new AesGcmError("this runtime has no crypto.subtle");
  const imported = await subtle.importKey("raw", toBuffer(key), "AES-GCM", false, ["decrypt"]);
  let plaintext: ArrayBuffer;
  try {
    plaintext = await subtle.decrypt(
      { name: "AES-GCM", iv: toBuffer(nonce), tagLength: AES_GCM_TAG_BYTES * 8 },
      imported,
      toBuffer(sealed),
    );
  } catch {
    // Deliberately not forwarding the platform's message: it differs between Node and browsers and
    // says nothing a reader can act on beyond "this did not authenticate".
    throw new AesGcmError("the body did not authenticate under this key");
  }
  return new Uint8Array(plaintext);
}

/** A copy in a plain `ArrayBuffer`, which `crypto.subtle` requires of every input. */
function toBuffer(b: Uint8Array): ArrayBuffer {
  const out = new ArrayBuffer(b.length);
  new Uint8Array(out).set(b);
  return out;
}
