// Canonical JSON (RFC 8785) for the subset we hash: objects with ASCII keys, arrays,
// strings, safe integers, booleans, null. Anything else throws instead of being
// silently changed (docs/05-crypto-and-keys.md, reference.py `jcs`).
import canonicalize from "canonicalize";
import { utf8ToBytes } from "./bytes.ts";

export class JcsError extends TypeError {
  override name = "JcsError";
}

function isAscii(s: string): boolean {
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) > 0x7f) return false;
  return true;
}

function check(value: unknown, path: string): void {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isInteger(value)) throw new JcsError(`${path}: floats are not allowed in hashed JSON`);
    if (!Number.isSafeInteger(value)) throw new JcsError(`${path}: integer outside the safe range; use a string`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => check(v, `${path}[${i}]`));
    return;
  }
  if (typeof value === "object") {
    const proto = Object.getPrototypeOf(value) as unknown;
    if (proto !== Object.prototype && proto !== null) throw new JcsError(`${path}: only plain objects are allowed`);
    for (const [k, v] of Object.entries(value)) {
      if (!isAscii(k)) throw new JcsError(`${path}: keys must be ASCII`);
      if (v === undefined) throw new JcsError(`${path}.${k}: undefined is not JSON`);
      check(v, `${path}.${k}`);
    }
    return;
  }
  throw new JcsError(`${path}: ${typeof value} is not allowed in hashed JSON`);
}

/** JCS text of `value`. Throws JcsError on floats, unsafe integers, non-ASCII keys, non-JSON values. */
export function jcsString(value: unknown): string {
  check(value, "$");
  const out = canonicalize(value);
  if (out === undefined) throw new JcsError("$: value has no JSON representation");
  return out;
}

/** UTF-8 bytes of the JCS text. */
export function jcs(value: unknown): Uint8Array {
  return utf8ToBytes(jcsString(value));
}
