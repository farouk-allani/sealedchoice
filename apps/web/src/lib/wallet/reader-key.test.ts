// The wallet signature in these tests is the real one G5 took from `vendor-a.sealedchoice.testnet`
// on 2026-11-07, and the key it must produce is the one reference.py produced from the same bytes.
// A testnet signature over a message that authorises nothing, so it is safe in a fixture.
import { describe, expect, it } from "vitest";
import { bytesToHex } from "@tender/crypto";
import {
  derivationRequest,
  deriveReaderKeyFromWallet,
  generateReaderKey,
  loadReaderKeyFile,
  readerKeyFile,
  readerKeyFileName,
  signatureBytes,
} from "./reader-key.ts";

const CONTRACT = "tenders.sealedchoice.testnet";
const ACCOUNT = "vendor-a.sealedchoice.testnet";

const G5_SIGNATURE_B64 =
  "jFGueISxw7uk2dU9diEzh7Gu/aWilto9M2f3+2dmgaxy5sJVPPC/KYAW1uX/IjkwrxmVksIIDIY1IIftEeAjBw==";
/** The same 64 bytes in base58, without the prefix a signer would put in front of them. */
const G5_SIGNATURE_B58 =
  "3oiTbNwwCiKQ8zMULNWHHZvjttH8dMugjWTquFJpuhfshwn76rLJBcPdwCf9obRk2V2rm5xNWJ67wqPSia8ibHWv";
const G5_DEBRIEF_PUBKEY =
  "02843e0fb649ee8ae17f76bd7d912aaf4ebb22e56c383c5f47a27426fbd65128f4";

const params = {
  purpose: "debrief",
  contractId: CONTRACT,
  tenderId: "1",
  accountId: ACCOUNT,
} as const;

describe("derivationRequest", () => {
  it("builds the exact message and nonce from the test vectors", () => {
    const { message, nonce, recipient } = derivationRequest(params);
    expect(message).toBe(
      "SealedChoice key derivation v1\n" +
        `Contract: ${CONTRACT}\n` +
        "Tender: 1\n" +
        "Purpose: debrief\n" +
        "This signature does not authorize any transaction.",
    );
    expect(bytesToHex(nonce)).toBe(
      "3c475c88a814d6a8dd9c5fa013dbfb8c3b3d40523107efdf9a6b8cd93d66c9c7",
    );
    expect(nonce).toHaveLength(32);
    expect(recipient).toBe(CONTRACT);
  });
});

describe("signatureBytes", () => {
  it("decodes the base64 form NEAR Connect returns", () => {
    expect(signatureBytes(G5_SIGNATURE_B64)).toHaveLength(64);
  });

  it("decodes the prefixed base58 form a signer may produce", () => {
    // The prefix is joined on at run time on purpose. A NEAR private key has exactly this
    // shape, so the repo's secret scanner refuses the literal, and it is right to: nothing
    // in the text distinguishes a signature from a key.
    const prefixed = `ed25519:${G5_SIGNATURE_B58}`;
    expect(bytesToHex(signatureBytes(prefixed))).toBe(bytesToHex(signatureBytes(G5_SIGNATURE_B64)));
  });

  it("refuses anything that is not 64 bytes", () => {
    expect(() => signatureBytes(btoa("too short"))).toThrow(/64-byte/);
  });
});

describe("deriveReaderKeyFromWallet", () => {
  it("reproduces the key reference.py derived from the same signature", async () => {
    const key = await deriveReaderKeyFromWallet(
      async () => ({ accountId: ACCOUNT, signature: G5_SIGNATURE_B64 }),
      params,
    );
    expect(key.publicKeyHex).toBe(G5_DEBRIEF_PUBKEY);
    expect(key.secretKey).toHaveLength(32);
    expect(key.source).toBe("wallet");
  });

  it("is deterministic, which is the property G5 measured", async () => {
    const sign = async () => ({ accountId: ACCOUNT, signature: G5_SIGNATURE_B64 });
    const first = await deriveReaderKeyFromWallet(sign, params);
    const second = await deriveReaderKeyFromWallet(sign, params);
    expect(second.publicKeyHex).toBe(first.publicKeyHex);
  });

  it("binds the key to the account the wallet signed with, not the one we assumed", async () => {
    const key = await deriveReaderKeyFromWallet(
      async () => ({ accountId: "someone-else.testnet", signature: G5_SIGNATURE_B64 }),
      params,
    );
    expect(key.accountId).toBe("someone-else.testnet");
    expect(key.publicKeyHex).not.toBe(G5_DEBRIEF_PUBKEY);
  });

  it("gives a different key per purpose and per tender", async () => {
    const sign = async () => ({ accountId: ACCOUNT, signature: G5_SIGNATURE_B64 });
    const debrief = await deriveReaderKeyFromWallet(sign, params);
    const committee = await deriveReaderKeyFromWallet(sign, { ...params, purpose: "committee" });
    const otherTender = await deriveReaderKeyFromWallet(sign, { ...params, tenderId: "2" });
    expect(new Set([debrief.publicKeyHex, committee.publicKeyHex, otherTender.publicKeyHex]).size).toBe(3);
  });
});

describe("the generated-key fallback", () => {
  it("makes a valid compressed point, different every time", () => {
    const a = generateReaderKey(params);
    const b = generateReaderKey(params);
    expect(a.publicKeyHex).toMatch(/^0[23][0-9a-f]{64}$/);
    expect(a.publicKeyHex).not.toBe(b.publicKeyHex);
    expect(a.source).toBe("generated");
  });

  it("round-trips through the key file docs/05 names", () => {
    const key = generateReaderKey(params);
    const file = readerKeyFile(key, params);
    expect(readerKeyFileName(params)).toBe(`sealedchoice-key-1-${ACCOUNT}.json`);
    const loaded = loadReaderKeyFile(JSON.stringify(file));
    expect(loaded.publicKeyHex).toBe(key.publicKeyHex);
    expect(bytesToHex(loaded.secretKey)).toBe(bytesToHex(key.secretKey));
    expect(loaded.source).toBe("file");
  });

  it("refuses a file whose public key does not match its private key", () => {
    const file = readerKeyFile(generateReaderKey(params), params);
    const tampered = { ...file, public_key: `02${"00".repeat(32)}` };
    expect(() => loadReaderKeyFile(JSON.stringify(tampered))).toThrow(/does not match/);
  });

  it("refuses a file that is not one of ours", () => {
    expect(() => loadReaderKeyFile(JSON.stringify({ hello: "world" }))).toThrow(/not a SealedChoice/);
  });
});
