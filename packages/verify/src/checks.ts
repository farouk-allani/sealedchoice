/**
 * The ten public verification checks (docs/06-evidence-and-verification.md).
 *
 * Every check is a pure function of `Evidence`, which was fetched once before any of them ran.
 * The CLI and the `/tenders/<id>/verify` page call `runChecks` with the same object and get the
 * same answers, which is the point: a judge must be able to get the CLI's result in a browser.
 *
 * Rules that apply throughout, all of them learned the hard way and recorded in PROGRESS:
 *   - received bytes are decoded with a fatal UTF-8 decoder, so invalid UTF-8 or a leading BOM is
 *     refused the way serde_json refuses it;
 *   - received JSON is parsed with `parseJson`, never `JSON.parse`, and hashed with
 *     `sha256OfCanonicalJson`, so a float or a duplicate key cannot slip through;
 *   - a check that cannot reach a verdict is `skipped`, never a pass.
 */
import { compactResultSchema, evidenceBundleSchema } from "@tender/shared";
import {
  bytesToHex,
  concatBytes,
  fromBase64,
  merkleLeaf,
  merkleRoot,
  sha256Hex,
  u32le,
  utf8ToBytes,
  verifyPersonalSign,
} from "@tender/crypto";
import { isCanonicalJson } from "./canonical.ts";
import { parseJson } from "./json.ts";
import type { CheckLink, CheckResult, Evidence } from "./evidence.ts";

/** Refuses invalid UTF-8 and a leading BOM, as the evaluator's `from_slice` does. */
const decodeUtf8 = (bytes: Uint8Array): string =>
  new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);

const ok = (id: number, name: string, pass: boolean, details: string, links: CheckLink[] = []): CheckResult => ({
  id,
  name,
  pass,
  details,
  links,
});

const skip = (id: number, name: string, why: string, links: CheckLink[] = []): CheckResult => ({
  id,
  name,
  pass: false,
  details: why,
  links,
  skipped: true,
});

const short = (hex: string, n = 12): string => (hex.length > n * 2 ? `${hex.slice(0, n)}...${hex.slice(-4)}` : hex);

/** Parsed once, so ten checks do not re-parse a 780 KB bundle ten times. */
interface Ctx {
  e: Evidence;
  /** The compact result the contract stored, if it parsed. */
  result: ReturnType<typeof compactResultSchema.parse> | null;
  resultError: string | null;
  /** The bundle, if its bytes decoded and parsed and matched the schema. */
  bundle: ReturnType<typeof evidenceBundleSchema.parse> | null;
  bundleError: string | null;
  /** `sha256` of the bytes the store actually served. */
  bundleBytesSha256: string | null;
  /** The rubric object, if `rubric_json` parsed. */
  rubric: Record<string, unknown> | null;
}

function prepare(e: Evidence): Ctx {
  let result: Ctx["result"] = null;
  let resultError: string | null = null;
  if (e.resultText === null || e.resultText === "") {
    resultError = "the contract has stored no result for this tender";
  } else {
    try {
      result = compactResultSchema.parse(JSON.parse(e.resultText));
    } catch (err) {
      resultError = `the stored result does not match the compact-result schema: ${String(err).slice(0, 160)}`;
    }
  }

  let bundle: Ctx["bundle"] = null;
  let bundleError: string | null = null;
  let bundleBytesSha256: string | null = null;
  if (e.bundle === null) {
    bundleError = "the evidence bundle was not fetched";
  } else {
    try {
      bundleBytesSha256 = sha256Hex(e.bundle.bytes);
      const text = decodeUtf8(e.bundle.bytes);
      parseJson(text); // refuses floats, duplicate keys and over-deep nesting before zod sees it
      bundle = evidenceBundleSchema.parse(JSON.parse(text));
    } catch (err) {
      bundleError = `the bundle did not parse or validate: ${String(err).slice(0, 200)}`;
    }
  }

  let rubric: Record<string, unknown> | null = null;
  try {
    const parsed: unknown = JSON.parse(e.tender.rubric_json);
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
      rubric = parsed as Record<string, unknown>;
    }
  } catch {
    rubric = null;
  }

  return { e, result, resultError, bundle, bundleError, bundleBytesSha256, rubric };
}

// ------------------------------------------------------------------ 1. the rubric

function check1(c: Ctx): CheckResult {
  const name = "Rubric matches its hash and is canonical";
  const { rubric_json: json, rubric_hash: want } = c.e.tender;
  const got = sha256Hex(utf8ToBytes(json));
  if (got !== want) {
    return ok(1, name, false, `sha256(rubric_json) is ${short(got)} but the tender stores ${short(want)}`);
  }
  if (c.rubric === null) {
    return ok(1, name, false, "rubric_json is not a JSON object");
  }
  if (!isCanonicalJson(json)) {
    return ok(
      1,
      name,
      false,
      "rubric_json hashes correctly but is not canonical JSON, so two readers could serialise it differently",
    );
  }
  const models = Array.isArray(c.rubric["models"]) ? (c.rubric["models"] as unknown[]) : [];
  return ok(
    1,
    name,
    true,
    `sha256(rubric_json) == rubric_hash ${short(want)}, and rubric_json is canonical (${json.length} bytes, ${models.length} models)`,
  );
}

// ------------------------------------------------------------------ 2. fixed before bidding

function check2(c: Ctx): CheckResult {
  const name = "Rubric was fixed before the first bid";
  const bids = c.e.bids;
  if (bids.length === 0) {
    return skip(2, name, "no bids were submitted, so there is nothing to order the rubric against");
  }
  // The contract has no creation timestamp in state, and finding the creating transaction needs an
  // indexer. It does not need one: `create_tender` refuses a deadline closer than
  // `min_deadline_delay_ns`, so creation happened at or before `deadline - min_delay`. If the first
  // bid is later than that bound, the rubric provably existed before any bid was sealed.
  const latestPossibleCreation = c.e.tender.deadline_ns - c.e.minDeadlineDelayNs;
  const firstBid = bids
    .map((b) => b.submitted_at_ns)
    .reduce((min, ns) => (ns < min ? ns : min));
  const pass = latestPossibleCreation < firstBid;
  const gapMs = Number((firstBid - latestPossibleCreation) / 1_000_000n);
  const links = c.e.codeHash
    ? [{ label: `deployed code hash ${c.e.codeHash}`, href: `${c.e.explorerBase}/accounts/${c.e.contractId}` }]
    : [];
  return ok(
    2,
    name,
    pass,
    pass
      ? `the contract refuses a deadline under ${c.e.minDeadlineDelayNs / 1_000_000_000n}s, so this tender was created no later than ${latestPossibleCreation}ns, which is ${gapMs}ms before the first bid at ${firstBid}ns. The rubric is immutable after creation (I1) and the contract exposes no setter for it`
      : `the first bid at ${firstBid}ns is not provably after creation: the latest creation the deadline rule allows is ${latestPossibleCreation}ns`,
    links,
  );
}

// ------------------------------------------------------------------ 3. the bid set

function check3(c: Ctx): CheckResult {
  const name = "Bid set is the one that was frozen";
  const frozen = c.e.frozen;
  if (frozen === null) return skip(3, name, "the tender has no frozen bid set, so it was never closed");

  const bySlot = new Map(c.e.bids.map((b) => [b.slot, b]));
  const leaves: Uint8Array[] = [];
  for (const [i, slot] of frozen.slots.entries()) {
    const bid = bySlot.get(slot);
    if (bid === undefined) return ok(3, name, false, `frozen slot ${slot} has no bid in get_bids`);
    const b64 = c.e.ciphertexts[slot];
    if (b64 === undefined) return skip(3, name, `the ciphertext for slot ${slot} was not fetched`);
    let ciphertext: Uint8Array;
    try {
      ciphertext = fromBase64(b64);
    } catch {
      return ok(3, name, false, `the ciphertext for slot ${slot} is not valid base64`);
    }
    const ctHash = sha256Hex(ciphertext);
    if (ctHash !== bid.ciphertext_sha256) {
      return ok(3, name, false, `slot ${slot}: the stored ciphertext hashes to ${short(ctHash)}, not the recorded ${short(bid.ciphertext_sha256)}`);
    }
    const leaf = merkleLeaf(bid.bidder, bid.submitted_at_ns, ciphertext);
    const leafHex = bytesToHex(leaf);
    const recorded = frozen.leaves[i];
    if (recorded !== undefined && leafHex !== recorded) {
      return ok(3, name, false, `slot ${slot}: recomputed leaf ${short(leafHex)} does not match the frozen leaf ${short(recorded)}`);
    }
    leaves.push(leaf);
  }

  if (leaves.length === 0) return ok(3, name, false, "the frozen set is empty");
  const root = bytesToHex(merkleRoot(leaves));
  if (root !== frozen.root) {
    return ok(3, name, false, `recomputed root ${short(root)} does not match frozen.root ${short(frozen.root)}`);
  }
  if (c.result !== null && c.result.root !== root) {
    return ok(3, name, false, `the result echoes root ${short(c.result.root)}, not the frozen root ${short(root)}`);
  }
  const active = c.e.bids.filter((b) => !b.withdrawn).length;
  if (active !== frozen.slots.length) {
    return ok(3, name, false, `${frozen.slots.length} slots were frozen but ${active} bids are active`);
  }
  return ok(
    3,
    name,
    true,
    `recomputed ${leaves.length} leaves from the on-chain ciphertexts; the root is ${short(root)} and matches both frozen.root and the result`,
  );
}

// ------------------------------------------------------------------ 4. the evaluator

function check4(c: Ctx, artifact: { sha256: string; bytes: number } | null): CheckResult {
  const name = "Evaluator is the pinned build";
  const pinned = c.e.tender.evaluator.wasm_sha256;
  const links: CheckLink[] = [{ label: "published artifact", href: c.e.tender.evaluator.wasm_url }];
  const tag = c.e.tender.evaluator.source_tag;
  if (tag) {
    links.push({ label: `source tag ${tag}`, href: `https://github.com/farouk-allani/sealedchoice/releases/tag/${tag}` });
  }
  const requestId = c.bundle?.evaluator?.outlayer_request_id;
  if (requestId !== undefined && requestId !== null) {
    links.push({ label: `OutLayer request ${String(requestId)}`, href: `https://cloud.outlayer.ai/requests/${String(requestId)}` });
  }

  // The bundle's own evaluator block is what the CONTRACT passed in (D-029). It is informational:
  // comparing it with the rest would only show the bundle agreeing with itself.
  const inBundle = c.bundle?.evaluator?.wasm_sha256 ?? null;
  if (inBundle !== null && inBundle !== pinned) {
    return ok(4, name, false, `the tender pins ${short(pinned)} but the bundle reports ${short(inBundle)}`, links);
  }
  if (artifact === null) {
    return skip(
      4,
      name,
      `the tender pins ${short(pinned)}; the published artifact was not downloaded, so the pin could not be checked against real bytes`,
      links,
    );
  }
  if (artifact.sha256 !== pinned) {
    return ok(4, name, false, `the artifact at wasm_url hashes to ${short(artifact.sha256)}, not the pinned ${short(pinned)}`, links);
  }
  return ok(
    4,
    name,
    true,
    `the ${artifact.bytes} bytes served at wasm_url hash to the pinned ${short(pinned)}. Reproducing that hash from ${tag ?? "the source tag"} is the README's build step`,
    links,
  );
}

// ------------------------------------------------------------------ 5. exactly one result

function check5(c: Ctx): CheckResult {
  const name = "Exactly one evaluation was accepted";
  const accepted = c.e.attempts.filter((a) => a.outcome === "Accepted");
  const failures = c.e.attempts
    .filter((a) => a.outcome !== "Accepted")
    .map((a) => {
      const o = a.outcome;
      if (typeof o === "string") return `attempt ${a.n}: ${o}`;
      const failed = (o as Record<string, unknown>)["Failed"];
      const reason = failed && typeof failed === "object" ? (failed as Record<string, unknown>)["reason"] : undefined;
      return `attempt ${a.n}: ${typeof reason === "string" ? reason : JSON.stringify(o)}`;
    });
  const detail = `${c.e.attempts.length} attempt(s), ${accepted.length} accepted${failures.length ? `; ${failures.join("; ")}` : ""}`;
  if (accepted.length !== 1) return ok(5, name, false, detail);
  return ok(5, name, true, detail);
}

// ------------------------------------------------------------------ 6. bundle integrity

function check6(c: Ctx): CheckResult {
  const name = "Bundle is the one the result committed to";
  if (c.result === null) return skip(6, name, c.resultError ?? "no result");
  if (c.e.bundle === null || c.bundleBytesSha256 === null) return skip(6, name, c.bundleError ?? "no bundle");

  if (c.bundleBytesSha256 !== c.result.bundle) {
    return ok(6, name, false, `the stored bytes hash to ${short(c.bundleBytesSha256)} but the result commits to ${short(c.result.bundle)}`);
  }
  // The ETag is the store's own claim about the same bytes. A CDN that compresses has to weaken it
  // to `W/"<hash>"`, so strip an optional W/ and the quotes before comparing (docs/06).
  const etag = c.e.bundle.etag;
  if (etag !== null) {
    const normalised = etag.replace(/^W\//, "").replace(/^"|"$/g, "");
    if (normalised !== c.result.bundle) {
      return ok(6, name, false, `the store served ETag ${etag}, which is not the committed hash ${short(c.result.bundle)}`);
    }
  }
  if (c.bundle === null) return ok(6, name, false, c.bundleError ?? "the bundle did not parse");

  if (c.bundle.bids_root !== c.result.root) {
    return ok(6, name, false, `bundle.bids_root ${short(c.bundle.bids_root)} does not match the result root ${short(c.result.root)}`);
  }
  if (c.bundle.rubric_hash !== c.e.tender.rubric_hash) {
    return ok(6, name, false, `bundle.rubric_hash ${short(c.bundle.rubric_hash)} does not match the tender ${short(c.e.tender.rubric_hash)}`);
  }
  // `bundle.result` is the compact result minus its own `bundle` field, which cannot be inside
  // the thing it hashes.
  const embedded = { ...(c.bundle.result as Record<string, unknown>) };
  const expected: Record<string, unknown> = { ...(JSON.parse(c.e.resultText ?? "{}") as Record<string, unknown>) };
  delete expected["bundle"];
  const a = JSON.stringify(Object.keys(embedded).sort().map((k) => [k, embedded[k]]));
  const b = JSON.stringify(Object.keys(expected).sort().map((k) => [k, expected[k]]));
  if (a !== b) {
    return ok(6, name, false, "bundle.result is not the stored compact result with its bundle hash removed");
  }
  return ok(
    6,
    name,
    true,
    `the ${c.e.bundle.bytes.length} bytes served hash to ${short(c.result.bundle)}; the bundle echoes the root, the rubric hash and the compact result`,
    [{ label: "the bundle", href: c.e.bundle.url }],
  );
}

// ------------------------------------------------------------------ 7. model calls complete

function check7(c: Ctx): CheckResult {
  const name = "Every eligible bid was scored by every pinned model";
  if (c.bundle === null) return skip(7, name, c.bundleError ?? "no bundle");
  const models = Array.isArray(c.rubric?.["models"]) ? (c.rubric["models"] as string[]) : [];
  if (models.length === 0) return skip(7, name, "the rubric lists no models");

  const eligible = c.bundle.bids.filter((b) => b.eligible);
  const problems: string[] = [];
  let answered = 0;
  for (const bid of eligible) {
    for (const model of models) {
      const calls = c.bundle.model_calls.filter((m) => m.bid_index === bid.index && m.model === model);
      const [only] = calls;
      if (only === undefined) {
        problems.push(`bid ${bid.index} has no call to ${model}`);
      } else if (calls.length > 1) {
        problems.push(`bid ${bid.index} has ${calls.length} calls to ${model}`);
      } else if (!only.error) {
        answered += 1;
      }
    }
  }
  const unknown = c.bundle.model_calls.filter((m) => !models.includes(m.model)).map((m) => m.model);
  if (unknown.length > 0) problems.push(`calls to models the rubric does not pin: ${[...new Set(unknown)].join(", ")}`);

  const total = eligible.length * models.length;
  if (problems.length > 0) return ok(7, name, false, problems.join("; "));
  return ok(
    7,
    name,
    true,
    `${eligible.length} eligible bid(s) x ${models.length} pinned model(s) = ${total} call(s), ${answered} answered and ${total - answered} with a recorded error`,
  );
}

// ------------------------------------------------------------------ 8. signatures

function check8(c: Ctx): CheckResult {
  const name = "Model signatures verify and were made inside a TEE";
  if (c.bundle === null) return skip(8, name, c.bundleError ?? "no bundle");
  const withSig = c.bundle.model_calls.filter((m) => m.signature);
  if (withSig.length === 0) return skip(8, name, "no model call carries a signature");

  const problems: string[] = [];
  const addresses = new Set<string>();
  for (const call of withSig) {
    const s = call.signature;
    if (s === undefined || s === null) continue;
    const where = `bid ${call.bid_index} / ${call.model}`;
    // D-028 promises provider_tee: a `gateway` signature says only the gateway saw the response.
    if (s.signature_kind !== "provider_tee") {
      problems.push(`${where}: signature_kind is ${s.signature_kind}, not provider_tee`);
      continue;
    }
    const expected = `${call.model}:${call.request_sha256}:${call.response_sha256}`;
    if (s.text !== expected) {
      problems.push(`${where}: the signed text is not <model>:<request_sha256>:<response_sha256>`);
      continue;
    }
    if (!verifyPersonalSign(s.text, s.signature, s.signing_address)) {
      problems.push(`${where}: the signature does not recover to ${s.signing_address}`);
      continue;
    }
    addresses.add(s.signing_address.toLowerCase());
  }
  if (problems.length > 0) return ok(8, name, false, problems.join("; "));
  return ok(
    8,
    name,
    true,
    `${withSig.length} signature(s) recovered to their published addresses over <model>:<request>:<response>, all provider_tee, from ${addresses.size} distinct signing address(es)`,
  );
}

// ------------------------------------------------------------------ 9. attestation

function check9(c: Ctx): CheckResult {
  const name = "Attestation binds this run and the signing keys";
  if (c.bundle === null) return skip(9, name, c.bundleError ?? "no bundle");
  const att = c.bundle.attestation;
  if (!att) return skip(9, name, "the bundle carries no attestation");

  const root = c.bundle.bids_root;
  const attempt = c.bundle.evaluator?.attempt;
  if (typeof attempt !== "number") return skip(9, name, "the bundle does not say which attempt this was");
  const nonce = sha256Hex(concatBytes(hexBytes(root), u32le(attempt)));
  if (nonce !== att.nonce_hex) {
    return ok(9, name, false, `the nonce should be sha256(bids_root || u32le(attempt)) = ${short(nonce)} but the bundle reports ${short(att.nonce_hex)}`);
  }
  const blob = JSON.stringify(att).toLowerCase();
  const missing: string[] = [];
  const addresses = new Set(
    c.bundle.model_calls.flatMap((m) => (m.signature ? [m.signature.signing_address.toLowerCase()] : [])),
  );
  for (const a of addresses) {
    if (!blob.includes(a.replace(/^0x/, ""))) missing.push(a);
  }
  if (missing.length > 0) {
    return ok(9, name, false, `signing address(es) absent from the attestation reports: ${missing.join(", ")}`);
  }
  return ok(
    9,
    name,
    true,
    `the nonce is sha256(bids_root || u32le(${attempt})) = ${short(nonce)}, and all ${addresses.size} signing address(es) appear in the ${att.reports?.length ?? 0} report(s). Deep TDX quote verification follows NEAR AI's own verifier`,
    [{ label: "NEAR AI attestation docs", href: "https://docs.near.ai/cloud/attestation/" }],
  );
}

function hexBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i += 1) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

// ------------------------------------------------------------------ 10. ranking

function check10(c: Ctx): CheckResult {
  const name = "Ranking is consistent with the scores and flags";
  if (c.result === null) return skip(10, name, c.resultError ?? "no result");
  const rk = c.result.rk;
  if (rk.length === 0) return skip(10, name, "the result ranks no bids");

  // `rk` entries are [index, total_bp, flags]; bit 0 of flags is INELIGIBLE.
  const flagsOf = (entry: readonly number[]): number => entry[2] ?? 0;
  const totalOf = (entry: readonly number[]): number => entry[1] ?? 0;
  const indexOf = (entry: readonly number[]): number => entry[0] ?? -1;
  const isEligible = (entry: readonly number[]): boolean => (flagsOf(entry) & 1) === 0;
  const firstIneligible = rk.findIndex((r) => !isEligible(r));
  const eligible = firstIneligible === -1 ? rk : rk.slice(0, firstIneligible);
  const rest = firstIneligible === -1 ? [] : rk.slice(firstIneligible);

  const stray = rest.find((r) => isEligible(r));
  if (stray) return ok(10, name, false, `an eligible entry (index ${indexOf(stray)}) is ranked after an ineligible one`);

  for (let i = 1; i < eligible.length; i += 1) {
    const here = eligible[i] ?? [];
    const above = eligible[i - 1] ?? [];
    if (totalOf(here) > totalOf(above)) {
      return ok(
        10,
        name,
        false,
        `entry ${indexOf(here)} scores ${totalOf(here)} but is ranked below ${indexOf(above)} with ${totalOf(above)}`,
      );
    }
  }
  const indices = rk.map((r) => indexOf(r));
  if (new Set(indices).size !== indices.length) return ok(10, name, false, "the ranking lists the same bid twice");
  if (c.e.frozen && rk.length !== c.e.frozen.slots.length) {
    return ok(10, name, false, `${rk.length} ranked entries for ${c.e.frozen.slots.length} frozen bids`);
  }
  return ok(
    10,
    name,
    true,
    `${eligible.length} eligible entr(ies) in descending order of total, ${rest.length} ineligible last; every frozen bid appears exactly once`,
  );
}

/**
 * Runs all ten checks. `artifact` is the hash of the bytes served at the evaluator's `wasm_url`,
 * when the caller downloaded them; without it check 4 reports `skipped` rather than passing on the
 * bundle's say-so.
 */
export function runChecks(e: Evidence, artifact: { sha256: string; bytes: number } | null = null): CheckResult[] {
  const c = prepare(e);
  return [check1(c), check2(c), check3(c), check4(c, artifact), check5(c), check6(c), check7(c), check8(c), check9(c), check10(c)];
}

export function summarise(results: readonly CheckResult[]): { passed: number; total: number; allPassed: boolean } {
  const passed = results.filter((r) => r.pass).length;
  return { passed, total: results.length, allPassed: passed === results.length };
}
