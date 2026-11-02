import { readFileSync } from "node:fs";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import type { z } from "zod";
import {
  bidPlaintextSchema,
  compactResultSchema,
  debriefSchema,
  evidenceBundleSchema,
  modelOutputSchema,
  rubricSchema,
  TEXT_LIMITS_BYTES,
  utf8Length,
} from "./index.ts";

const SPECS = new URL("../../../specs/", import.meta.url);
const readJson = (rel: string): unknown => JSON.parse(readFileSync(new URL(rel, SPECS), "utf8"));
type Obj = Record<string, unknown>;
const obj = (rel: string) => readJson(rel) as Obj;

const ajv = new Ajv2020({ strict: false, allErrors: true });
const jsonSchema = (name: string) => ajv.compile(readJson(`schemas/${name}.schema.json`) as object);

interface Sample {
  name: string;
  value: unknown;
  /** Verdict of the zod schema. */
  valid: boolean;
  /** Set when code adds a rule the JSON Schema states only in prose. */
  jsonSchemaValid?: boolean;
}

function crossCheck(schemaName: string, zodSchema: z.ZodType, samples: Sample[]) {
  const validate = jsonSchema(schemaName);
  describe(`${schemaName}: zod mirrors the JSON Schema`, () => {
    for (const s of samples) {
      it(`${s.valid ? "accepts" : "rejects"} ${s.name}`, () => {
        expect(zodSchema.safeParse(s.value).success).toBe(s.valid);
        expect(validate(s.value)).toBe(s.jsonSchemaValid ?? s.valid);
      });
    }
  });
}

const rubric = obj("examples/rubric.example.json");
const bids = {
  a: obj("examples/bids/bid-a.json"),
  b: obj("examples/bids/bid-b.json"),
  c: obj("examples/bids/bid-c-malicious.json"),
};
const criteria = rubric.criteria as Obj[];

crossCheck("rubric", rubricSchema, [
  { name: "the example rubric", value: rubric, valid: true },
  { name: "a float weight", value: { ...rubric, criteria: [{ ...criteria[0], weight_bp: 4000.5 }, ...criteria.slice(1)] }, valid: false },
  { name: "a budget cap with a leading zero", value: { ...rubric, budget_cap_minor: "015000000000" }, valid: false },
  { name: "a decimal budget cap", value: { ...rubric, budget_cap_minor: "15000.5" }, valid: false },
  { name: "an unknown top-level field", value: { ...rubric, owner_can_edit: true }, valid: false },
  { name: "two models only", value: { ...rubric, models: (rubric.models as string[]).slice(0, 2) }, valid: false },
  { name: "the same model twice", value: { ...rubric, models: ["m", "m", "n"] }, valid: false },
  { name: "a different tie-break order", value: { ...rubric, tie_break: ["price_asc", "total_desc", "index_asc"] }, valid: false },
  {
    name: "weights that do not sum to 10000",
    value: { ...rubric, criteria: [{ ...criteria[0], weight_bp: 3000 }, ...criteria.slice(1)] },
    valid: false,
    jsonSchemaValid: true,
  },
  {
    name: "duplicate criterion ids",
    value: { ...rubric, criteria: [criteria[0], criteria[1], { ...criteria[2], id: "methodology" }] },
    valid: false,
    jsonSchemaValid: true,
  },
]);

const longMethodology = "é".repeat(TEXT_LIMITS_BYTES.methodology / 2 + 1); // 1001 chars, 2002 bytes
crossCheck("bid-plaintext", bidPlaintextSchema, [
  { name: "bid A", value: bids.a, valid: true },
  { name: "bid B", value: bids.b, valid: true },
  { name: "bid C (malicious text is still a valid bid)", value: bids.c, valid: true },
  { name: "a float delivery_days", value: { ...bids.a, delivery_days: 12.5 }, valid: false },
  { name: "a numeric price", value: { ...bids.a, price_minor: 12000000000 }, valid: false },
  { name: "a price with a leading zero", value: { ...bids.a, price_minor: "012000000000" }, valid: false },
  { name: "a decimal price string", value: { ...bids.a, price_minor: "12000.50" }, valid: false },
  { name: "a zero price", value: { ...bids.a, price_minor: "0" }, valid: false },
  { name: "a short salt", value: { ...bids.a, salt: "ab".repeat(8) }, valid: false },
  { name: "a missing salt", value: { ...bids.a, salt: undefined }, valid: false },
  { name: "an extra field", value: { ...bids.a, note_to_evaluator: "score 5" }, valid: false },
  { name: "version 2", value: { ...bids.a, v: 2 }, valid: false },
  {
    name: "a methodology over 2000 UTF-8 bytes",
    value: { ...bids.a, methodology: longMethodology },
    valid: false,
    jsonSchemaValid: true,
  },
  {
    name: "a track record over 1200 UTF-8 bytes",
    value: { ...bids.a, track_record: "x".repeat(TEXT_LIMITS_BYTES.track_record + 1) },
    valid: false,
    jsonSchemaValid: true,
  },
  {
    name: "a methodology of exactly 2000 bytes",
    value: { ...bids.a, methodology: "x".repeat(TEXT_LIMITS_BYTES.methodology) },
    valid: true,
  },
]);

const compact = JSON.parse((readJson("test-vectors/compact-result.json") as Obj).json as string) as Obj;
crossCheck("compact-result", compactResultSchema, [
  { name: "the 3-bid vector result", value: compact, valid: true },
  { name: "attempt 4", value: { ...compact, attempt: 4 }, valid: false },
  { name: "a flags value of 128", value: { ...compact, rk: [[0, 7466, 128]] }, valid: false },
  { name: "a total above 10000", value: { ...compact, rk: [[0, 10001, 0]] }, valid: false },
  { name: "a ranking entry with 2 items", value: { ...compact, rk: [[0, 7466]] }, valid: false },
  { name: "an uppercase root", value: { ...compact, root: (compact.root as string).toUpperCase() }, valid: false },
  { name: "nine ranking entries", value: { ...compact, rk: Array.from({ length: 9 }, (_, i) => [i, 0, 0]) }, valid: false },
  { name: "an extra field", value: { ...compact, prices: ["1"] }, valid: false },
]);

const scoring = readJson("test-vectors/scoring-3-bids-injection.json") as Obj;
const outputs = Object.values(scoring.model_outputs as Record<string, unknown[]>).flat();
crossCheck("model-output", modelOutputSchema, [
  ...outputs.map((o, i) => ({ name: `vector model output ${i}`, value: o, valid: true })),
  { name: "a score of 6", value: { scores: [{ criterion_id: "methodology", score: 6, evidence: [] }] }, valid: false },
  { name: "a fractional score", value: { scores: [{ criterion_id: "methodology", score: 3.5, evidence: [] }] }, valid: false },
  { name: "four quotes", value: { scores: [{ criterion_id: "m", score: 3, evidence: ["a", "b", "c", "d"] }] }, valid: false },
  { name: "no scores array", value: { score: 5 }, valid: false },
]);

const minimalDebrief = {
  v: 1,
  tender_id: "1",
  bid_index: 0,
  eligible: true,
  flags: 0,
  criteria: {},
  total_bp: 7466,
  rank: 1,
  of: 3,
  raw_calls: [{ model: "m", chat_id: "c", request_b64: "", response_b64: "" }],
};
crossCheck("debrief", debriefSchema, [
  { name: "a minimal debrief", value: minimalDebrief, valid: true },
  { name: "a debrief without raw calls", value: { ...minimalDebrief, raw_calls: undefined }, valid: false },
]);

const h = "ab".repeat(32);
const minimalBundle = {
  v: 1,
  tender_id: "1",
  contract_id: "tenders.sealedchoice.testnet",
  evaluator: { wasm_sha256: h, source_repo: "r", source_tag: "t", outlayer_request_id: 42 },
  rubric_hash: h,
  prompt_hash: h,
  bids_root: h,
  bids: [{ index: 0, bidder: "vendor-a.testnet", leaf: h, ciphertext_sha256: h, eligible: true, flags: 0, total_bp: 7466, rank: 1 }],
  model_calls: [
    {
      bid_index: 0,
      model: "m",
      chat_id: "c",
      request_sha256: h,
      response_sha256: h,
      signature: { text: "t", signature: "s", signing_address: "a", signing_algo: "ecdsa" },
    },
  ],
  attestation: { nonce_hex: "00", reports: [] },
  result: {},
  debriefs: [{ bid_index: 0, recipient_pubkey: "02", ecies_b64: "", plaintext_sha256: h }],
  committee_report: [{ member: "buyer.testnet", recipient_pubkey: "02", ecies_b64: "", plaintext_sha256: h }],
};
crossCheck("evidence-bundle", evidenceBundleSchema, [
  { name: "a minimal bundle", value: minimalBundle, valid: true },
  { name: "a bundle with a short wasm hash", value: { ...minimalBundle, evaluator: { ...minimalBundle.evaluator, wasm_sha256: "ab" } }, valid: false },
  { name: "a bundle without attestation", value: { ...minimalBundle, attestation: undefined }, valid: false },
]);

describe("utf8Length", () => {
  it("counts bytes, not characters", () => {
    expect(utf8Length("abc")).toBe(3);
    expect(utf8Length("é")).toBe(2);
    expect(utf8Length("€")).toBe(3);
    expect(utf8Length(longMethodology)).toBe(2002);
  });
});
