/** Real encrypted reports: public reader keys let a store replace an envelope, not the chain's hash. */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { debriefSchema, evidenceBundleSchema, rubricSchema } from "@tender/shared";
import type { Debrief, EvidenceBundle } from "@tender/shared";
import {
  bytesToHex, concatBytes, eciesEncrypt, hexToBytes, jcs, jcsString,
  merkleLeaf, merkleRoot, sha256Hex, toBase64, utf8ToBytes,
} from "@tender/crypto";
import { CommitteeError, openCommitteeReport } from "./committee.ts";
import { DebriefError, openDebrief } from "./debrief-open.ts";
import type { Evidence } from "./evidence.ts";

const VECTOR = JSON.parse(readFileSync(
  new URL("../../../specs/test-vectors/scoring-3-bids-injection.json", import.meta.url), "utf8",
)) as {
  tender_id: string;
  rubric: unknown;
  bids: { index: number; submitter: string; plaintext: Record<string, unknown> }[];
  model_outputs: Record<string, unknown[]>;
  expected: { bids: { index: number; eligible: boolean; flags: number; criteria: Record<string, unknown>; total_bp: number }[]; ranking: number[][] };
};
const KEYS = JSON.parse(readFileSync(
  new URL("../../../specs/test-vectors/hashes-and-keys.json", import.meta.url), "utf8",
)) as { debrief_key: { sk_hex: string; pk_compressed_hex: string }; committee_key: { sk_hex: string; pk_compressed_hex: string } };
const DEBRIEF_KEY = hexToBytes(KEYS.debrief_key.sk_hex);
const COMMITTEE_KEY = hexToBytes(KEYS.committee_key.sk_hex);

/** The evaluator's body format, sealed using public test data and a fresh nonce. */
async function sealReport(plaintext: Uint8Array): Promise<{ body: Uint8Array; wrappedKey: Uint8Array }> {
  const key = new Uint8Array(32).fill(9);
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const imported = await crypto.subtle.importKey("raw", key.buffer, "AES-GCM", false, ["encrypt"]);
  const sealed = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce, tagLength: 128 }, imported, plaintext.slice().buffer,
  );
  return {
    body: concatBytes(nonce, new Uint8Array(sealed)),
    wrappedKey: eciesEncrypt(KEYS.committee_key.pk_compressed_hex, key),
  };
}

async function fixture() {
  const bid = VECTOR.bids[0];
  const expected = VECTOR.expected.bids[0];
  if (bid === undefined || expected === undefined) throw new Error("missing vector bid");
  const rubric = rubricSchema.parse(VECTOR.rubric);
  const rubricJson = jcsString(VECTOR.rubric as Record<string, unknown>);
  const rubricHash = sha256Hex(utf8ToBytes(rubricJson));
  const frozen = VECTOR.bids.map((b, slot) => {
    const ciphertext = utf8ToBytes(`ciphertext-${slot}`);
    const submitted_at_ns = 1_700_000_000_000_000_000n + BigInt(slot);
    return { slot, bidder: b.submitter, submitted_at_ns, ciphertext,
      leaf: bytesToHex(merkleLeaf(b.submitter, submitted_at_ns, ciphertext)) };
  });
  const root = bytesToHex(merkleRoot(frozen.map((b) => hexToBytes(b.leaf))));
  const modelCalls: EvidenceBundle["model_calls"] = [];
  const rawCalls: Debrief["raw_calls"] = [];
  (VECTOR.model_outputs["0"] ?? []).forEach((answer, i) => {
    const model = rubric.models[i];
    if (model === undefined) throw new Error("missing vector model");
    const request = utf8ToBytes(JSON.stringify({ model, messages: [{ role: "user", content: jcsString(bid.plaintext) }] }));
    const response = utf8ToBytes(JSON.stringify({ choices: [{ message: { content: JSON.stringify(answer) } }] }));
    const chat_id = `chat-0-${i}`;
    modelCalls.push({ bid_index: 0, model, chat_id, request_sha256: sha256Hex(request), response_sha256: sha256Hex(response),
      signature: { text: "", signature: "", signing_address: "", signing_algo: "ecdsa" } });
    rawCalls.push({ model, chat_id, request_b64: toBase64(request), response_b64: toBase64(response) });
  });
  const debrief = debriefSchema.parse({ v: 1, tender_id: VECTOR.tender_id, bid_index: 0,
    eligible: expected.eligible, flags: expected.flags, criteria: expected.criteria, total_bp: expected.total_bp,
    rank: 1, of: VECTOR.bids.length, raw_calls: rawCalls });
  const result = { v: 1, tid: VECTOR.tender_id, root, rubric: rubricHash, attempt: 1,
    status: "ok", rk: VECTOR.expected.ranking };
  const reportPlaintext = jcs({ tender_id: VECTOR.tender_id, status: "ok", rk: result.rk,
    bids: [{ ...debrief, proposal_b64: toBase64(jcs(bid.plaintext)) }] });
  const report = await sealReport(reportPlaintext);
  const debriefPlaintext = jcs(debrief);
  const bundle = evidenceBundleSchema.parse({
    v: 1, tender_id: VECTOR.tender_id, contract_id: "tenders.sealedchoice.testnet",
    evaluator: { wasm_sha256: "a".repeat(64), source_repo: "https://example.invalid/source", source_tag: "test", outlayer_request_id: 1 },
    rubric_hash: rubricHash, prompt_hash: "b".repeat(64), bids_root: root, bids: [], model_calls: modelCalls,
    attestation: { nonce_hex: "c".repeat(64), reports: [] }, result,
    debriefs: [{ bid_index: 0, recipient_pubkey: KEYS.debrief_key.pk_compressed_hex,
      ecies_b64: toBase64(eciesEncrypt(KEYS.debrief_key.pk_compressed_hex, debriefPlaintext)), plaintext_sha256: sha256Hex(debriefPlaintext) }],
    committee_report: { cipher: "aes-256-gcm", body_b64: toBase64(report.body), plaintext_sha256: sha256Hex(reportPlaintext),
      keys: [{ member: "buyer.sealedchoice.testnet", recipient_pubkey: KEYS.committee_key.pk_compressed_hex, ecies_b64: toBase64(report.wrappedKey) }] },
  });
  const bytes = jcs(bundle);
  const hash = sha256Hex(bytes);
  const evidence: Evidence & { bundle: NonNullable<Evidence["bundle"]>; resultText: string } = {
    network: "testnet", contractId: bundle.contract_id, tenderId: Number(VECTOR.tender_id), minDeadlineDelayNs: 300_000_000_000n,
    tender: { id: VECTOR.tender_id, buyer: "buyer.sealedchoice.testnet", rubric_json: rubricJson, rubric_hash: rubricHash,
      deadline_ns: 1_800_000_000_000_000_000n, status: "Evaluated", evaluator: { wasm_url: "https://example.invalid/evaluator.wasm", wasm_sha256: "a".repeat(64) },
      committee: [{ account: "buyer.sealedchoice.testnet", report_pubkey: KEYS.committee_key.pk_compressed_hex }], bid_slots: frozen.length, active_slots: frozen.map((b) => b.slot) },
    bids: frozen.map((b) => ({ slot: b.slot, bidder: b.bidder, submitted_at_ns: b.submitted_at_ns,
      ciphertext_sha256: sha256Hex(b.ciphertext), ciphertext_len: b.ciphertext.length, withdrawn: false })),
    frozen: { slots: frozen.map((b) => b.slot), leaves: frozen.map((b) => b.leaf), root },
    attempts: [{ n: 1, started_at_ns: 1_800_000_000_000_000_001n, outcome: "Accepted" }],
    resultText: JSON.stringify({ ...result, bundle: hash }),
    bundle: { bytes, etag: `"${hash}"`, url: `https://example.invalid/api/bundles/${hash}` },
    ciphertexts: Object.fromEntries(frozen.map((b) => [b.slot, toBase64(b.ciphertext)])), codeHash: null, explorerBase: "https://example.invalid",
  };
  return { evidence, bundle, debrief, proposal: bid.plaintext };
}

const readers: {
  name: string;
  error: new (message: string) => Error;
  open: (evidence: Evidence) => unknown;
}[] = [
  { name: "bidder", error: DebriefError, open: (evidence: Evidence) => openDebrief({ evidence, secretKey: DEBRIEF_KEY }) },
  { name: "committee", error: CommitteeError, open: (evidence: Evidence) => openCommitteeReport({ evidence, secretKey: COMMITTEE_KEY }) },
];

describe("private readers bind report bytes to the accepted result", () => {
  it("opens an authentic debrief and passes all five bidder checks", async () => {
    const f = await fixture();
    const opened = openDebrief({ evidence: f.evidence, secretKey: DEBRIEF_KEY, proposalPlaintext: jcs(f.proposal) });
    expect(opened.debrief).toEqual(f.debrief);
    expect(opened.results.every((r) => r.pass && !r.skipped)).toBe(true);
  });

  it("opens an authentic committee report and its original proposal", async () => {
    const f = await fixture();
    const opened = await openCommitteeReport({ evidence: f.evidence, secretKey: COMMITTEE_KEY });
    expect(opened.bids[0]?.debrief).toEqual(expect.objectContaining(f.debrief));
    expect(opened.bids[0]?.proposal).toEqual(f.proposal);
  });

  it("refuses a correctly re-encrypted bidder debrief with a matching internal plaintext hash", async () => {
    const f = await fixture();
    const forged = jcs({ ...f.debrief, total_bp: 10000 });
    f.bundle.debriefs[0] = { bid_index: 0, recipient_pubkey: KEYS.debrief_key.pk_compressed_hex,
      ecies_b64: toBase64(eciesEncrypt(KEYS.debrief_key.pk_compressed_hex, forged)), plaintext_sha256: sha256Hex(forged) };
    const bytes = jcs(f.bundle);
    const replaced = { ...f.evidence, bundle: { ...f.evidence.bundle, bytes } };
    // The forgery really decrypts. Only updating the trusted chain commitment would admit it.
    const rebound = { ...replaced, resultText: JSON.stringify({ ...JSON.parse(f.evidence.resultText), bundle: sha256Hex(bytes) }) };
    expect(openDebrief({ evidence: rebound, secretKey: DEBRIEF_KEY }).debrief.total_bp).toBe(10000);
    expect(() => openDebrief({ evidence: replaced, secretKey: DEBRIEF_KEY })).toThrow(/bundle does not match.*accepted result/);
  });

  it("refuses a correctly re-encrypted committee body and key with matching internal hashes", async () => {
    const f = await fixture();
    const proposal = { ...f.proposal, price_minor: "1" };
    const plaintext = jcs({ tender_id: VECTOR.tender_id, status: "ok", rk: VECTOR.expected.ranking,
      bids: [{ ...f.debrief, proposal_b64: toBase64(jcs(proposal)) }] });
    const sealed = await sealReport(plaintext);
    f.bundle.committee_report = { cipher: "aes-256-gcm", body_b64: toBase64(sealed.body), plaintext_sha256: sha256Hex(plaintext),
      keys: [{ member: "buyer.sealedchoice.testnet", recipient_pubkey: KEYS.committee_key.pk_compressed_hex, ecies_b64: toBase64(sealed.wrappedKey) }] };
    const bytes = jcs(f.bundle);
    const replaced = { ...f.evidence, bundle: { ...f.evidence.bundle, bytes } };
    const rebound = { ...replaced, resultText: JSON.stringify({ ...JSON.parse(f.evidence.resultText), bundle: sha256Hex(bytes) }) };
    expect((await openCommitteeReport({ evidence: rebound, secretKey: COMMITTEE_KEY })).bids[0]?.proposal).toEqual(proposal);
    await expect(openCommitteeReport({ evidence: replaced, secretKey: COMMITTEE_KEY })).rejects.toThrow(/bundle does not match.*accepted result/);
  });

  for (const reader of readers) {
    describe(reader.name, () => {
      it.each([null, "", "not JSON", "{}"])("refuses missing/malformed accepted result %s", async (resultText) => {
        const f = await fixture();
        await expect(Promise.resolve().then(() => reader.open({ ...f.evidence, resultText }))).rejects.toThrow(reader.error);
      });

      it("refuses a malformed commitment even if the rest of the accepted result is valid", async () => {
        const f = await fixture();
        const resultText = JSON.stringify({ ...JSON.parse(f.evidence.resultText), bundle: "not-a-hash" });
        await expect(Promise.resolve().then(() => reader.open({ ...f.evidence, resultText }))).rejects.toThrow(reader.error);
      });

      it("hashes raw bytes rather than accepting equivalent JSON or the original ETag", async () => {
        const f = await fixture();
        const bundle = { ...f.evidence.bundle, bytes: concatBytes(f.evidence.bundle.bytes, utf8ToBytes("\n")) };
        await expect(Promise.resolve().then(() => reader.open({ ...f.evidence, bundle }))).rejects.toThrow(/bundle does not match.*accepted result/);
      });

      it("rejects uncommitted bytes before attempting bundle parsing", async () => {
        const f = await fixture();
        const bundle = { ...f.evidence.bundle, bytes: utf8ToBytes("not bundle JSON") };
        await expect(Promise.resolve().then(() => reader.open({ ...f.evidence, bundle }))).rejects.toThrow(/bundle does not match.*accepted result/);
      });
    });
  }
});
