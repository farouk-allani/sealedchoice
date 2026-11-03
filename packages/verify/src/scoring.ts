// Scoring core, ported line by line from specs/reference/reference.py ("scoring" section) and
// checked against specs/test-vectors/scoring-*.json, like evaluator/core in Rust. Pure: no I/O.
// Integers only; prices and weighted products are bigint. Inputs keep JSON number kinds
// (`parseJson` in json.ts), so `12.0` is a float and `2^53` stays exact, as in Python.
import { jcs } from "@tender/crypto";
import {
  BP,
  COMPACT_RESULT_MAX_BYTES,
  FLAGS as FLAG_INFO,
  QUAL_MAX,
  type Rubric,
  type RubricCriterion,
  TEXT_LIMITS_BYTES,
} from "@tender/shared";
import { type Json, JsonFloat, JsonInt, JsonObject } from "./json.ts";

export const FLAG = {
  INELIGIBLE: FLAG_INFO.INELIGIBLE.value,
  DECRYPT_FAILED: FLAG_INFO.DECRYPT_FAILED.value,
  ACCOUNT_MISMATCH: FLAG_INFO.ACCOUNT_MISMATCH.value,
  INJECTION_SUSPECTED: FLAG_INFO.INJECTION_SUSPECTED.value,
  DISAGREEMENT: FLAG_INFO.DISAGREEMENT.value,
  EVIDENCE_MISSING: FLAG_INFO.EVIDENCE_MISSING.value,
  EVAL_INCOMPLETE: FLAG_INFO.EVAL_INCOMPLETE.value,
} as const;

/** Largest integer every implementation represents exactly (D-017). */
export const MAX_SAFE_INT = 2n ** 53n - 1n;
const QUAL_BP_PER_POINT = BP / QUAL_MAX;
const BP_N = BigInt(BP);

// reference.py INJECTION_PATTERNS, flags IGNORECASE | DOTALL | ASCII. Without the `u` flag a
// JavaScript regex treats \b, \w, \s and case-insensitivity the ASCII way, and the text they run on
// is ASCII after `asciiFold`, so all three implementations flag the same bids (D-019).
export const INJECTION_PATTERNS: readonly RegExp[] = [
  /\bignore\b.{0,20}\b(previous|prior|above|earlier)\b.{0,20}\b(instructions?|prompts?|rules)\b/is,
  /\b(note|message|instructions?)\s+to\s+the\s+(evaluator|judge|grader|model|ai)\b/is,
  /\b(you are|act as)\b.{0,20}\b(evaluator|judge|grader|assistant|system)\b/is,
  /\b(score|rate|grade)\b.{0,40}\b(5|five|maximum|max|highest|full marks|10\/10|5\/5)\b/is,
  /<\/?\s*(system|assistant|instructions?|proposal)[^>]*>/is,
  /=====\s*(begin|end)\s+proposal/is,
];

// Python's str.isspace(): Unicode White_Space plus U+001C–U+001F (evaluator/core `is_py_space`).
// Python's `\s` and `strip()` use the same set; JavaScript's `\s` differs (U+FEFF, U+001C–U+001F).
const PY_SPACE = "\\t\\n\\v\\f\\r\\x1c-\\x20\\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";
const SPACE_RUNS = new RegExp(`[${PY_SPACE}]+`, "g");
const EDGES = new RegExp(`^[${PY_SPACE}]+|[${PY_SPACE}]+$`, "g");

const pyStrip = (s: string): string => s.replace(EDGES, "");
/** Length in code points, as Python's len(). */
const cpLen = (s: string): number => [...s].length;
const utf8Len = (s: string): number => new TextEncoder().encode(s).length;

/** NFC, lowercase, whitespace runs → one space, trimmed (reference.py `norm`). */
export function norm(s: string): string {
  return pyStrip(s.normalize("NFC").toLowerCase().replace(SPACE_RUNS, " "));
}

/** NFKD, then only code points < 128 (reference.py `ascii_fold`, D-019). */
export function asciiFold(s: string): string {
  let out = "";
  for (const c of s.normalize("NFKD")) if ((c.codePointAt(0) ?? 128) < 128) out += c;
  return out;
}

export function injectionSuspected(texts: readonly string[]): boolean {
  const joined = asciiFold(texts.join("\n"));
  return INJECTION_PATTERNS.some((p) => p.test(joined));
}

/** The string, or "" when absent or not a string (non-strings are already `bad_<field>`). */
export function textField(p: JsonObject, f: string): string {
  const v = p.get(f);
  return typeof v === "string" ? v : "";
}

/** JSON integer within ±MAX_SAFE_INT; a bool or a float is never one (D-017). */
export function isInt(v: Json | undefined): v is JsonInt {
  return v instanceof JsonInt && v.value >= -MAX_SAFE_INT && v.value <= MAX_SAFE_INT;
}

export function isPosIntStr(s: Json | undefined): s is string {
  return typeof s === "string" && /^[1-9][0-9]{0,29}$/.test(s);
}

/** Python's `v == 1` for a JSON value: the integer 1 or any float equal to it, never `true`. */
function equalsOne(v: Json | undefined): boolean {
  if (v instanceof JsonInt) return v.value === 1n;
  if (v instanceof JsonFloat) return v.value === 1;
  return false;
}

export interface BidInput {
  readonly index: number;
  readonly submitter: string;
  readonly decrypt_ok: boolean;
  /** The decrypted plaintext as parsed by `parseJson`; null when it did not decrypt. */
  readonly plaintext: Json;
}

export function checkEligibility(rubric: Rubric, tenderId: string, bid: BidInput): [number, string[]] {
  if (!bid.decrypt_ok) return [FLAG.INELIGIBLE | FLAG.DECRYPT_FAILED, ["decrypt_failed"]];
  const p = bid.plaintext;
  const reasons: string[] = [];
  let flags = 0;
  if (!(p instanceof JsonObject) || !equalsOne(p.get("v"))) return [FLAG.INELIGIBLE, ["bad_version"]];
  if (p.get("tender_id") !== tenderId) reasons.push("wrong_tender");
  if (p.get("bidder") !== bid.submitter) {
    flags |= FLAG.ACCOUNT_MISMATCH;
    reasons.push("account_mismatch");
  }
  for (const f of rubric.eligibility.required_fields) {
    const v = p.get(f);
    if (v === undefined || v === null || (typeof v === "string" && pyStrip(v) === "")) {
      reasons.push(`missing_${f}`);
    }
  }
  const price = p.get("price_minor");
  if (!isPosIntStr(price)) reasons.push("bad_price");
  const dd = p.get("delivery_days");
  if (!(isInt(dd) && dd.value >= 1n)) reasons.push("bad_delivery_days");
  for (const [f, lim] of Object.entries(TEXT_LIMITS_BYTES)) {
    const v = p.get(f);
    if (v !== undefined && v !== null && typeof v !== "string") reasons.push(`bad_${f}`);
    else if (typeof v === "string" && utf8Len(v) > lim) reasons.push(`too_long_${f}`);
  }
  if (reasons.length === 0) {
    const el = rubric.eligibility;
    // No reason so far: price is a positive integer string and delivery a safe integer ≥ 1.
    if (el.require_price_lte_cap && BigInt(price as string) > BigInt(rubric.budget_cap_minor)) {
      reasons.push("over_budget_cap");
    }
    if (el.require_delivery_lte_max && (dd as JsonInt).value > BigInt(rubric.max_delivery_days)) {
      reasons.push("over_max_delivery");
    }
  }
  if (reasons.length > 0) flags |= FLAG.INELIGIBLE;
  return [flags, reasons];
}

/** (score, evidence) for one criterion from one model output, or null when missing or invalid. */
export function modelCriterion(output: Json, criterionId: string): [number, string[]] | null {
  if (!(output instanceof JsonObject)) return null;
  const scores = output.get("scores");
  if (!Array.isArray(scores)) return null;
  for (const e of scores) {
    if (e instanceof JsonObject && e.get("criterion_id") === criterionId) {
      const s = e.get("score");
      const ev = e.entries.has("evidence") ? e.get("evidence") : [];
      if (!(s instanceof JsonInt && s.value >= 0n && s.value <= BigInt(QUAL_MAX))) return null;
      if (!(Array.isArray(ev) && ev.every((q) => typeof q === "string"))) return null;
      return [Number(s.value), ev as string[]];
    }
  }
  return null;
}

export type ModelDetail =
  | { model: number; valid: false }
  | { model: number; valid: true; raw: number; score: number; valid_quotes: number; clamped: boolean };

type Qualitative = Extract<RubricCriterion, { type: "qualitative" }>;

export function scoreQualitative(
  rubric: Rubric,
  crit: Qualitative,
  plaintext: JsonObject,
  outputs: readonly Json[],
): { bp: number; median: number | null; models: ModelDetail[]; flags: number } {
  const agg = rubric.aggregation;
  const source = norm(crit.source_fields.map((f) => textField(plaintext, f)).join("\n"));
  const detail: ModelDetail[] = [];
  const valid: number[] = [];
  let flags = 0;
  outputs.forEach((out, m) => {
    const got = modelCriterion(out, crit.id);
    if (got === null) {
      detail.push({ model: m, valid: false });
      return;
    }
    const [raw, ev] = got;
    const good = ev.filter((q) => cpLen(norm(q)) >= agg.evidence_min_chars && source.includes(norm(q)));
    let score = raw;
    let clamped = false;
    if (raw >= agg.evidence_required_from_score && good.length === 0) {
      score = Math.min(raw, agg.evidence_clamp_score); // never raises a score (D-019)
      clamped = true;
      flags |= FLAG.EVIDENCE_MISSING;
    }
    detail.push({ model: m, valid: true, raw, score, valid_quotes: good.length, clamped });
    valid.push(score);
  });
  if (valid.length < agg.min_valid_outputs) {
    return { bp: 0, median: null, models: detail, flags: flags | FLAG.EVAL_INCOMPLETE };
  }
  const srt = [...valid].sort((a, b) => a - b);
  const med = srt[Math.floor((srt.length - 1) / 2)] as number; // lower median
  if ((srt[srt.length - 1] as number) - (srt[0] as number) >= agg.disagreement_threshold) {
    flags |= FLAG.DISAGREEMENT;
  }
  return { bp: med * QUAL_BP_PER_POINT, median: med, models: detail, flags };
}

export type CriterionResult = { bp: number } | { bp: number; median: number | null; models: ModelDetail[] };

export interface BidResult {
  index: number;
  flags: number;
  reasons: string[];
  eligible: boolean;
  criteria: Record<string, CriterionResult>;
  total_bp: number;
}

export interface Evaluation {
  status: "ok" | "needs_committee" | "no_eligible_bids";
  lowest_eligible_price_minor: string | null;
  bids: BidResult[];
  /** [index, total_bp, flags]: eligible by total desc, price asc, index asc; then ineligible by index. */
  ranking: [number, number, number][];
}

export class ScoringInputError extends Error {
  override name = "ScoringInputError";
}

/**
 * bids in submission order (index 0..n−1); modelOutputs maps str(index) to the outputs of the
 * rubric's models, for eligible bids only (ineligible bids are never sent to a model).
 */
export function evaluate(
  rubric: Rubric,
  tenderId: string,
  bids: readonly BidInput[],
  modelOutputs: ReadonlyMap<string, readonly Json[]>,
): Evaluation {
  const weights = rubric.criteria.reduce((s, c) => s + BigInt(c.weight_bp), 0n);
  if (weights !== BP_N) throw new ScoringInputError(`weights must sum to ${BP}, got ${weights}`);
  if (!bids.every((b, i) => b.index === i)) {
    throw new ScoringInputError("bid indices must be 0..n-1 in submission order");
  }

  const per: BidResult[] = bids.map((b) => {
    const [flags, reasons] = checkEligibility(rubric, tenderId, b);
    return { index: b.index, flags, reasons, eligible: (flags & FLAG.INELIGIBLE) === 0, criteria: {}, total_bp: 0 };
  });
  const plaintextOf = (i: number): JsonObject => (bids[i] as BidInput).plaintext as JsonObject;
  const eligible = per.filter((p) => p.eligible);
  const prices = new Map<number, bigint>(
    eligible.map((p) => [p.index, BigInt(plaintextOf(p.index).get("price_minor") as string)]),
  );
  let lowest: bigint | null = null;
  for (const v of prices.values()) if (lowest === null || v < lowest) lowest = v;

  const qualitativeFields = rubric.criteria.flatMap((c) => (c.type === "qualitative" ? c.source_fields : []));
  for (const p of per) {
    if (!p.eligible) continue;
    const pt = plaintextOf(p.index);
    if (injectionSuspected(qualitativeFields.map((f) => textField(pt, f)))) p.flags |= FLAG.INJECTION_SUSPECTED;
    let acc = 0n;
    for (const c of rubric.criteria) {
      let bp: number;
      if (c.type === "price_lowest_ratio") {
        bp = Number(((lowest as bigint) * BP_N) / (prices.get(p.index) as bigint));
        p.criteria[c.id] = { bp };
      } else {
        const outs = modelOutputs.get(String(p.index)) ?? rubric.models.map(() => null);
        const r = scoreQualitative(rubric, c, pt, outs);
        p.flags |= r.flags;
        bp = r.bp;
        p.criteria[c.id] = { bp, median: r.median, models: r.models };
      }
      acc += BigInt(c.weight_bp) * BigInt(bp);
    }
    p.total_bp = Number(acc / BP_N);
  }

  const cmp = (a: bigint, b: bigint): number => (a < b ? -1 : a > b ? 1 : 0);
  const eligSorted = [...eligible].sort(
    (a, b) =>
      b.total_bp - a.total_bp ||
      cmp(prices.get(a.index) as bigint, prices.get(b.index) as bigint) ||
      a.index - b.index,
  );
  const ineligSorted = per.filter((p) => !p.eligible).sort((a, b) => a.index - b.index);
  const ranking = [...eligSorted, ...ineligSorted].map((p): [number, number, number] => [p.index, p.total_bp, p.flags]);

  let status: Evaluation["status"];
  if (eligible.length === 0) status = "no_eligible_bids";
  else if (eligible.some((p) => (p.flags & FLAG.EVAL_INCOMPLETE) !== 0)) status = "needs_committee";
  else status = "ok";
  return { status, lowest_eligible_price_minor: lowest === null ? null : String(lowest), bids: per, ranking };
}

export class CompactResultError extends Error {
  override name = "CompactResultError";
}

/**
 * What the evaluator prints to stdout and the contract stores: JCS bytes, at most
 * COMPACT_RESULT_MAX_BYTES (reference.py `compact_result`). Hashes are lowercase hex.
 */
export function compactResult(
  tenderId: string,
  bidsRootHex: string,
  rubricHashHex: string,
  bundleHashHex: string,
  attempt: number,
  ev: Evaluation,
): Uint8Array {
  const out = jcs({
    v: 1,
    tid: tenderId,
    root: bidsRootHex,
    rubric: rubricHashHex,
    bundle: bundleHashHex,
    attempt,
    status: ev.status,
    rk: ev.ranking,
  });
  if (out.length > COMPACT_RESULT_MAX_BYTES) {
    throw new CompactResultError(`compact result too large: ${out.length} bytes`);
  }
  return out;
}
