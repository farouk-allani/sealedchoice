// Hashing JSON text received from elsewhere (a bundle, a rubric, a compact result; docs/06 check 1).
// Its hash only means something if the text is its own JCS form. `jcs()` alone cannot tell:
// `JSON.parse` turns `5.0` into `5` and rounds integers beyond 2^53, so the text itself is compared
// with the JCS of what it parses to (D-017).
import { JcsError, jcsString, sha256Hex, utf8ToBytes } from "@tender/crypto";

export class NotCanonicalError extends Error {
  override name = "NotCanonicalError";
}

/** True when `text` is exactly the JCS serialization of the value it parses to. */
export function isCanonicalJson(text: string): boolean {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return false;
  }
  try {
    return jcsString(value) === text;
  } catch (e) {
    if (e instanceof JcsError) return false; // floats, unsafe integers, non-ASCII keys …
    throw e;
  }
}

/** sha256 (lowercase hex) of canonical JSON text; throws NotCanonicalError for any other text. */
export function sha256OfCanonicalJson(text: string): string {
  if (!isCanonicalJson(text)) throw new NotCanonicalError("JSON text is not its own JCS form");
  return sha256Hex(utf8ToBytes(text));
}
