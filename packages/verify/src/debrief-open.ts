/**
 * Opening a debrief: envelope in, checked result out.
 *
 * This lives here rather than in a component so that no page holds crypto (`.claude/rules/web.md`)
 * and so the debrief page and any script open an envelope exactly the same way. The caller's only
 * job is to get a reader key from the wallet and hand over the evidence it already fetched.
 */
import { compactResultSchema, debriefSchema, evidenceBundleSchema, rubricSchema } from "@tender/shared";
import type { Debrief } from "@tender/shared";
import { bytesToHex, eciesDecrypt, fromBase64, publicKeyCompressed } from "@tender/crypto";
import { runDebriefChecks } from "./debrief.ts";
import type { DebriefEvidence, FrozenBid } from "./debrief.ts";
import type { CheckResult, Evidence } from "./evidence.ts";

export class DebriefError extends Error {
  override name = "DebriefError";
}

export interface OpenDebriefOptions {
  /** What `loadEvidence` returned for this tender. */
  evidence: Evidence;
  /** The reader key derived from the wallet signature. Never leaves the caller. */
  secretKey: Uint8Array;
  /**
   * The bidder's own proposal plaintext, if they still have it. Without it checks 3 and 4 do what
   * they can and say what they could not do: a bid's plaintext is encrypted to the tender key,
   * which exists only inside the TEE, so not even its author can recover it from the chain.
   */
  proposalPlaintext?: Uint8Array;
}

export interface OpenedDebrief {
  debrief: Debrief;
  results: CheckResult[];
  /** Everything the checks ran against, for a page that wants to show the detail. */
  input: DebriefEvidence;
  /** Which frozen index this key opened. */
  bidIndex: number;
}

/**
 * Decrypt the caller's envelope and run the five bidder checks over it.
 *
 * Throws `DebriefError` with a sentence a bidder can act on. The commonest cause by far is a key
 * derived under a different account than the one that bid, which produces no matching envelope
 * rather than a decryption failure, so that case is reported separately.
 */
export function openDebrief(o: OpenDebriefOptions): OpenedDebrief {
  const e = o.evidence;
  if (e.bundle === null) {
    throw new DebriefError("the evidence bundle for this tender could not be fetched, so there is nothing to open");
  }
  if (e.frozen === null) {
    throw new DebriefError("this tender has not been closed yet, so no debriefs exist");
  }

  let bundle: ReturnType<typeof evidenceBundleSchema.parse>;
  try {
    bundle = evidenceBundleSchema.parse(JSON.parse(new TextDecoder().decode(e.bundle.bytes)));
  } catch (err) {
    throw new DebriefError(`the bundle did not parse: ${String(err).slice(0, 140)}`);
  }

  const myPubkey = bytesToHex(publicKeyCompressed(o.secretKey));
  const envelope = bundle.debriefs.find((d) => d.recipient_pubkey === myPubkey);
  if (envelope === undefined) {
    throw new DebriefError(
      "no envelope in this bundle is addressed to your key. A reader key is bound to the account that signed, " +
        "so this usually means the wallet signed with a different account than the one that bid",
    );
  }
  if (envelope.ecies_b64 === "") {
    const why = envelope.error ?? "no envelope was written";
    throw new DebriefError(`your debrief was not encrypted for you: ${why}`);
  }

  let plaintext: Uint8Array;
  try {
    plaintext = eciesDecrypt(o.secretKey, fromBase64(envelope.ecies_b64));
  } catch {
    throw new DebriefError("the envelope addressed to your key did not decrypt under it");
  }

  let debrief: Debrief;
  try {
    debrief = debriefSchema.parse(JSON.parse(new TextDecoder().decode(plaintext)));
  } catch (err) {
    throw new DebriefError(`the decrypted debrief did not match its schema: ${String(err).slice(0, 140)}`);
  }

  let rubric: ReturnType<typeof rubricSchema.parse>;
  try {
    rubric = rubricSchema.parse(JSON.parse(e.tender.rubric_json));
  } catch (err) {
    throw new DebriefError(`the tender's rubric did not parse: ${String(err).slice(0, 140)}`);
  }

  let ranking: readonly (readonly number[])[];
  try {
    ranking = compactResultSchema.parse(JSON.parse(e.resultText ?? "")).rk;
  } catch {
    throw new DebriefError("the contract has stored no accepted result for this tender yet");
  }

  const frozen = frozenBids(e);
  const input: DebriefEvidence = {
    debrief,
    plaintext,
    envelopeSha256: envelope.plaintext_sha256,
    bundle,
    rubric,
    frozen,
    frozenRoot: e.frozen.root,
    ranking,
    proposalPlaintext: o.proposalPlaintext,
  };
  return { debrief, results: runDebriefChecks(input), input, bidIndex: debrief.bid_index };
}

/** The frozen set in frozen order, which is what `bid_index` indexes (D-033). */
function frozenBids(e: Evidence): FrozenBid[] {
  if (e.frozen === null) return [];
  const bySlot = new Map(e.bids.map((b) => [b.slot, b]));
  const out: FrozenBid[] = [];
  for (const slot of e.frozen.slots) {
    const bid = bySlot.get(slot);
    const b64 = e.ciphertexts[slot];
    if (bid === undefined || b64 === undefined) {
      throw new DebriefError(`the chain did not return the bid or ciphertext for frozen slot ${slot}`);
    }
    out.push({
      slot,
      bidder: bid.bidder,
      submitted_at_ns: bid.submitted_at_ns,
      ciphertext: fromBase64(b64),
    });
  }
  return out;
}
