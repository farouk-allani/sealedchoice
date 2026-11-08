/**
 * The five bidder checks, driven by the executable spec.
 *
 * The fixture is built from `specs/test-vectors/scoring-3-bids-injection.json` rather than invented
 * here, so a change to the scoring rules that would alter a bidder's recomputed score breaks this
 * test too. Only the parts the vector cannot carry are synthesised: the Merkle leaves (real
 * ciphertext bytes, real hashing) and the chat-completion envelopes that wrap each model answer.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { rubricSchema } from "@tender/shared";
import type { Debrief } from "@tender/shared";
import { jcsString, merkleLeaf, merkleRoot, sha256Hex, toBase64, utf8ToBytes, bytesToHex } from "@tender/crypto";
import { explainFlags, runDebriefChecks } from "./debrief.ts";
import type { DebriefEvidence, FrozenBid } from "./debrief.ts";
import { FLAG } from "./scoring.ts";

const VECTOR = JSON.parse(
  readFileSync(new URL("../../../specs/test-vectors/scoring-3-bids-injection.json", import.meta.url), "utf8"),
) as {
  tender_id: string;
  rubric: unknown;
  bids: { index: number; submitter: string; plaintext: Record<string, unknown> }[];
  model_outputs: Record<string, unknown[]>;
  expected: {
    bids: { index: number; eligible: boolean; flags: number; criteria: Record<string, unknown>; total_bp: number }[];
    ranking: [number, number, number][];
  };
};

const RUBRIC = rubricSchema.parse(VECTOR.rubric);
const MODELS = RUBRIC.models.map((m) => (typeof m === "string" ? m : (m as { id: string }).id));

/** The envelope the evaluator stores: the model's JSON answer as the assistant's message content. */
function chatResponse(output: unknown): Uint8Array {
  return utf8ToBytes(
    JSON.stringify({
      id: "chat-x",
      object: "chat.completion",
      choices: [{ index: 0, message: { role: "assistant", content: JSON.stringify(output) } }],
    }),
  );
}

/** A request body that really does carry the bidder's text, as the prompt does. */
function chatRequest(model: string, plaintext: Record<string, unknown>): Uint8Array {
  return utf8ToBytes(
    JSON.stringify({
      model,
      messages: [{ role: "user", content: `Score this proposal.\n${jcsString(plaintext)}` }],
    }),
  );
}

interface Built {
  evidence: DebriefEvidence;
  /** Everything the bundle would hold, so a test can corrupt one field. */
  modelCalls: { bid_index: number; model: string; chat_id: string; request_sha256: string; response_sha256: string }[];
}

function build(index: number): Built {
  const bid = VECTOR.bids[index];
  if (bid === undefined) throw new Error(`no bid ${index}`);
  const expected = VECTOR.expected.bids.find((b) => b.index === index);
  if (expected === undefined) throw new Error(`no expectation for bid ${index}`);

  const frozen: FrozenBid[] = VECTOR.bids.map((b, i) => ({
    slot: i,
    bidder: b.submitter,
    submitted_at_ns: BigInt(1_700_000_000_000_000_000 + i),
    ciphertext: utf8ToBytes(`ciphertext-for-bid-${i}`),
  }));
  const root = bytesToHex(merkleRoot(frozen.map((b) => merkleLeaf(b.bidder, b.submitted_at_ns, b.ciphertext))));

  const outputs = VECTOR.model_outputs[String(index)] ?? [];
  const modelCalls: Built["modelCalls"] = [];
  const rawCalls: Debrief["raw_calls"] = [];
  outputs.forEach((out, m) => {
    const model = MODELS[m] ?? `model-${m}`;
    const req = chatRequest(model, bid.plaintext);
    const res = chatResponse(out);
    const chat_id = `chat-${index}-${m}`;
    modelCalls.push({
      bid_index: index,
      model,
      chat_id,
      request_sha256: sha256Hex(req),
      response_sha256: sha256Hex(res),
    });
    rawCalls.push({ model, chat_id, request_b64: toBase64(req), response_b64: toBase64(res) });
  });

  const row = VECTOR.expected.ranking.findIndex((r) => r[0] === index);
  const debrief = {
    v: 1,
    tender_id: VECTOR.tender_id,
    bid_index: index,
    eligible: expected.eligible,
    flags: expected.flags,
    criteria: expected.criteria,
    total_bp: expected.total_bp,
    rank: row + 1,
    of: VECTOR.expected.ranking.length,
    raw_calls: rawCalls,
  } as unknown as Debrief;

  const plaintext = utf8ToBytes(jcsString(debrief as unknown as Record<string, unknown>));
  const proposalPlaintext = utf8ToBytes(jcsString(bid.plaintext));

  const evidence: DebriefEvidence = {
    debrief,
    plaintext,
    envelopeSha256: sha256Hex(plaintext),
    bundle: { bids_root: root, model_calls: modelCalls } as unknown as DebriefEvidence["bundle"],
    rubric: RUBRIC,
    frozen,
    frozenRoot: root,
    ranking: VECTOR.expected.ranking,
    proposalPlaintext,
  };
  return { evidence, modelCalls };
}

const run = (e: DebriefEvidence) => runDebriefChecks(e);
const byId = (e: DebriefEvidence, id: number) => {
  const r = run(e).find((x) => x.id === id);
  if (r === undefined) throw new Error(`no check ${id}`);
  return r;
};

describe("the five bidder checks, on every bid in the vector", () => {
  for (const index of [0, 1, 2]) {
    it(`passes all five for bid ${index}`, () => {
      const { evidence } = build(index);
      const results = run(evidence);
      expect(results.filter((r) => !r.pass).map((r) => `${r.id} ${r.name}: ${r.details}`)).toEqual([]);
      expect(results).toHaveLength(5);
    });
  }

  it("numbers the checks 1 to 5 in order", () => {
    expect(run(build(0).evidence).map((r) => r.id)).toEqual([1, 2, 3, 4, 5]);
  });
});

describe("check 1: the envelope", () => {
  it("fails when the plaintext does not hash to what the bundle published", () => {
    const { evidence } = build(0);
    const r = byId({ ...evidence, envelopeSha256: "0".repeat(64) }, 1);
    expect(r.pass).toBe(false);
  });
});

describe("check 2: the leaf", () => {
  it("fails when the contract's frozen root is not the root of these bids", () => {
    const { evidence } = build(0);
    expect(byId({ ...evidence, frozenRoot: "0".repeat(64) }, 2).pass).toBe(false);
  });

  // A bidder whose own ciphertext was swapped would still see a valid-looking tree, so the check
  // has to tie the rebuilt root back to the chain, not just to itself.
  it("fails when a ciphertext in the set is not the one that was committed", () => {
    const { evidence } = build(0);
    const frozen = evidence.frozen.map((b, i) => (i === 1 ? { ...b, ciphertext: utf8ToBytes("tampered") } : b));
    expect(byId({ ...evidence, frozen }, 2).pass).toBe(false);
  });

  it("fails when the debrief claims a bid index the frozen set does not hold", () => {
    const { evidence } = build(0);
    const debrief = { ...evidence.debrief, bid_index: 9 } as Debrief;
    expect(byId({ ...evidence, debrief }, 2).pass).toBe(false);
  });
});

describe("check 3: the raw calls", () => {
  it("fails when a published request hash is not the hash of the stored request", () => {
    const { evidence, modelCalls } = build(0);
    const calls = modelCalls.map((c, i) => (i === 0 ? { ...c, request_sha256: "0".repeat(64) } : c));
    const bundle = { ...evidence.bundle, model_calls: calls } as DebriefEvidence["bundle"];
    const r = byId({ ...evidence, bundle }, 3);
    expect(r.pass).toBe(false);
    expect(r.details).toContain("request hashes to");
  });

  it("fails when the bundle has no entry for a call the debrief carries", () => {
    const { evidence } = build(0);
    const bundle = { ...evidence.bundle, model_calls: [] } as unknown as DebriefEvidence["bundle"];
    expect(byId({ ...evidence, bundle }, 3).pass).toBe(false);
  });

  it("is skipped when the bid was never scored", () => {
    const { evidence } = build(0);
    const debrief = { ...evidence.debrief, raw_calls: [] } as Debrief;
    expect(byId({ ...evidence, debrief }, 3).skipped).toBe(true);
  });
});

describe("check 4: recomputing the score", () => {
  it("fails when the debrief reports a criterion the model answers do not support", () => {
    const { evidence } = build(0);
    const criteria = { ...(evidence.debrief.criteria as Record<string, unknown>) };
    // A qualitative one: check 4 recomputes only those, because price is arithmetic the contract
    // and the verify page already redo from the bid itself.
    const qualitative = RUBRIC.criteria.find((c) => c.type === "qualitative");
    if (qualitative === undefined) throw new Error("the vector has no qualitative criterion");
    criteria[qualitative.id] = { bp: 9999 };
    const debrief = { ...evidence.debrief, criteria } as Debrief;
    const r = byId({ ...evidence, debrief }, 4);
    expect(r.pass).toBe(false);
    expect(r.details).toContain("differs");
  });

  // Without the proposal there is nothing to check quotes against, and a quote that cannot be
  // checked must not be treated as checked.
  it("is skipped, not passed, when the proposal text is not available", () => {
    const { evidence } = build(0);
    const r = byId({ ...evidence, proposalPlaintext: undefined }, 4);
    expect(r.skipped).toBe(true);
    expect(r.pass).toBe(false);
  });
});

describe("check 5: rank and flags", () => {
  it("fails when the debrief claims a better rank than the public result gives it", () => {
    const { evidence } = build(1);
    const debrief = { ...evidence.debrief, rank: 1 } as Debrief;
    expect(byId({ ...evidence, debrief }, 5).pass).toBe(false);
  });

  it("fails when the debrief hides a flag the result records", () => {
    const { evidence } = build(2);
    expect(evidence.debrief.flags).not.toBe(0);
    const debrief = { ...evidence.debrief, flags: 0 } as Debrief;
    const r = byId({ ...evidence, debrief }, 5);
    expect(r.pass).toBe(false);
    expect(r.details).toContain("flags");
  });

  it("fails when the bid is not in the ranking at all", () => {
    const { evidence } = build(0);
    expect(byId({ ...evidence, ranking: [[7, 100, 0]] }, 5).pass).toBe(false);
  });
});

describe("explainFlags", () => {
  it("says nothing for a clean bid", () => {
    expect(explainFlags(0)).toEqual([]);
  });

  it("explains the injection flag the vector's third bid carries", () => {
    const { evidence } = build(2);
    const labels = explainFlags(evidence.debrief.flags).map((f) => f.label);
    expect(labels).toContain("Injection suspected");
  });

  it("explains several flags at once", () => {
    const labels = explainFlags(FLAG.DISAGREEMENT | FLAG.EVIDENCE_MISSING).map((f) => f.label);
    expect(labels).toEqual(["Evidence missing", "Models disagreed"]);
  });
});
