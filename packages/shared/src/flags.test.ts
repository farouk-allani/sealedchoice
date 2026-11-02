import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ALL_FLAGS_MASK, FLAG_NAMES, FLAGS, decodeFlags, encodeFlags } from "./index.ts";

// The reference implementation is the source of truth for bit values.
const reference = readFileSync(new URL("../../../specs/reference/reference.py", import.meta.url), "utf8");
const referenceFlags = Object.fromEntries(
  [...reference.matchAll(/^\s+"([A-Z_]+)": 1 << (\d+),$/gm)].map((m) => [m[1], Number(m[2])]),
);

describe("FLAGS", () => {
  it("has the same names and bits as reference.py", () => {
    expect(Object.keys(referenceFlags)).toEqual(FLAG_NAMES);
    for (const name of FLAG_NAMES) {
      expect(FLAGS[name].bit).toBe(referenceFlags[name]);
      expect(FLAGS[name].value).toBe(1 << FLAGS[name].bit);
    }
  });

  it("has a plain-language meaning and effect for every flag", () => {
    for (const name of FLAG_NAMES) {
      expect(FLAGS[name].meaning.length).toBeGreaterThan(10);
      expect(FLAGS[name].effect.length).toBeGreaterThan(10);
    }
  });

  it("fits the 0..127 range of the compact result", () => {
    expect(ALL_FLAGS_MASK).toBe(127);
  });
});

describe("decodeFlags / encodeFlags", () => {
  it("decodes the malicious bid's 24 into INJECTION_SUSPECTED and DISAGREEMENT", () => {
    expect(decodeFlags(24)).toEqual(["INJECTION_SUSPECTED", "DISAGREEMENT"]);
    expect(encodeFlags(["DISAGREEMENT", "INJECTION_SUSPECTED"])).toBe(24);
  });

  it("decodes copied-ciphertext (5) and decrypt-failed (3) bids", () => {
    expect(decodeFlags(5)).toEqual(["INELIGIBLE", "ACCOUNT_MISMATCH"]);
    expect(decodeFlags(3)).toEqual(["INELIGIBLE", "DECRYPT_FAILED"]);
    expect(decodeFlags(0)).toEqual([]);
  });

  it("rejects unknown bits and non-integers", () => {
    expect(() => decodeFlags(128)).toThrow(RangeError);
    expect(() => decodeFlags(-1)).toThrow(RangeError);
    expect(() => decodeFlags(1.5)).toThrow(RangeError);
  });
});
