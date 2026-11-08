import { describe, expect, it } from "vitest";
import { AES_GCM_NONCE_BYTES, AES_GCM_TAG_BYTES, AesGcmError, aesGcmDecrypt } from "./aesgcm.ts";
import { utf8ToBytes } from "./bytes.ts";

/** Seals with the same format the evaluator writes: nonce(12) || ciphertext || tag(16). */
async function seal(key: Uint8Array, nonce: Uint8Array, plaintext: Uint8Array): Promise<Uint8Array> {
  const imported = await crypto.subtle.importKey("raw", key.slice().buffer, "AES-GCM", false, ["encrypt"]);
  const sealed = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: nonce.slice().buffer, tagLength: AES_GCM_TAG_BYTES * 8 },
      imported,
      plaintext.slice().buffer,
    ),
  );
  const out = new Uint8Array(nonce.length + sealed.length);
  out.set(nonce);
  out.set(sealed, nonce.length);
  return out;
}

const KEY = new Uint8Array(32).fill(7);
const NONCE = new Uint8Array(AES_GCM_NONCE_BYTES).fill(3);
const PLAINTEXT = utf8ToBytes('{"v":1,"tender_id":"3","status":"ok"}');

describe("aesGcmDecrypt", () => {
  it("round-trips the body format the bundle uses", async () => {
    const body = await seal(KEY, NONCE, PLAINTEXT);
    expect(await aesGcmDecrypt(KEY, body)).toEqual(PLAINTEXT);
  });

  it("refuses a body whose tag does not verify", async () => {
    const body = await seal(KEY, NONCE, PLAINTEXT);
    const last = body.length - 1;
    body[last] = (body[last] ?? 0) ^ 1;
    await expect(aesGcmDecrypt(KEY, body)).rejects.toThrow(AesGcmError);
  });

  // The one failure a reader is most likely to hit: a key derived under the wrong account id.
  it("refuses the right body under the wrong key", async () => {
    const body = await seal(KEY, NONCE, PLAINTEXT);
    await expect(aesGcmDecrypt(new Uint8Array(32).fill(8), body)).rejects.toThrow(
      "did not authenticate",
    );
  });

  it("refuses a body with a flipped ciphertext byte, not just a flipped tag", async () => {
    const body = await seal(KEY, NONCE, PLAINTEXT);
    body[AES_GCM_NONCE_BYTES] = (body[AES_GCM_NONCE_BYTES] ?? 0) ^ 1;
    await expect(aesGcmDecrypt(KEY, body)).rejects.toThrow(AesGcmError);
  });

  it("refuses a key that is not 32 bytes", async () => {
    const body = await seal(KEY, NONCE, PLAINTEXT);
    await expect(aesGcmDecrypt(new Uint8Array(16), body)).rejects.toThrow("expected a 32-byte key");
  });

  it("refuses a body too short to hold a nonce and a tag", async () => {
    await expect(aesGcmDecrypt(KEY, new Uint8Array(20))).rejects.toThrow("shorter than a nonce");
  });
});
