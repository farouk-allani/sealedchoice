// @vitest-environment jsdom
// The package must run in a browser. test/browser-bundle.setup.ts bundles it for
// platform=browser (packages resolve their "browser" builds; a Node built-in fails the
// build); this file loads that bundle in a DOM environment and checks it against the vectors.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, inject, it } from "vitest";
import type * as CryptoModuleNs from "./index.ts";

// Plain paths: in the jsdom environment `URL` is jsdom's class, which node:fs does not accept.
const SPECS = join(dirname(fileURLToPath(import.meta.url)), "../../../specs");
const readJson = (rel: string): unknown => JSON.parse(readFileSync(join(SPECS, rel), "utf8"));

type CryptoModule = typeof CryptoModuleNs;

describe("browser build", () => {
  const bundle = inject("browserBundle");

  it("runs in a DOM environment", () => {
    expect("document" in globalThis && "window" in globalThis).toBe(true);
    expect(typeof globalThis.crypto.getRandomValues).toBe("function");
  });

  it("bundles without Node built-ins and uses the browser AES build", () => {
    expect(bundle.inputs.filter((p) => p.startsWith("node:"))).toEqual([]);
    expect(bundle.inputs.some((p) => p.includes("@ecies/ciphers/dist/aes/noble.js"))).toBe(true);
    expect(bundle.inputs.some((p) => p.includes("@ecies/ciphers/dist/aes/node.js"))).toBe(false);
  });

  it("decrypts the ECIES vectors, derives the vector keys and round-trips a bid", async () => {
    const m = (await import(/* @vite-ignore */ bundle.file)) as CryptoModule;

    const ecies = readJson("test-vectors/ecies-decrypt.json") as {
      tender_sk_hex: string;
      tender_pk_compressed_hex: string;
      cases: { plaintext_jcs_sha256: string; ciphertext_b64: string }[];
    };
    for (const c of ecies.cases) {
      expect(m.sha256Hex(m.eciesDecrypt(ecies.tender_sk_hex, m.fromBase64(c.ciphertext_b64)))).toBe(c.plaintext_jcs_sha256);
    }

    const keys = readJson("test-vectors/hashes-and-keys.json") as {
      rubric_jcs_sha256: string;
      debrief_key: { signature_hex: string; pk_compressed_hex: string };
    };
    const sk = m.readerKey(m.hexToBytes(keys.debrief_key.signature_hex), "debrief", "tenders.sealedchoice.testnet", "1", "vendor-a.testnet");
    expect(m.bytesToHex(m.publicKeyCompressed(sk))).toBe(keys.debrief_key.pk_compressed_hex);
    expect(m.sha256Hex(m.jcs(readJson("examples/rubric.example.json")))).toBe(keys.rubric_jcs_sha256);

    const bidA = readJson("examples/bids/bid-a.json") as Parameters<CryptoModule["buildBidPlaintext"]>[0];
    const built = m.buildBidPlaintext(bidA); // its own v and salt are replaced by the builder's
    expect(built.plaintext.salt).not.toBe((bidA as { salt?: string }).salt);
    const ct = m.eciesEncrypt(ecies.tender_pk_compressed_hex, built.bytes);
    expect(m.eciesDecrypt(ecies.tender_sk_hex, ct)).toEqual(built.bytes);
  });
});
