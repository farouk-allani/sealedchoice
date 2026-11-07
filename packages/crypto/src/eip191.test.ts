// EIP-191 recovery, pinned by signatures NEAR AI Cloud really produced (check 8, docs/06).
//
// The two vectors below are the first call to each of the demo rubric's two models, taken from
// testnet tender 3's published evidence bundle (bundle sha256
// 9e29baa049196aec787fc6186df26eca5c92b3d79aa1048647089324abcc3c9b, OutLayer request 9718). They
// are public evidence, so pinning them here costs nothing and means a refactor has to keep
// agreeing with real enclave output rather than with our own idea of it.
import { describe, expect, it } from "vitest";
import {
  SignatureFormatError,
  addressOfPublicKey,
  personalSignDigest,
  recoverPersonalSignAddress,
  verifyPersonalSign,
} from "./eip191.ts";
import { bytesToHex, utf8ToBytes } from "./bytes.ts";

const QWEN = {
  text:
    "Qwen/Qwen3.6-35B-A3B-FP8:" +
    "919c8cf00b32c0c0dce06a2bc7bbe6e6b747f21d88ecb4363bd87fa960d8fcfc:" +
    "a9559c626984ad2adbab7ee225f21e9c3d405f92cc767b5f8030ec1e1082800d",
  signature:
    "0xfa13af97f3b427dbd5a4448db9af64cd0e718c64e7df2ec7cc875db6fbf57eec" +
    "3eb46c4063f2629e90e933a3298b248e21bd0340525c0903492ba7eb6cc85beb1b",
  address: "0xfdbd7952498b333206f360d71d97a1e0961e8ddf",
};

const GLM = {
  text:
    "z-ai/glm-5.3-flash:" +
    "94d6f8ddf83f3f14a0a1348342e4a1b9e9de3dcb4913f69bd86f000a5164a5d7:" +
    "182987e807d174fc35df2dbd2b3e2a99eafbc273cb1719453a84f376384605ce",
  signature:
    "0xfd8aeaf9a7766e0a61b45482644b2ebdb11325e0a90328cd6cb547f4a1a5f0da" +
    "6433203c1da14a17af7c971cc878bce6a13c880d76addec5b6328e60314f930e1b",
  address: "0x3b753b4406613c5e70ae640508632b600424fa0c",
};

describe("personalSignDigest", () => {
  it("prefixes with the byte length, not the character count", () => {
    // "é" is two UTF-8 bytes, so the prefix must say 2. Getting this wrong only shows up on
    // non-ASCII text, which a model id or a hash never has: pin it so a rewrite cannot drift.
    const oneChar = personalSignDigest("é");
    const twoBytes = personalSignDigest(String.fromCharCode(0xc3, 0xa9));
    expect(bytesToHex(oneChar)).not.toBe(bytesToHex(twoBytes));
    expect(utf8ToBytes("é").length).toBe(2);
  });

  it("is 32 bytes", () => {
    expect(personalSignDigest(QWEN.text).length).toBe(32);
  });
});

describe("recoverPersonalSignAddress on real enclave signatures", () => {
  for (const [name, v] of [
    ["Qwen/Qwen3.6-35B-A3B-FP8", QWEN],
    ["z-ai/glm-5.3-flash", GLM],
  ] as const) {
    it(`recovers the published signing address for ${name}`, () => {
      expect(recoverPersonalSignAddress(v.text, v.signature)).toBe(v.address);
      expect(verifyPersonalSign(v.text, v.signature, v.address)).toBe(true);
    });
  }

  it("gives the two models different signing addresses", () => {
    expect(QWEN.address).not.toBe(GLM.address);
  });

  it("accepts the address in checksum casing", () => {
    const mixed = "0xFdBd7952498B333206f360d71D97a1E0961e8DdF";
    expect(verifyPersonalSign(QWEN.text, QWEN.signature, mixed)).toBe(true);
  });
});

describe("a signature that does not belong to the text", () => {
  it("fails when one hex character of the response hash changes", () => {
    const tampered = QWEN.text.replace(/d$/, "e");
    expect(tampered).not.toBe(QWEN.text);
    expect(verifyPersonalSign(tampered, QWEN.signature, QWEN.address)).toBe(false);
    // Recovery still succeeds, it just yields somebody else: that is the whole point of the check.
    expect(recoverPersonalSignAddress(tampered, QWEN.signature)).not.toBe(QWEN.address);
  });

  it("fails when the signature belongs to the other call", () => {
    expect(verifyPersonalSign(QWEN.text, GLM.signature, QWEN.address)).toBe(false);
  });

  it("fails against the other model's address", () => {
    expect(verifyPersonalSign(QWEN.text, QWEN.signature, GLM.address)).toBe(false);
  });

  it("fails when a byte of the signature is flipped", () => {
    const flipped = `${QWEN.signature.slice(0, 10)}ff${QWEN.signature.slice(12)}`;
    expect(flipped.length).toBe(QWEN.signature.length);
    expect(verifyPersonalSign(QWEN.text, flipped, QWEN.address)).toBe(false);
  });
});

describe("malformed input", () => {
  it("throws on a signature that is not 65 bytes", () => {
    expect(() => recoverPersonalSignAddress(QWEN.text, "0xdeadbeef")).toThrow(SignatureFormatError);
  });

  it("throws on an impossible recovery byte", () => {
    const bad = `${QWEN.signature.slice(0, -2)}07`;
    expect(() => recoverPersonalSignAddress(QWEN.text, bad)).toThrow(SignatureFormatError);
  });

  it("accepts a bare recovery bit as well as 27/28", () => {
    const bit = `${QWEN.signature.slice(0, -2)}00`;
    expect(recoverPersonalSignAddress(QWEN.text, bit)).toBe(QWEN.address);
  });

  it("verify never throws, it just returns false", () => {
    expect(verifyPersonalSign(QWEN.text, "nonsense", QWEN.address)).toBe(false);
    expect(verifyPersonalSign(QWEN.text, QWEN.signature, "not-an-address")).toBe(false);
    expect(verifyPersonalSign(QWEN.text, QWEN.signature, "")).toBe(false);
  });

  it("rejects a public key that is not uncompressed", () => {
    expect(() => addressOfPublicKey(new Uint8Array(33))).toThrow(SignatureFormatError);
  });
});
