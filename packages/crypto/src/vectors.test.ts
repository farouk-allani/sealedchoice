// Every case in specs/test-vectors/{merkle,hashes-and-keys,ecies-decrypt}.json, loaded by relative path.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  bytesToHex,
  eciesDecrypt,
  fromBase64,
  hexToBytes,
  hkdfSha256,
  jcs,
  keyDerivationMessage,
  merkleLeaf,
  merkleProof,
  merkleRoot,
  merkleVerify,
  nep413Nonce,
  publicKeyCompressed,
  readerKey,
  sha256Hex,
  utf8ToBytes,
  type ProofStep,
} from "./index.ts";
import { tenderKey } from "./testing.ts";

const SPECS = new URL("../../../specs/", import.meta.url);
const readText = (rel: string) => readFileSync(new URL(rel, SPECS), "utf8");

/** JSON.parse that keeps integers beyond 2^53 exact (as bigint), via the reviver's source text. */
function parseExact<T>(text: string): T {
  const parse = JSON.parse as (t: string, r: (k: string, v: unknown, ctx?: { source?: string }) => unknown) => unknown;
  return parse(text, (_k, v, ctx) => {
    if (typeof v === "number" && !Number.isSafeInteger(v) && Number.isInteger(v)) {
      if (ctx?.source === undefined) throw new Error("JSON.parse source text access is not available");
      return BigInt(ctx.source);
    }
    return v;
  }) as T;
}

interface MerkleVectors {
  leaves_input: { bidder: string; submitted_at_ns: number | bigint; ciphertext_utf8: string }[];
  leaves: string[];
  trees: { n: number; root: string; proofs: Record<string, ProofStep[]> }[];
}

describe("merkle.json", () => {
  const v = parseExact<MerkleVectors>(readText("test-vectors/merkle.json"));
  const leaves = v.leaves_input.map((x) => merkleLeaf(x.bidder, BigInt(x.submitted_at_ns), utf8ToBytes(x.ciphertext_utf8)));

  it("reproduces every leaf", () => {
    expect(leaves.map(bytesToHex)).toEqual(v.leaves);
  });

  for (const tree of v.trees) {
    describe(`${tree.n} leaves`, () => {
      const subset = leaves.slice(0, tree.n);

      it("reproduces the root", () => {
        expect(bytesToHex(merkleRoot(subset))).toBe(tree.root);
      });

      it("reproduces every proof and each proof verifies", () => {
        for (let i = 0; i < tree.n; i++) {
          const proof = merkleProof(subset, i);
          expect(proof).toEqual(tree.proofs[String(i)]);
          expect(merkleVerify(subset[i] as Uint8Array, proof, hexToBytes(tree.root))).toBe(true);
        }
      });

      it("rejects a proof for the wrong leaf", () => {
        if (tree.n < 2) return;
        const proof = merkleProof(subset, 0);
        expect(merkleVerify(subset[1] as Uint8Array, proof, hexToBytes(tree.root))).toBe(false);
      });
    });
  }

  it("refuses an empty set and an out-of-range index", () => {
    expect(() => merkleRoot([])).toThrow(RangeError);
    expect(() => merkleProof(leaves, 5)).toThrow(RangeError);
  });

  it("separates the bidder from the timestamp (length prefix)", () => {
    const ct = utf8ToBytes("x");
    expect(bytesToHex(merkleLeaf("ab", 1n, ct))).not.toBe(bytesToHex(merkleLeaf("a", 1n, ct)));
  });
});

interface KeyCase {
  salt: string;
  info: string;
  sk_hex: string;
  pk_compressed_hex: string;
}
interface HashesAndKeys {
  rubric_jcs_sha256: string;
  rubric_jcs_length: number;
  tender_key: KeyCase & { master_secret_hex: string };
  debrief_key: KeyCase & { signature_hex: string };
  committee_key: KeyCase & { signature_hex: string };
  nep413_message: string;
  nep413_nonce_hex: string;
  nep413_recipient: string;
}

describe("hashes-and-keys.json", () => {
  const v = JSON.parse(readText("test-vectors/hashes-and-keys.json")) as HashesAndKeys;
  const contract = v.nep413_recipient;

  it("hashes the example rubric to rubric_jcs_sha256", () => {
    const rubric: unknown = JSON.parse(readText("examples/rubric.example.json"));
    const bytes = jcs(rubric);
    expect(bytes.length).toBe(v.rubric_jcs_length);
    expect(sha256Hex(bytes)).toBe(v.rubric_jcs_sha256);
  });

  it("derives the tender key from the fake master secret", () => {
    const k = v.tender_key;
    expect(k.info).toBe(`${contract}:1`);
    const sk = tenderKey(hexToBytes(k.master_secret_hex), contract, "1");
    expect(bytesToHex(sk)).toBe(k.sk_hex);
    expect(bytesToHex(publicKeyCompressed(sk))).toBe(k.pk_compressed_hex);
  });

  it("derives the debrief key from the fake signature", () => {
    const k = v.debrief_key;
    expect(k.info).toBe(`${contract}:1:vendor-a.testnet`);
    const sk = readerKey(hexToBytes(k.signature_hex), "debrief", contract, "1", "vendor-a.testnet");
    expect(bytesToHex(sk)).toBe(k.sk_hex);
    expect(bytesToHex(publicKeyCompressed(sk))).toBe(k.pk_compressed_hex);
  });

  it("derives the committee key from the fake signature", () => {
    const k = v.committee_key;
    expect(k.info).toBe(`${contract}:1:buyer.testnet`);
    const sk = readerKey(hexToBytes(k.signature_hex), "committee", contract, "1", "buyer.testnet");
    expect(bytesToHex(sk)).toBe(k.sk_hex);
    expect(bytesToHex(publicKeyCompressed(sk))).toBe(k.pk_compressed_hex);
  });

  it("builds the NEP-413 message and nonce", () => {
    const msg = keyDerivationMessage(contract, "1", "debrief");
    expect(msg).toBe(v.nep413_message);
    expect(bytesToHex(nep413Nonce(msg))).toBe(v.nep413_nonce_hex);
  });

  it("keeps salts as specified", () => {
    expect([v.tender_key.salt, v.debrief_key.salt, v.committee_key.salt]).toEqual([
      "sealedchoice/tender-key/v1",
      "sealedchoice/debrief-key/v1",
      "sealedchoice/committee-key/v1",
    ]);
  });

  it("matches RFC 5869 test case 1 for HKDF-SHA256", () => {
    const okm = hkdfSha256(
      hexToBytes("0b".repeat(22)),
      hexToBytes("000102030405060708090a0b0c"),
      hexToBytes("f0f1f2f3f4f5f6f7f8f9"),
      42,
    );
    expect(bytesToHex(okm)).toBe(
      "3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf34007208d5b887185865",
    );
  });

  it("rejects a reader-key signature that is not 64 bytes", () => {
    expect(() => readerKey(new Uint8Array(32), "debrief", contract, "1", "a.testnet")).toThrow(RangeError);
  });
});

interface EciesVectors {
  tender_sk_hex: string;
  tender_pk_compressed_hex: string;
  cases: { bid_file: string; plaintext_jcs_sha256: string; ciphertext_b64: string }[];
}

describe("ecies-decrypt.json", () => {
  const v = JSON.parse(readText("test-vectors/ecies-decrypt.json")) as EciesVectors;
  const keys = JSON.parse(readText("test-vectors/hashes-and-keys.json")) as HashesAndKeys;

  it("uses the tender key from hashes-and-keys.json", () => {
    expect(v.tender_sk_hex).toBe(keys.tender_key.sk_hex);
    expect(v.tender_pk_compressed_hex).toBe(keys.tender_key.pk_compressed_hex);
  });

  it("has the three example bids", () => {
    expect(v.cases.map((c) => c.bid_file)).toEqual([
      "examples/bids/bid-a.json",
      "examples/bids/bid-b.json",
      "examples/bids/bid-c-malicious.json",
    ]);
  });

  for (const c of v.cases) {
    it(`decrypts ${c.bid_file} to its JCS bytes`, () => {
      const ct = fromBase64(c.ciphertext_b64);
      expect(ct[0]).toBe(0x04); // uncompressed ephemeral key
      const pt = eciesDecrypt(v.tender_sk_hex, ct);
      expect(sha256Hex(pt)).toBe(c.plaintext_jcs_sha256);
      expect(bytesToHex(pt)).toBe(bytesToHex(jcs(JSON.parse(readText(c.bid_file)))));
      expect(ct.length).toBe(pt.length + 97);
    });
  }

  it("fails on a flipped ciphertext byte (AES-GCM tag)", () => {
    const ct = fromBase64((v.cases[0] as EciesVectors["cases"][number]).ciphertext_b64);
    ct[ct.length - 1] = (ct[ct.length - 1] as number) ^ 1;
    expect(() => eciesDecrypt(v.tender_sk_hex, ct)).toThrow();
  });

  it("fails with another key", () => {
    const ct = fromBase64((v.cases[0] as EciesVectors["cases"][number]).ciphertext_b64);
    expect(() => eciesDecrypt(keys.debrief_key.sk_hex, ct)).toThrow();
  });
});
