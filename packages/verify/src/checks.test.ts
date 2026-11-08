// The ten public checks (docs/06). Each negative test breaks exactly one thing and asserts that
// exactly the right check fails, because a verifier that fails everything whenever anything is
// wrong tells a reader nothing about what is wrong.
import { describe, expect, it } from "vitest";
import { signPersonalSign } from "@tender/crypto/testing";
import {
  bytesToHex,
  concatBytes,
  jcs,
  merkleLeaf,
  merkleRoot,
  sha256Hex,
  toBase64,
  u32le,
  utf8ToBytes,
} from "@tender/crypto";
import { runChecks, summarise } from "./checks.ts";
import type { Evidence } from "./evidence.ts";

/**
 * Builds a tender whose evidence is internally consistent, so every one of the ten checks passes.
 * Tests then break exactly one thing and assert that exactly the right check fails.
 *
 * Everything is real: real Merkle leaves over real ciphertext bytes, real SHA-256, real canonical
 * JSON, and signatures made with a real secp256k1 key so check 8 recovers an address rather than
 * being told one. The only thing that is not real is the attestation body, which is a stand-in
 * carrying the signing addresses and the nonce, because a TDX quote cannot be minted in a test.
 */
const CONTRACT = "tenders.sealedchoice.testnet";
const MODELS = ["Qwen/Qwen3.6-35B-A3B-FP8", "z-ai/glm-5.3-flash"];
const MIN_DELAY_NS = 300_000_000_000n;
const DEADLINE_NS = 1_793_905_570_611_000_000n;

/** One signing key per model, as NEAR AI has one per enclave. */
function signer(seed: number): { sign: (text: string) => string; address: string } {
  const priv = new Uint8Array(32).fill(seed);
  return {
    address: signPersonalSign("probe", priv).address,
    sign: (text: string) => signPersonalSign(text, priv).signature,
  };
}

export interface Fixture {
  evidence: Evidence;
  artifact: { sha256: string; bytes: number };
  /** The bundle as served, so a test can flip one byte of it. */
  bundleBytes: Uint8Array;
}

export function buildFixture(): Fixture {
  const rubric = {
    v: 1,
    title: "Fixture tender",
    models: MODELS,
    budget_cap_minor: "15000000000",
    criteria: [{ id: "price", type: "price", weight_bp: 10000 }],
  };
  const rubricJson = new TextDecoder().decode(jcs(rubric));
  const rubricHash = sha256Hex(utf8ToBytes(rubricJson));

  // Two bids, sealed after the latest creation time the deadline rule allows.
  const firstBidNs = DEADLINE_NS - MIN_DELAY_NS + 12_000_000_000n;
  const bidders = ["vendor-a.sealedchoice.testnet", "vendor-b.sealedchoice.testnet"];
  const bids = bidders.map((bidder, i) => {
    const ciphertext = new Uint8Array(96).fill(i + 1);
    const submitted = firstBidNs + BigInt(i) * 1_000_000_000n;
    return {
      slot: i,
      bidder,
      submitted_at_ns: submitted,
      ciphertext,
      ciphertext_sha256: sha256Hex(ciphertext),
      ciphertext_len: ciphertext.length,
      withdrawn: false,
      leaf: bytesToHex(merkleLeaf(bidder, submitted, ciphertext)),
    };
  });
  const root = bytesToHex(merkleRoot(bids.map((b) => merkleLeaf(b.bidder, b.submitted_at_ns, b.ciphertext))));

  const attempt = 1;
  const nonceHex = sha256Hex(concatBytes(hexToBytes(root), u32le(attempt)));

  const signers = [signer(7), signer(9)];
  const totals = [8666, 4755];
  const modelCalls = bids.flatMap((b, bi) =>
    MODELS.map((model, mi) => {
      const requestSha = sha256Hex(utf8ToBytes(`request:${bi}:${mi}`));
      const responseSha = sha256Hex(utf8ToBytes(`response:${bi}:${mi}`));
      const text = `${model}:${requestSha}:${responseSha}`;
      const s = signers[mi] ?? signers[0];
      if (s === undefined) throw new Error("no signer");
      return {
        bid_index: bi,
        model,
        chat_id: `chat-${bi}-${mi}`,
        attempts: 1,
        request_sha256: requestSha,
        response_sha256: responseSha,
        signature: {
          text,
          signature: s.sign(text),
          signing_address: s.address,
          signing_algo: "ecdsa",
          signature_kind: "provider_tee",
        },
      };
    }),
  );

  const evaluator = {
    wasm_sha256: sha256Hex(utf8ToBytes("evaluator bytes")),
    source_repo: "https://github.com/farouk-allani/sealedchoice",
    source_tag: "evaluator-v0.1.0",
    outlayer_request_id: 9718,
    near_block_height: 276_381_999,
    attempt,
  };

  const resultCore = {
    v: 1,
    tid: "3",
    root,
    rubric: rubricHash,
    attempt,
    status: "ok",
    rk: bids.map((_, i) => [i, (totals[i] ?? 0), 0]),
  };

  const bundleBody = {
    v: 1,
    tender_id: "3",
    contract_id: CONTRACT,
    evaluator,
    rubric_hash: rubricHash,
    prompt_hash: sha256Hex(utf8ToBytes("prompt")),
    bids_root: root,
    bids: bids.map((b, i) => ({
      index: i,
      bidder: b.bidder,
      leaf: b.leaf,
      ciphertext_sha256: b.ciphertext_sha256,
      eligible: true,
      ineligible_reasons: [],
      flags: 0,
      total_bp: (totals[i] ?? 0),
      rank: i + 1,
    })),
    model_calls: modelCalls,
    attestation: {
      nonce_hex: nonceHex,
      reports: [
        {
          scope: "model",
          report: { report_data: `${"a".repeat(64)}${nonceHex}`, signing_addresses: signers.map((s) => s.address) },
        },
      ],
    },
    result: resultCore,
    debriefs: [],
    committee_report: { cipher: "aes-256-gcm", body_b64: toBase64(new Uint8Array(8)), plaintext_sha256: sha256Hex(new Uint8Array(8)), keys: [] },
  };

  const bundleBytes = jcs(bundleBody);
  const bundleHash = sha256Hex(bundleBytes);
  const resultText = new TextDecoder().decode(jcs({ ...resultCore, bundle: bundleHash }));

  const artifactBytes = utf8ToBytes("evaluator bytes");

  return {
    bundleBytes,
    artifact: { sha256: sha256Hex(artifactBytes), bytes: artifactBytes.length },
    evidence: {
      network: "testnet",
      contractId: CONTRACT,
      tenderId: 3,
      minDeadlineDelayNs: MIN_DELAY_NS,
      tender: {
        id: 3,
        buyer: "buyer.sealedchoice.testnet",
        rubric_json: rubricJson,
        rubric_hash: rubricHash,
        deadline_ns: DEADLINE_NS,
        status: "Evaluated",
        evaluator: {
          wasm_url: "https://raw.githubusercontent.com/farouk-allani/sealedchoice-artifacts/main/evaluator/x.wasm",
          wasm_sha256: evaluator.wasm_sha256,
          build_target: "wasm32-wasip2",
          source_tag: "evaluator-v0.1.0",
        },
        committee: [],
        bid_slots: bids.length,
        active_slots: bids.map((b) => b.slot),
        result_json: resultText,
      },
      bids: bids.map((b) => ({
        slot: b.slot,
        bidder: b.bidder,
        submitted_at_ns: b.submitted_at_ns,
        ciphertext_sha256: b.ciphertext_sha256,
        ciphertext_len: b.ciphertext_len,
        withdrawn: b.withdrawn,
      })),
      frozen: { slots: bids.map((b) => b.slot), leaves: bids.map((b) => b.leaf), root },
      attempts: [{ n: 1, started_at_ns: DEADLINE_NS + 10n, outcome: "Accepted" }],
      resultText,
      bundle: { bytes: bundleBytes, etag: `"${bundleHash}"`, url: `https://example.invalid/api/bundles/${bundleHash}` },
      ciphertexts: Object.fromEntries(bids.map((b) => [b.slot, toBase64(b.ciphertext)])),
      codeHash: "9ZrrKTELGfATeTqEmJcY4aFHH3vEuSrHZFrbR6v83iXD",
      explorerBase: "https://testnet.nearblocks.io",
    },
  };
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i += 1) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}


/** The fixture always has these; if it ever does not, the test should say so, not assert it away. */
function must<T>(value: T | null | undefined, what = "value"): T {
  if (value === null || value === undefined) throw new Error(`the fixture has no ${what}`);
  return value;
}

/** A deep-enough copy: the pieces the tests mutate. */
function copy(e: Evidence): Evidence {
  return {
    ...e,
    tender: { ...e.tender, evaluator: { ...e.tender.evaluator } },
    bids: e.bids.map((b) => ({ ...b })),
    frozen: e.frozen ? { ...e.frozen, slots: [...e.frozen.slots], leaves: [...e.frozen.leaves] } : null,
    attempts: e.attempts.map((a) => ({ ...a })),
    bundle: e.bundle ? { ...e.bundle, bytes: Uint8Array.from(e.bundle.bytes) } : null,
    ciphertexts: { ...e.ciphertexts },
  };
}

const byId = (e: Evidence, artifact: Parameters<typeof runChecks>[1], id: number) =>
  must(runChecks(e, artifact).find((r) => r.id === id), `check ${id}`);

describe("a consistent tender", () => {
  it("passes all ten checks", () => {
    const { evidence, artifact } = buildFixture();
    const results = runChecks(evidence, artifact);
    const { passed, total, allPassed } = summarise(results);
    expect(
      results.filter((r) => !r.pass).map((r) => `${r.id} ${r.name}: ${r.details}`),
    ).toEqual([]);
    expect(allPassed).toBe(true);
    expect(passed).toBe(10);
    expect(total).toBe(10);
  });

  it("numbers the checks 1 to 10 in order", () => {
    const { evidence, artifact } = buildFixture();
    expect(runChecks(evidence, artifact).map((r) => r.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });
});

describe("check 1: the rubric", () => {
  it("fails when the rubric string is not the one that was hashed", () => {
    const { evidence, artifact } = buildFixture();
    const e = copy(evidence);
    // The task's negative case: a wrong rubric string.
    e.tender.rubric_json = e.tender.rubric_json.replace("Fixture tender", "Different tender");
    const r = byId(e, artifact, 1);
    expect(r.pass).toBe(false);
    expect(r.details).toMatch(/does not|but the tender stores/);

    // Only check 1 accuses anything: the hash the contract stores still binds the rubric the
    // evaluation used, so checks 6 and 7 keep passing. If a later change made a wrong rubric
    // string fail silently elsewhere instead, this would catch it.
    const all = runChecks(e, artifact);
    expect(all.filter((x) => !x.pass).map((x) => x.id)).toEqual([1]);
  });

  it("fails a rubric that hashes correctly but is not canonical", () => {
    const { evidence, artifact } = buildFixture();
    const e = copy(evidence);
    // Re-space the JSON and re-hash it, so only canonicality is broken.
    const loose = JSON.stringify(JSON.parse(e.tender.rubric_json), null, 1);
    e.tender.rubric_json = loose;
    e.tender.rubric_hash = sha256Hex(utf8ToBytes(loose));
    const r = byId(e, artifact, 1);
    expect(r.pass).toBe(false);
    expect(r.details).toContain("canonical");
  });
});

describe("check 2: fixed before bidding", () => {
  // The fixture carries no `created_at_ns`, which is what a tender from a contract deployed before
  // D-035 looks like. These first tests therefore exercise the deadline-bound fallback, and say so
  // rather than relying on the fixture staying that way.
  it("passes on the deadline bound alone when the first bid is later than it", () => {
    const { evidence, artifact } = buildFixture();
    const e = copy(evidence);
    e.tender.created_at_ns = null;
    const r = byId(e, artifact, 2);
    expect(r.pass).toBe(true);
    expect(r.skipped).toBeFalsy();
    expect(r.details).toContain("refuses a deadline under");
  });

  // A contract that records `created_at_ns` (D-035) turns this row into a plain comparison, so it
  // reaches a verdict on every tender instead of only the ones the deadline bound happens to settle.
  it("uses the recorded creation time in preference to the deadline bound", () => {
    const { evidence, artifact } = buildFixture();
    const e = copy(evidence);
    // The bound alone could not settle this one: the bid lands long before `deadline - min_delay`.
    must(e.bids[0], "first bid").submitted_at_ns = e.tender.deadline_ns - e.minDeadlineDelayNs - 1n;
    e.tender.created_at_ns = must(e.bids[0], "first bid").submitted_at_ns - 1_000_000_000n;
    const r = byId(e, artifact, 2);
    expect(r.pass).toBe(true);
    expect(r.details).toContain("the contract recorded creation at");
  });

  it("fails, not skips, when the recorded creation time is after the first bid", () => {
    const { evidence, artifact } = buildFixture();
    const e = copy(evidence);
    e.tender.created_at_ns = must(e.bids[0], "first bid").submitted_at_ns + 1n;
    const r = byId(e, artifact, 2);
    expect(r.pass).toBe(false);
    expect(r.skipped).toBeFalsy();
    expect(r.details).toContain("A bid cannot predate the tender");
  });

  // A bid early in a window longer than `min_deadline_delay_ns` leaves the deadline bound short of
  // the first bid. That is the chain declining to order the two, not evidence that a rubric moved,
  // so the row must read "not checked". T09 hit this on tender 4: a 15-minute window bid into after
  // 55 seconds, and a sound tender showed a red Fail.
  it("is skipped, not failed, when a bid predates the earliest possible creation", () => {
    const { evidence, artifact } = buildFixture();
    const e = copy(evidence);
    e.tender.created_at_ns = null;
    must(e.bids[0], "first bid").submitted_at_ns = e.tender.deadline_ns - e.minDeadlineDelayNs - 1n;
    const r = byId(e, artifact, 2);
    expect(r.skipped).toBe(true);
    expect(r.details).toContain("cannot order creation against the first bid");
  });

  it("is skipped, not passed, when there are no bids", () => {
    const { evidence, artifact } = buildFixture();
    const e = copy(evidence);
    e.bids = [];
    const r = byId(e, artifact, 2);
    expect(r.pass).toBe(false);
    expect(r.skipped).toBe(true);
  });
});

describe("check 3: the bid set", () => {
  it("fails when a ciphertext does not hash to what the chain recorded", () => {
    const { evidence, artifact } = buildFixture();
    const e = copy(evidence);
    e.ciphertexts[0] = toBase64(new Uint8Array(96).fill(42));
    const r = byId(e, artifact, 3);
    expect(r.pass).toBe(false);
    expect(r.details).toContain("hashes to");
  });

  it("fails when the frozen root is not the root of the leaves", () => {
    const { evidence, artifact } = buildFixture();
    const e = copy(evidence);
    must(e.frozen, "frozen set").root = "0".repeat(64);
    must(e.frozen, "frozen set").leaves = [];
    expect(byId(e, artifact, 3).pass).toBe(false);
  });

  it("is skipped when the tender was never closed", () => {
    const { evidence, artifact } = buildFixture();
    const e = copy(evidence);
    e.frozen = null;
    expect(byId(e, artifact, 3).skipped).toBe(true);
  });
});

describe("check 4: the evaluator", () => {
  it("fails when the published artifact is not the pinned build", () => {
    const { evidence } = buildFixture();
    const r = byId(evidence, { sha256: "b".repeat(64), bytes: 10 }, 4);
    expect(r.pass).toBe(false);
    expect(r.details).toContain("not the pinned");
  });

  it("is skipped, never passed, when the artifact was not downloaded", () => {
    const { evidence } = buildFixture();
    const r = byId(evidence, null, 4);
    expect(r.pass).toBe(false);
    expect(r.skipped).toBe(true);
  });

  it("fails when the bundle disagrees with the pin the contract holds", () => {
    const { evidence, artifact } = buildFixture();
    const e = copy(evidence);
    e.tender.evaluator.wasm_sha256 = "c".repeat(64);
    expect(byId(e, artifact, 4).pass).toBe(false);
  });
});

describe("check 5: one accepted result", () => {
  it("fails when two attempts were accepted", () => {
    const { evidence, artifact } = buildFixture();
    const e = copy(evidence);
    e.attempts = [...e.attempts, { n: 2, started_at_ns: 1n, outcome: "Accepted" }];
    expect(byId(e, artifact, 5).pass).toBe(false);
  });

  it("passes with earlier failures and reports their reasons", () => {
    const { evidence, artifact } = buildFixture();
    const e = copy(evidence);
    e.attempts = [{ n: 1, started_at_ns: 1n, outcome: { Failed: { reason: "E_TIMEOUT" } } }, ...e.attempts];
    const r = byId(e, artifact, 5);
    expect(r.pass).toBe(true);
    expect(r.details).toContain("E_TIMEOUT");
  });
});

describe("check 6: bundle integrity", () => {
  it("fails when one byte of the bundle is flipped", () => {
    const { evidence, artifact } = buildFixture();
    const e = copy(evidence);
    // The task's negative case: tamper with a downloaded copy by exactly one byte.
    const bytes = must(e.bundle, "bundle").bytes;
    const at = Math.floor(bytes.length / 2);
    bytes[at] = (bytes[at] ?? 0) ^ 0x01;
    const r = byId(e, artifact, 6);
    expect(r.pass).toBe(false);
    expect(r.details).toContain("commits to");

    // One flipped byte is caught twice over, which is the useful answer rather than a tidy one.
    // Check 6 sees that the bytes no longer hash to what the on-chain result committed to, and
    // check 8 sees that a signature no longer covers the content it signed. The chain-only checks
    // are untouched, because nothing on the chain changed. Pinning the whole profile keeps a
    // later change from quietly widening or narrowing what a single flipped byte reports.
    const all = runChecks(e, artifact);
    expect(all.filter((x) => !x.pass).map((x) => x.id)).toEqual([6, 8]);
    expect(all.filter((x) => x.skipped === true)).toEqual([]);
    expect(all.filter((x) => x.pass).map((x) => x.id)).toEqual([1, 2, 3, 4, 5, 7, 9, 10]);
  });

  it("fails when the store serves a different ETag from the committed hash", () => {
    const { evidence, artifact } = buildFixture();
    const e = copy(evidence);
    must(e.bundle, "bundle").etag = `"${"d".repeat(64)}"`;
    expect(byId(e, artifact, 6).pass).toBe(false);
  });

  it("accepts a weak ETag, which a compressing CDN is obliged to send", () => {
    const { evidence, artifact } = buildFixture();
    const e = copy(evidence);
    const strong = must(must(e.bundle, "bundle").etag, "etag").replace(/"/g, "");
    must(e.bundle, "bundle").etag = `W/"${strong}"`;
    expect(byId(e, artifact, 6).pass).toBe(true);
  });
});

describe("check 7: model calls", () => {
  it("fails when a pinned model never saw an eligible bid", () => {
    const { evidence, artifact } = buildFixture();
    const e = copy(evidence);
    const text = new TextDecoder().decode(must(e.bundle, "bundle").bytes);
    const body = JSON.parse(text) as { model_calls: unknown[] };
    body.model_calls = body.model_calls.slice(1);
    must(e.bundle, "bundle").bytes = utf8ToBytes(JSON.stringify(body));
    const r = byId(e, artifact, 7);
    expect(r.pass).toBe(false);
    expect(r.details).toContain("no call to");
  });
});

describe("check 8: signatures", () => {
  it("fails when a signature does not recover to its published address", () => {
    const { evidence, artifact } = buildFixture();
    const e = copy(evidence);
    const body = JSON.parse(new TextDecoder().decode(must(e.bundle, "bundle").bytes)) as {
      model_calls: { signature: { signing_address: string } }[];
    };
    must(body.model_calls[0], "model call").signature.signing_address = `0x${"1".repeat(40)}`;
    must(e.bundle, "bundle").bytes = utf8ToBytes(JSON.stringify(body));
    const r = byId(e, artifact, 8);
    expect(r.pass).toBe(false);
    expect(r.details).toContain("does not recover");
  });

  it("fails a gateway signature even when it verifies", () => {
    const { evidence, artifact } = buildFixture();
    const e = copy(evidence);
    const body = JSON.parse(new TextDecoder().decode(must(e.bundle, "bundle").bytes)) as {
      model_calls: { signature: { signature_kind: string } }[];
    };
    must(body.model_calls[0], "model call").signature.signature_kind = "gateway";
    must(e.bundle, "bundle").bytes = utf8ToBytes(JSON.stringify(body));
    const r = byId(e, artifact, 8);
    expect(r.pass).toBe(false);
    expect(r.details).toContain("not provider_tee");
  });

  it("fails when the signed text is not <model>:<request>:<response>", () => {
    const { evidence, artifact } = buildFixture();
    const e = copy(evidence);
    const body = JSON.parse(new TextDecoder().decode(must(e.bundle, "bundle").bytes)) as {
      model_calls: { response_sha256: string }[];
    };
    must(body.model_calls[0], "model call").response_sha256 = "e".repeat(64);
    must(e.bundle, "bundle").bytes = utf8ToBytes(JSON.stringify(body));
    expect(byId(e, artifact, 8).pass).toBe(false);
  });
});

describe("check 9: attestation", () => {
  it("fails when the nonce does not bind this root and attempt", () => {
    const { evidence, artifact } = buildFixture();
    const e = copy(evidence);
    const body = JSON.parse(new TextDecoder().decode(must(e.bundle, "bundle").bytes)) as {
      attestation: { nonce_hex: string };
    };
    body.attestation.nonce_hex = "f".repeat(64);
    must(e.bundle, "bundle").bytes = utf8ToBytes(JSON.stringify(body));
    const r = byId(e, artifact, 9);
    expect(r.pass).toBe(false);
    expect(r.details).toContain("sha256(bids_root");
  });

  it("fails when a signing address is absent from the reports", () => {
    const { evidence, artifact } = buildFixture();
    const e = copy(evidence);
    const body = JSON.parse(new TextDecoder().decode(must(e.bundle, "bundle").bytes)) as {
      attestation: { reports: { report: { signing_addresses: string[] } }[] };
    };
    must(body.attestation.reports[0], "report").report.signing_addresses = [];
    must(e.bundle, "bundle").bytes = utf8ToBytes(JSON.stringify(body));
    const r = byId(e, artifact, 9);
    expect(r.pass).toBe(false);
    expect(r.details).toContain("absent from the attestation");
  });
});

describe("check 10: the ranking", () => {
  it("fails when a lower total is ranked above a higher one", () => {
    const { evidence, artifact } = buildFixture();
    const e = copy(evidence);
    const result = JSON.parse(must(e.resultText, "result")) as { rk: number[][] };
    result.rk = [
      [0, 100, 0],
      [1, 900, 0],
    ];
    e.resultText = JSON.stringify(result);
    const r = byId(e, artifact, 10);
    expect(r.pass).toBe(false);
    expect(r.details).toContain("ranked below");
  });

  it("fails when an eligible bid is ranked after an ineligible one", () => {
    const { evidence, artifact } = buildFixture();
    const e = copy(evidence);
    const result = JSON.parse(must(e.resultText, "result")) as { rk: number[][] };
    result.rk = [
      [0, 0, 1],
      [1, 900, 0],
    ];
    e.resultText = JSON.stringify(result);
    const r = byId(e, artifact, 10);
    expect(r.pass).toBe(false);
    expect(r.details).toContain("ranked after an ineligible");
  });

  it("fails when the same bid is ranked twice", () => {
    const { evidence, artifact } = buildFixture();
    const e = copy(evidence);
    const result = JSON.parse(must(e.resultText, "result")) as { rk: number[][] };
    result.rk = [
      [0, 900, 0],
      [0, 100, 0],
    ];
    e.resultText = JSON.stringify(result);
    expect(byId(e, artifact, 10).pass).toBe(false);
  });
});

describe("a missing result", () => {
  it("skips the checks that need one rather than failing them as wrong", () => {
    const { evidence, artifact } = buildFixture();
    const e = copy(evidence);
    e.resultText = null;
    const results = runChecks(e, artifact);
    for (const id of [6, 10]) {
      expect(must(results.find((r) => r.id === id), `check ${id}`).skipped).toBe(true);
    }
    // A skip is never a pass: the CLI must still exit non-zero.
    expect(summarise(results).allPassed).toBe(false);
  });
});
