import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { TEXT_LIMITS_BYTES } from "@tender/shared";
import {
  BidValidationError,
  bytesToHex,
  buildBidPlaintext,
  eciesDecrypt,
  eciesEncrypt,
  fromBase64,
  isCompressedPublicKeyHex,
  JcsError,
  jcs,
  jcsString,
  publicKeyCompressed,
  randomSaltHex,
  toBase64,
  u32le,
  u64le,
  utf8ToBytes,
} from "./index.ts";

const SPECS = new URL("../../../specs/", import.meta.url);
const bidA = JSON.parse(readFileSync(new URL("examples/bids/bid-a.json", SPECS), "utf8")) as Record<string, unknown>;
const keys = JSON.parse(readFileSync(new URL("test-vectors/hashes-and-keys.json", SPECS), "utf8")) as {
  tender_key: { sk_hex: string; pk_compressed_hex: string };
};

describe("jcs", () => {
  it("sorts keys and uses no whitespace", () => {
    expect(jcsString({ b: 1, a: [true, null, "x"], c: { z: 0, y: -2 } })).toBe('{"a":[true,null,"x"],"b":1,"c":{"y":-2,"z":0}}');
  });

  it("keeps non-ASCII text as UTF-8 and escapes control characters like the reference", () => {
    expect(jcsString({ s: "é \n\t\u0001\"\\" })).toBe('{"s":"é \\n\\t\\u0001\\"\\\\"}');
    expect(jcs("é")).toEqual(utf8ToBytes('"é"'));
  });

  it("rejects floats, unsafe integers and non-JSON values", () => {
    expect(() => jcs({ price: 1.5 })).toThrow(JcsError);
    expect(() => jcs({ price: 1.5 })).toThrow(/floats/);
    expect(() => jcs({ n: 2 ** 53 })).toThrow(/safe range/);
    expect(() => jcs({ n: Number.NaN })).toThrow(JcsError);
    expect(() => jcs({ n: 1n })).toThrow(JcsError);
    expect(() => jcs({ u: undefined })).toThrow(JcsError);
    expect(() => jcs({ d: new Date(0) })).toThrow(/plain objects/);
    expect(() => jcs({ "clé": 1 })).toThrow(/ASCII/);
  });
});

describe("byte helpers", () => {
  it("encodes little-endian integers", () => {
    expect(bytesToHex(u32le(16))).toBe("10000000");
    expect(bytesToHex(u64le(1762000000000000000n))).toBe("00003d1eaae17318"); // python: (1762000000000000000).to_bytes(8, "little").hex()
    expect(() => u32le(-1)).toThrow(RangeError);
    expect(() => u64le(2n ** 64n)).toThrow(RangeError);
  });

  it("round-trips base64", () => {
    const b = Uint8Array.from({ length: 300 }, (_, i) => i % 256);
    expect(fromBase64(toBase64(b))).toEqual(b);
    expect(toBase64(utf8ToBytes("hi"))).toBe("aGk=");
  });
});

describe("ECIES round trip", () => {
  it("encrypts to the compressed tender key and decrypts with its secret", () => {
    const msg = utf8ToBytes("sealed bid bytes");
    const ct = eciesEncrypt(keys.tender_key.pk_compressed_hex, msg);
    expect(ct.length).toBe(msg.length + 97);
    expect(ct[0]).toBe(0x04);
    expect(eciesDecrypt(keys.tender_key.sk_hex, ct)).toEqual(msg);
  });

  it("produces a different ciphertext each time (fresh ephemeral key and nonce)", () => {
    const msg = utf8ToBytes("same");
    const a = eciesEncrypt(keys.tender_key.pk_compressed_hex, msg);
    const b = eciesEncrypt(keys.tender_key.pk_compressed_hex, msg);
    expect(bytesToHex(a)).not.toBe(bytesToHex(b));
  });

  it("refuses a ciphertext shorter than the overhead", () => {
    expect(() => eciesDecrypt(keys.tender_key.sk_hex, new Uint8Array(96))).toThrow(RangeError);
  });
});

describe("isCompressedPublicKeyHex", () => {
  it("accepts derived keys and rejects malformed ones", () => {
    expect(isCompressedPublicKeyHex(keys.tender_key.pk_compressed_hex)).toBe(true);
    expect(isCompressedPublicKeyHex(bytesToHex(publicKeyCompressed(new Uint8Array(32).fill(7))))).toBe(true);
    expect(isCompressedPublicKeyHex(`04${"00".repeat(64)}`)).toBe(false);
    expect(isCompressedPublicKeyHex(`02${"00".repeat(32)}`)).toBe(false); // x = 0 is not on the curve
    expect(isCompressedPublicKeyHex(keys.tender_key.pk_compressed_hex.toUpperCase())).toBe(false);
  });
});

describe("buildBidPlaintext", () => {
  const input = {
    tender_id: bidA.tender_id as string,
    bidder: bidA.bidder as string,
    price_minor: bidA.price_minor as string,
    delivery_days: bidA.delivery_days as number,
    methodology: bidA.methodology as string,
    track_record: bidA.track_record as string,
  };

  it("reproduces bid A's JCS bytes when given its salt", () => {
    const built = buildBidPlaintext(input, bidA.salt as string);
    expect(built.plaintext).toEqual(bidA);
    expect(built.bytes).toEqual(jcs(bidA));
  });

  it("draws a fresh 16-byte salt by default", () => {
    const a = buildBidPlaintext(input);
    const b = buildBidPlaintext(input);
    expect(a.plaintext.salt).toMatch(/^[0-9a-f]{32}$/);
    expect(a.plaintext.salt).not.toBe(b.plaintext.salt);
    expect(randomSaltHex()).toMatch(/^[0-9a-f]{32}$/);
  });

  it("rejects a float, a bad price string and a too-long methodology", () => {
    expect(() => buildBidPlaintext({ ...input, delivery_days: 10.5 })).toThrow(BidValidationError);
    expect(() => buildBidPlaintext({ ...input, price_minor: "12,000" })).toThrow(/price_minor/);
    expect(() => buildBidPlaintext({ ...input, methodology: "x".repeat(TEXT_LIMITS_BYTES.methodology + 1) })).toThrow(
      /methodology: must be at most 2000 UTF-8 bytes/,
    );
  });

  it("refuses text within the byte limits whose JSON escaping overflows the ciphertext limit", () => {
    // 2000 newlines are 2000 bytes of text but 4000 bytes of JCS ("\\n" each).
    expect(() =>
      buildBidPlaintext({
        ...input,
        methodology: "\n".repeat(TEXT_LIMITS_BYTES.methodology),
        track_record: "x".repeat(TEXT_LIMITS_BYTES.track_record),
      }),
    ).toThrow(/encrypted bid would be \d+ bytes \(max 4500\)/);
  });

  it("fits the largest valid bid under the contract's ciphertext limit", () => {
    const built = buildBidPlaintext({
      ...input,
      price_minor: "9".repeat(30),
      delivery_days: 3650,
      methodology: "é".repeat(TEXT_LIMITS_BYTES.methodology / 2),
      track_record: "x".repeat(TEXT_LIMITS_BYTES.track_record),
    });
    expect(built.bytes.length + 97).toBeLessThanOrEqual(4500);
  });
});
