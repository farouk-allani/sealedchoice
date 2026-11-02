// Builds the bid plaintext in the browser: validated object + JCS bytes (the ECIES plaintext).
import { bidPlaintextSchema, MAX_CIPHERTEXT_BYTES, type BidPlaintext } from "@tender/shared";
import { bytesToHex } from "./bytes.ts";
import { ECIES_OVERHEAD } from "./ecies.ts";
import { jcs } from "./jcs.ts";

export type BidInput = Omit<BidPlaintext, "v" | "salt">;

export interface BuiltBid {
  plaintext: BidPlaintext;
  /** JCS bytes of `plaintext`: exactly what gets encrypted. */
  bytes: Uint8Array;
}

export class BidValidationError extends Error {
  override name = "BidValidationError";
  constructor(readonly issues: readonly { path: string; message: string }[]) {
    super(`invalid bid: ${issues.map((i) => `${i.path}: ${i.message}`).join("; ")}`);
  }
}

/** 16 random bytes as lowercase hex, from the platform CSPRNG (Web Crypto). */
export function randomSaltHex(): string {
  return bytesToHex(globalThis.crypto.getRandomValues(new Uint8Array(16)));
}

export function buildBidPlaintext(input: BidInput, salt: string = randomSaltHex()): BuiltBid {
  const parsed = bidPlaintextSchema.safeParse({ v: 1, ...input, salt });
  if (!parsed.success) {
    throw new BidValidationError(
      parsed.error.issues.map((i) => ({ path: i.path.join(".") || "$", message: i.message })),
    );
  }
  const bytes = jcs(parsed.data);
  if (bytes.length + ECIES_OVERHEAD > MAX_CIPHERTEXT_BYTES) {
    throw new BidValidationError([
      { path: "$", message: `encrypted bid would be ${bytes.length + ECIES_OVERHEAD} bytes (max ${MAX_CIPHERTEXT_BYTES})` },
    ]);
  }
  return { plaintext: parsed.data, bytes };
}
