/**
 * The five bidder checks (docs/06-evidence-and-verification.md, "Bidder checks").
 *
 * A bidder sees one thing nobody else does: their own decrypted debrief. These checks let them
 * confirm that what it says is what the public evidence says, without trusting this site. Like
 * `runChecks`, everything here is pure: the page decrypts, then hands the plaintext over.
 *
 * What a bidder can prove that a stranger cannot is checks 3 and 4. The bundle publishes only the
 * *hashes* of each model request and response; the bytes themselves live in the debrief. So a
 * bidder can show the published hash is the hash of a real conversation about their real proposal,
 * and recompute their own score from the model's own words. A stranger has to take the hash on
 * trust.
 */
import type { evidenceBundleSchema, rubricSchema } from "@tender/shared";
import type { Debrief } from "@tender/shared";
import {
  bytesToHex,
  fromBase64,
  merkleLeaf,
  merkleProof,
  merkleRoot,
  merkleVerify,
  sha256Hex,
} from "@tender/crypto";
import { FLAG, norm, scoreQualitative } from "./scoring.ts";
import { JsonObject, parseJson } from "./json.ts";
import type { Json } from "./json.ts";
import type { CheckLink, CheckResult } from "./evidence.ts";

type Bundle = ReturnType<typeof evidenceBundleSchema.parse>;
type Rubric = ReturnType<typeof rubricSchema.parse>;

const ok = (
  id: number,
  name: string,
  pass: boolean,
  details: string,
  links: CheckLink[] = [],
): CheckResult => ({ id, name, pass, details, links });

const skip = (id: number, name: string, why: string): CheckResult => ({
  id,
  name,
  pass: false,
  details: why,
  links: [],
  skipped: true,
});

const short = (hex: string, n = 12): string =>
  hex.length > n * 2 ? `${hex.slice(0, n)}...${hex.slice(-4)}` : hex;

/**
 * One frozen bid, enough to rebuild its Merkle leaf. The ciphertext is the bytes, not its hash:
 * `merkleLeaf` hashes them itself, and rebuilding from a hash would prove only that the hash was
 * copied correctly, not that the stored bid is the one that was committed to.
 */
export interface FrozenBid {
  slot: number;
  bidder: string;
  submitted_at_ns: bigint;
  ciphertext: Uint8Array;
}

export interface DebriefEvidence {
  /** The decrypted, schema-parsed debrief. */
  debrief: Debrief;
  /** Exact plaintext bytes the envelope held, for check 1. */
  plaintext: Uint8Array;
  /** The `plaintext_sha256` the bundle published for this bid's envelope. */
  envelopeSha256: string;
  bundle: Bundle;
  rubric: Rubric;
  /** The frozen bid set in frozen order, so index i is `bid_index` i (D-033). */
  frozen: readonly FrozenBid[];
  /** `frozen.root` from the contract. */
  frozenRoot: string;
  /**
   * `rk` from the result the contract accepted: [bid_index, total_bp, flags] in rank order. Taken
   * from the chain rather than from the bundle's copy of it, because the chain's is the one the
   * committee has to award against.
   */
  ranking: readonly (readonly number[])[];
  /**
   * The bidder's own proposal plaintext, exactly as the bytes came out of the bid ciphertext. It
   * is parsed here with `parseJson`, never `JSON.parse`, because the scoring core reads a
   * `JsonObject` and a float or a duplicate key must be refused the way the evaluator refused it.
   */
  proposalPlaintext?: Uint8Array;
}

// --------------------------------------------------------------------- 1. the envelope

function check1(e: DebriefEvidence): CheckResult {
  const name = "This debrief is the one published for your bid";
  const got = sha256Hex(e.plaintext);
  const pass = got === e.envelopeSha256;
  return ok(
    1,
    name,
    pass,
    pass
      ? `the bytes that came out of your envelope hash to ${short(got)}, the plaintext_sha256 the bundle published for bid ${e.debrief.bid_index}. Only your key opens that envelope, so nobody could have handed you a different debrief`
      : `the decrypted bytes hash to ${short(got)}, but the bundle published ${short(e.envelopeSha256)} for this envelope`,
  );
}

// --------------------------------------------------------------------- 2. the leaf

function check2(e: DebriefEvidence): CheckResult {
  const name = "Your bid is in the frozen set";
  const i = e.debrief.bid_index;
  if (e.frozen[i] === undefined) {
    return ok(2, name, false, `the debrief says bid ${i}, but the frozen set holds ${e.frozen.length} bid(s)`);
  }
  const leaves = e.frozen.map((b) => merkleLeaf(b.bidder, b.submitted_at_ns, b.ciphertext));
  const leaf = leaves[i];
  if (leaf === undefined) return ok(2, name, false, "could not rebuild your leaf");
  const rootBytes = merkleRoot(leaves);
  const root = bytesToHex(rootBytes);
  const proof = merkleProof(leaves, i);
  const proved = merkleVerify(leaf, proof, rootBytes);
  const matchesChain = root === e.frozenRoot;
  const matchesBundle = root === e.bundle.bids_root;
  const pass = proved && matchesChain && matchesBundle;
  return ok(
    2,
    name,
    pass,
    pass
      ? `your leaf is sha256 over your account, your submission time and your ciphertext hash, and a ${proof.length}-step proof carries it to ${short(root)}, which is the root the contract froze at close and the root the result and the bundle both name. Your bid was in the set before anything was decrypted`
      : `leaf proof ${proved ? "holds" : "fails"}; rebuilt root ${short(root)}, chain ${short(e.frozenRoot)}, bundle ${short(e.bundle.bids_root)}`,
  );
}

// --------------------------------------------------------------------- 3. the raw calls

function check3(e: DebriefEvidence): CheckResult {
  const name = "The published hashes are hashes of your own conversation";
  const i = e.debrief.bid_index;
  const calls = e.debrief.raw_calls;
  if (calls.length === 0) {
    return skip(
      3,
      name,
      "your debrief carries no model calls, which is what an ineligible bid looks like: code refused it before anything was sent to a model",
    );
  }
  const published = e.bundle.model_calls.filter((c) => c.bid_index === i);
  const problems: string[] = [];
  let matched = 0;
  let textFound = 0;
  const proposal = parseProposal(e.proposalPlaintext);
  const proposalText = proposal === null ? null : textOf(proposal);

  for (const call of calls) {
    const pub = published.find((p) => p.chat_id === call.chat_id && p.model === call.model);
    if (pub === undefined) {
      problems.push(`no published entry for ${call.model} chat ${call.chat_id}`);
      continue;
    }
    const reqBytes = fromBase64(call.request_b64);
    const resBytes = fromBase64(call.response_b64);
    const reqHash = sha256Hex(reqBytes);
    const resHash = sha256Hex(resBytes);
    if (reqHash !== pub.request_sha256) {
      problems.push(`${call.model}: request hashes to ${short(reqHash)}, published ${short(pub.request_sha256)}`);
    } else if (resHash !== pub.response_sha256) {
      problems.push(`${call.model}: response hashes to ${short(resHash)}, published ${short(pub.response_sha256)}`);
    } else {
      matched += 1;
    }
    if (proposalText !== null && containsAll(norm(decode(reqBytes)), proposalText)) textFound += 1;
  }
  const pass = problems.length === 0 && matched === calls.length;
  const textNote =
    proposalText === null || proposalText.length === 0
      ? ""
      : `. Your own proposal text appears in ${textFound} of ${calls.length} request bodies, so these are calls about your bid and not someone else's`;
  return ok(
    3,
    name,
    pass,
    pass
      ? `all ${matched} of your model calls hash to the request and response hashes the public bundle published for bid ${i}${textNote}`
      : problems.slice(0, 3).join("; "),
  );
}

/** The long text fields a model actually reads, normalised the way the scorer normalises them. */
function textOf(proposal: JsonObject): string[] {
  const out: string[] = [];
  for (const v of proposal.entries.values()) {
    if (typeof v === "string" && v.trim().length >= 40) out.push(norm(v));
  }
  return out;
}

/** The proposal as the scoring core wants it, or null when there is nothing usable. */
function parseProposal(bytes: Uint8Array | undefined): JsonObject | null {
  if (bytes === undefined) return null;
  try {
    const parsed = parseJson(decode(bytes));
    return parsed instanceof JsonObject ? parsed : null;
  } catch {
    return null;
  }
}

function containsAll(haystack: string, needles: readonly string[]): boolean {
  return needles.length > 0 && needles.every((n) => haystack.includes(n));
}

function decode(bytes: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

// --------------------------------------------------------------------- 4. recompute the score

function check4(e: DebriefEvidence): CheckResult {
  const name = "Your score is what the model answers add up to";
  const calls = e.debrief.raw_calls;
  const proposal = parseProposal(e.proposalPlaintext);
  if (proposal === null) {
    return skip(
      4,
      name,
      "recomputing a score needs your proposal text, which this page only has once you decrypt your own bid here",
    );
  }
  if (calls.length === 0) {
    return skip(4, name, "your bid was never scored, so there is nothing to recompute");
  }
  const outputs: Json[] = calls.map((c) => modelOutput(fromBase64(c.response_b64)));
  const lines: string[] = [];
  let agree = 0;
  for (const crit of e.rubric.criteria) {
    if (crit.type !== "qualitative") continue;
    const got = scoreQualitative(e.rubric, crit, proposal, outputs);
    const published = e.debrief.criteria[crit.id] as { bp?: number } | undefined;
    const same = published?.bp === got.bp;
    if (same) agree += 1;
    lines.push(
      `${crit.id}: recomputed ${got.bp} bp, debrief says ${published?.bp ?? "nothing"}${same ? "" : " (differs)"}`,
    );
  }
  if (lines.length === 0) {
    return skip(4, name, "this rubric has no criterion a model scores, so there is nothing to recompute");
  }
  const pass = agree === lines.length;
  return ok(
    4,
    name,
    pass,
    pass
      ? `running the published scoring rules over the model answers in your own debrief reproduces every criterion it reports: ${lines.join("; ")}. The quote rule and the lower median are the same code the evaluator ran`
      : lines.join("; "),
  );
}

/** The model's JSON answer, dug out of the chat-completion envelope the evaluator stored. */
function modelOutput(bytes: Uint8Array): Json {
  let body: Json;
  try {
    body = parseJson(decode(bytes));
  } catch {
    return null;
  }
  if (!(body instanceof JsonObject)) return null;
  const choices = body.get("choices");
  const first = Array.isArray(choices) ? choices[0] : undefined;
  if (!(first instanceof JsonObject)) return null;
  const message = first.get("message");
  if (!(message instanceof JsonObject)) return null;
  const content = message.get("content");
  if (typeof content !== "string") return null;
  try {
    return parseJson(content);
  } catch {
    return null;
  }
}

// --------------------------------------------------------------------- 5. rank and flags

function check5(e: DebriefEvidence): CheckResult {
  const name = "Your rank and flags match the public result";
  const i = e.debrief.bid_index;
  const ranking = e.ranking;
  const row = ranking.findIndex((r) => r[0] === i);
  if (row === -1) return ok(5, name, false, `bid ${i} does not appear in the published ranking at all`);
  const entry = ranking[row] as readonly number[];
  const checks: [boolean, string][] = [
    [e.debrief.rank === row + 1, `rank ${e.debrief.rank} vs position ${row + 1}`],
    [e.debrief.of === ranking.length, `of ${e.debrief.of} vs ${ranking.length} ranked`],
    [entry[1] === e.debrief.total_bp, `total ${e.debrief.total_bp} vs ${entry[1]}`],
    [entry[2] === e.debrief.flags, `flags ${e.debrief.flags} vs ${entry[2]}`],
  ];
  const pass = checks.every(([good]) => good);
  return ok(
    5,
    name,
    pass,
    pass
      ? `your debrief says rank ${e.debrief.rank} of ${e.debrief.of}, ${e.debrief.total_bp} bp, flags ${e.debrief.flags}, and the result stored on chain says exactly that for bid ${i}. The private copy and the public one agree`
      : checks
          .filter(([good]) => !good)
          .map(([, why]) => why)
          .join("; "),
  );
}

export function runDebriefChecks(e: DebriefEvidence): CheckResult[] {
  return [check1(e), check2(e), check3(e), check4(e), check5(e)];
}

/** Plain-language flag explanations, for the debrief and committee pages. */
export const FLAG_EXPLANATIONS: readonly { bit: number; label: string; meaning: string }[] = [
  {
    bit: FLAG.EVIDENCE_MISSING,
    label: "Evidence missing",
    meaning:
      "A model gave a high score without quoting your text to support it, so that score was capped. Quoting your own words back is what makes a score checkable.",
  },
  {
    bit: FLAG.DISAGREEMENT,
    label: "Models disagreed",
    meaning:
      "The models were far enough apart on a criterion that the result is worth a human reading before it is relied on.",
  },
  {
    bit: FLAG.EVAL_INCOMPLETE,
    label: "Not enough valid answers",
    meaning:
      "Too few models returned a usable answer for a criterion, so it scored zero rather than guessing from one opinion.",
  },
  {
    bit: FLAG.INJECTION_SUSPECTED,
    label: "Injection suspected",
    meaning:
      "The text contains something that reads as an instruction to the scorer rather than as a proposal. It is recorded for the committee; by itself it does not change the score.",
  },
];

/** The flags set in `flags`, as explanations. */
export function explainFlags(flags: number): readonly { bit: number; label: string; meaning: string }[] {
  return FLAG_EXPLANATIONS.filter((f) => (flags & f.bit) !== 0);
}
