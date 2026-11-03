// Runtime validation that mirrors specs/schemas/*.schema.json (JSON Schema 2020-12).
// The JSON Schemas are the source of truth; schemas.test.ts runs the same samples
// through both and lists every place where code adds a rule the JSON Schema cannot
// express (weights sum, unique ids, UTF-8 byte limits).
import { z } from "zod";
import { BP, COMPACT_RESULT_MAX_ENTRIES, QUAL_MAX, TEXT_LIMITS_BYTES } from "./limits.ts";

const utf8 = new TextEncoder();

/** UTF-8 byte length (the unit of the bid text limits). */
export function utf8Length(s: string): number {
  return utf8.encode(s).length;
}

/** JSON Schema minLength/maxLength count code points, not UTF-16 units. */
function codePoints(s: string): number {
  return Array.from(s).length;
}

function text(min: number, max?: number) {
  return z.string().refine((s) => {
    const n = codePoints(s);
    return n >= min && (max === undefined || n <= max);
  }, max === undefined ? `must have at least ${min} characters` : `must have ${min} to ${max} characters`);
}

const POSITIVE_INT_STRING = /^[1-9][0-9]{0,29}$/;
const TENDER_ID = /^[0-9]{1,20}$/;
const HEX64 = /^[0-9a-f]{64}$/;

const hex64 = z.string().regex(HEX64, "must be 64 lowercase hex characters");
const tenderId = z.string().regex(TENDER_ID, "must be 1 to 20 digits");
const amountMinor = z.string().regex(POSITIVE_INT_STRING, "must be a positive integer string without leading zeros");

// ------------------------------------------------------------------- rubric ---

const priceCriterionSchema = z.strictObject({
  id: z.literal("price"),
  type: z.literal("price_lowest_ratio"),
  weight_bp: z.int().min(0).max(BP),
});

const anchorText = text(3, 300);

const qualitativeCriterionSchema = z.strictObject({
  id: z.string().regex(/^[a-z][a-z0-9_]{1,31}$/),
  type: z.literal("qualitative"),
  weight_bp: z.int().min(0).max(BP),
  source_fields: z.array(z.enum(["methodology", "track_record"])).min(1),
  question: text(10, 300),
  anchors: z.strictObject({
    "0": anchorText,
    "1": anchorText,
    "2": anchorText,
    "3": anchorText,
    "4": anchorText,
    "5": anchorText,
  }),
});

export const rubricSchema = z
  .strictObject({
    v: z.literal(1),
    title: text(3, 120),
    scope: text(20, 1500),
    currency: z.strictObject({
      asset: z.string(),
      decimals: z.int().min(0).max(24),
      symbol: text(0, 12),
    }),
    budget_cap_minor: amountMinor,
    max_delivery_days: z.int().min(1).max(3650),
    criteria: z.array(z.discriminatedUnion("type", [priceCriterionSchema, qualitativeCriterionSchema])).min(1).max(6),
    eligibility: z.strictObject({
      require_price_lte_cap: z.boolean(),
      require_delivery_lte_max: z.boolean(),
      required_fields: z.array(z.enum(["price_minor", "delivery_days", "methodology", "track_record"])),
    }),
    models: z
      .array(text(1))
      .length(3)
      .refine((m) => new Set(m).size === m.length, "models must be different"),
    aggregation: z.strictObject({
      qualitative: z.literal("lower_median"),
      min_valid_outputs: z.int().min(2).max(3),
      disagreement_threshold: z.int().min(1).max(QUAL_MAX),
      evidence_min_chars: z.int().min(8).max(100),
      evidence_required_from_score: z.int().min(1).max(QUAL_MAX),
      evidence_clamp_score: z.int().min(0).max(4),
    }),
    tie_break: z.tuple([z.literal("total_desc"), z.literal("price_asc"), z.literal("index_asc")]),
    award_policy: z.strictObject({
      approvals_required: z.int().min(1).max(5),
      deviation_requires_rationale: z.literal(true),
      acceptance_window_hours: z.int().min(1).max(720),
    }),
  })
  // Rules the JSON Schema states in prose only ("checked in code").
  .refine((r) => r.criteria.reduce((s, c) => s + c.weight_bp, 0) === BP, {
    message: `criteria weights must sum to ${BP} bp`,
    path: ["criteria"],
  })
  .refine((r) => new Set(r.criteria.map((c) => c.id)).size === r.criteria.length, {
    message: "criterion ids must be unique",
    path: ["criteria"],
  });

export type Rubric = z.infer<typeof rubricSchema>;
export type RubricCriterion = Rubric["criteria"][number];

// ------------------------------------------------------------ bid plaintext ---

function bytesAtMost(limit: number) {
  return (s: string) => utf8Length(s) <= limit;
}

export const bidPlaintextSchema = z.strictObject({
  v: z.literal(1),
  tender_id: tenderId,
  bidder: z.string(),
  price_minor: amountMinor,
  delivery_days: z.int().min(1),
  // Byte limits: the JSON Schema states them in prose; the evaluator marks longer bids
  // ineligible (too_long_*), so the browser refuses to build them.
  methodology: text(1).refine(bytesAtMost(TEXT_LIMITS_BYTES.methodology), {
    message: `must be at most ${TEXT_LIMITS_BYTES.methodology} UTF-8 bytes`,
  }),
  track_record: text(1).refine(bytesAtMost(TEXT_LIMITS_BYTES.track_record), {
    message: `must be at most ${TEXT_LIMITS_BYTES.track_record} UTF-8 bytes`,
  }),
  salt: z.string().regex(/^[0-9a-f]{32}$/, "must be 32 lowercase hex characters (16 bytes)"),
});

export type BidPlaintext = z.infer<typeof bidPlaintextSchema>;

// ------------------------------------------------------------- model output ---

export const modelScoreSchema = z.looseObject({
  criterion_id: z.string(),
  score: z.int().min(0).max(QUAL_MAX),
  evidence: z.array(text(0, 300)).max(3),
  missing: z.array(text(0, 200)).max(5).optional(),
  rationale: text(0, 400).optional(),
});

export const modelOutputSchema = z.looseObject({
  scores: z.array(modelScoreSchema),
});

export type ModelOutput = z.infer<typeof modelOutputSchema>;

// ----------------------------------------------------------- compact result ---

export const compactResultSchema = z.strictObject({
  v: z.literal(1),
  tid: tenderId,
  root: hex64,
  rubric: hex64,
  bundle: hex64,
  attempt: z.int().min(1).max(3),
  status: z.enum(["ok", "needs_committee", "no_eligible_bids"]),
  rk: z
    .array(z.tuple([z.int().min(0), z.int().min(0).max(BP), z.int().min(0).max(127)]))
    .min(1)
    .max(COMPACT_RESULT_MAX_ENTRIES),
});

export type CompactResult = z.infer<typeof compactResultSchema>;

// ------------------------------------------------------------------ debrief ---

export const rawCallSchema = z.looseObject({
  model: z.string(),
  chat_id: z.string(),
  request_b64: z.string(),
  response_b64: z.string(),
});

export const debriefSchema = z.looseObject({
  v: z.literal(1),
  tender_id: z.string(),
  bid_index: z.int(),
  eligible: z.boolean(),
  ineligible_reasons: z.array(z.string()).optional(),
  flags: z.int(),
  criteria: z.record(z.string(), z.unknown()),
  total_bp: z.int(),
  rank: z.int(),
  of: z.int(),
  raw_calls: z.array(rawCallSchema),
});

export type Debrief = z.infer<typeof debriefSchema>;

// ---------------------------------------------------------- evidence bundle ---

const envelopeFields = {
  recipient_pubkey: z.string(),
  ecies_b64: z.string(),
  plaintext_sha256: z.string(),
};

export const evidenceBundleSchema = z.looseObject({
  v: z.literal(1),
  tender_id: z.string(),
  contract_id: z.string(),
  evaluator: z.looseObject({
    wasm_sha256: hex64,
    source_repo: z.string(),
    source_tag: z.string(),
    outlayer_request_id: z.union([z.string(), z.int()]),
    near_block_height: z.int().optional(),
    attempt: z.int().optional(),
  }),
  rubric_hash: hex64,
  prompt_hash: hex64,
  bids_root: hex64,
  bids: z.array(
    z.looseObject({
      index: z.int(),
      bidder: z.string(),
      leaf: hex64,
      ciphertext_sha256: hex64,
      eligible: z.boolean(),
      ineligible_reasons: z.array(z.string()).optional(),
      flags: z.int(),
      total_bp: z.int(),
      rank: z.int(),
    }),
  ),
  model_calls: z.array(
    z.looseObject({
      bid_index: z.int(),
      model: z.string(),
      chat_id: z.string(),
      attempts: z.int().optional(),
      request_sha256: hex64,
      response_sha256: hex64,
      signature: z.looseObject({
        text: z.string(),
        signature: z.string(),
        signing_address: z.string(),
        signing_algo: z.string(),
        signature_kind: z.string().optional(),
      }),
      error: z.string().optional(),
    }),
  ),
  attestation: z.looseObject({
    nonce_hex: z.string(),
    reports: z.array(z.unknown()),
  }),
  result: z.record(z.string(), z.unknown()),
  debriefs: z.array(z.looseObject({ bid_index: z.int(), ...envelopeFields, error: z.string().optional() })),
  // One AES-256-GCM body, one ECIES envelope of its 32-byte key per member (D-024).
  committee_report: z.looseObject({
    cipher: z.literal("aes-256-gcm"),
    body_b64: z.string(),
    plaintext_sha256: hex64,
    keys: z.array(
      z.looseObject({
        member: z.string(),
        recipient_pubkey: z.string(),
        ecies_b64: z.string(),
        error: z.string().optional(),
      }),
    ),
  }),
});

export type EvidenceBundle = z.infer<typeof evidenceBundleSchema>;
