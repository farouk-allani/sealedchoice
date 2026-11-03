// docs/06 check 1: hash untrusted JSON text only if it is its own JCS form (D-017).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { jcsString } from "@tender/crypto";
import { describe, expect, it } from "vitest";
import { NotCanonicalError, isCanonicalJson, sha256OfCanonicalJson } from "./canonical.ts";

const SPECS = join(dirname(fileURLToPath(import.meta.url)), "../../../specs");
const read = (rel: string): string => readFileSync(join(SPECS, rel), "utf8");

describe("sha256OfCanonicalJson", () => {
  it("hashes the example rubric's JCS to the vector", () => {
    const v = JSON.parse(read("test-vectors/hashes-and-keys.json")) as { rubric_jcs_sha256: string; rubric_jcs_length: number };
    const text = jcsString(JSON.parse(read("examples/rubric.example.json")));
    expect(new TextEncoder().encode(text).length).toBe(v.rubric_jcs_length);
    expect(sha256OfCanonicalJson(text)).toBe(v.rubric_jcs_sha256);
  });

  it("accepts the compact-result vector as stored on chain", () => {
    const v = JSON.parse(read("test-vectors/compact-result.json")) as { json: string };
    expect(isCanonicalJson(v.json)).toBe(true);
  });

  it.each([
    ["a float JSON.parse would turn into an integer", '{"a":5.0}'],
    ["an exponent", '{"a":1e2}'],
    ["an integer beyond 2^53", '{"a":9007199254740993}'],
    ["whitespace", '{"a": 1}'],
    ["unsorted keys", '{"b":1,"a":2}'],
    ["a duplicate key", '{"a":1,"a":1}'],
    ["an escaped character JCS writes literally", '{"a":"\\u00e9"}'],
    ["not JSON", "{a:1}"],
    ["a lone surrogate (JSON.stringify writes it back the same way)", '{"a":"\\ud800"}'],
    ["a lone surrogate in a key", '{"\\udc00":1}'],
  ])("refuses %s", (_name, text) => {
    expect(isCanonicalJson(text)).toBe(false);
    expect(() => sha256OfCanonicalJson(text)).toThrow(NotCanonicalError);
  });

  it("accepts canonical text with non-ASCII string values", () => {
    expect(isCanonicalJson('{"a":"é","b":[1,-2,true,null]}')).toBe(true);
  });
});
