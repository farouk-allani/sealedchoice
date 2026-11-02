// Bid-set Merkle tree (docs/05-crypto-and-keys.md, reference.py merkle_*).
//   leaf   = sha256(0x00 || u32le(len(bidder_utf8)) || bidder_utf8 || u64le(submitted_at_ns) || sha256(ciphertext))
//   parent = sha256(0x01 || left || right)
// Leaves in frozen order; an odd last node is promoted unchanged.
import { sha256 } from "@noble/hashes/sha2";
import { bytesEqual, bytesToHex, concatBytes, hexToBytes, u32le, u64le, utf8ToBytes } from "./bytes.ts";

export interface ProofStep {
  /** Position of the sibling. */
  side: "L" | "R";
  /** Sibling hash, lowercase hex. */
  hash: string;
}

export function merkleLeaf(bidder: string, submittedAtNs: bigint, ciphertext: Uint8Array): Uint8Array {
  const b = utf8ToBytes(bidder);
  return sha256(concatBytes(Uint8Array.of(0x00), u32le(b.length), b, u64le(submittedAtNs), sha256(ciphertext)));
}

export function merkleParent(left: Uint8Array, right: Uint8Array): Uint8Array {
  return sha256(concatBytes(Uint8Array.of(0x01), left, right));
}

function nextLevel(level: readonly Uint8Array[]): Uint8Array[] {
  const next: Uint8Array[] = [];
  for (let i = 0; i < level.length; i += 2) {
    const left = level[i] as Uint8Array;
    const right = level[i + 1];
    next.push(right === undefined ? left : merkleParent(left, right));
  }
  return next;
}

export function merkleRoot(leaves: readonly Uint8Array[]): Uint8Array {
  if (leaves.length === 0) throw new RangeError("empty bid set has no root");
  let level = [...leaves];
  while (level.length > 1) level = nextLevel(level);
  return level[0] as Uint8Array;
}

/** Proof from leaf `index` to the root; levels where the node is promoted add no step. */
export function merkleProof(leaves: readonly Uint8Array[], index: number): ProofStep[] {
  if (!Number.isInteger(index) || index < 0 || index >= leaves.length) throw new RangeError(`no leaf ${index}`);
  const proof: ProofStep[] = [];
  let level = [...leaves];
  let i = index;
  while (level.length > 1) {
    if (i % 2 === 0) {
      const sibling = level[i + 1];
      if (sibling !== undefined) proof.push({ side: "R", hash: bytesToHex(sibling) });
    } else {
      proof.push({ side: "L", hash: bytesToHex(level[i - 1] as Uint8Array) });
    }
    level = nextLevel(level);
    i = Math.floor(i / 2);
  }
  return proof;
}

export function merkleVerify(leaf: Uint8Array, proof: readonly ProofStep[], root: Uint8Array): boolean {
  let cur = leaf;
  for (const step of proof) {
    const sibling = hexToBytes(step.hash);
    cur = step.side === "L" ? merkleParent(sibling, cur) : merkleParent(cur, sibling);
  }
  return bytesEqual(cur, root);
}
