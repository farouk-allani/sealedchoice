// Byte helpers that work the same in browsers and Node (no Buffer).
import { bytesToHex, concatBytes, hexToBytes, utf8ToBytes } from "@noble/hashes/utils";
import { sha256 } from "@noble/hashes/sha2";

export { bytesToHex, concatBytes, hexToBytes, utf8ToBytes };

export function sha256Bytes(data: Uint8Array): Uint8Array {
  return sha256(data);
}

/** Lowercase hex of sha256(data). */
export function sha256Hex(data: Uint8Array): string {
  return bytesToHex(sha256(data));
}

export function u32le(n: number): Uint8Array {
  if (!Number.isInteger(n) || n < 0 || n > 0xffff_ffff) throw new RangeError(`not a u32: ${n}`);
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, n, true);
  return out;
}

export function u64le(n: bigint): Uint8Array {
  if (n < 0n || n > 0xffff_ffff_ffff_ffffn) throw new RangeError(`not a u64: ${n}`);
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigUint64(0, n, true);
  return out;
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= (a[i] as number) ^ (b[i] as number);
  return diff === 0;
}

export function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

export function fromBase64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
