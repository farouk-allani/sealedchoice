// The template is tender 3's own rubric. That makes one strong check possible: canonicalising
// it in the browser must reproduce the exact bytes the contract stored, and therefore the exact
// hash the contract computed. If it does not, /tenders/new would show a hash that is not the one
// the chain would assign, and the preview would be a lie.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { jcsString, sha256Hex, utf8ToBytes } from "@tender/crypto";
import { rubricSchema } from "@tender/shared";
import { tenderSchema } from "../lib/near/schemas.ts";
import { AVAILABLE_MODELS, RUBRIC_TEMPLATE } from "./rubric-template.ts";

const fixture = JSON.parse(
  readFileSync(fileURLToPath(new URL("../lib/near/fixtures/testnet-views.json", import.meta.url)), "utf8"),
) as Record<string, unknown>;
const tender3 = tenderSchema.parse(fixture.get_tender);

describe("the rubric template", () => {
  it("is a rubric the published schema accepts", () => {
    expect(rubricSchema.safeParse(RUBRIC_TEMPLATE).success).toBe(true);
  });

  it("canonicalises to the exact bytes tender 3 stored", () => {
    expect(jcsString(RUBRIC_TEMPLATE)).toBe(tender3.rubric_json);
  });

  it("hashes to the rubric hash the contract computed", () => {
    const hash = sha256Hex(utf8ToBytes(jcsString(RUBRIC_TEMPLATE)));
    expect(hash).toBe(tender3.rubric_hash);
    expect(hash).toBe("5667a8005b1a2e9531366dedfc63ecb031625ff64fbf16fe01a29ab37dd2080c");
  });

  it("weights come to exactly 100 percent", () => {
    expect(RUBRIC_TEMPLATE.criteria.reduce((sum, c) => sum + c.weight_bp, 0)).toBe(10_000);
  });

  it("pins the two models D-028 chose, the ones that sign provider_tee", () => {
    expect(AVAILABLE_MODELS).toEqual(["Qwen/Qwen3.6-35B-A3B-FP8", "z-ai/glm-5.3-flash"]);
  });

  it("is denominated in the token the app is configured for", () => {
    expect(RUBRIC_TEMPLATE.currency.asset).toBe("nep141:usdc.sealedchoice.testnet");
    expect(RUBRIC_TEMPLATE.currency.decimals).toBe(6);
  });
});
