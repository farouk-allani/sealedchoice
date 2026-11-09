/** Shared boundary for private readers: authenticate fetched bytes before parsing or decrypting. */
import { compactResultSchema } from "@tender/shared";
import type { CompactResult } from "@tender/shared";
import { sha256Hex } from "@tender/crypto";

/** Keep each opener's public error type while enforcing the same chain commitment. */
export function requireBundleCommitment(
  bytes: Uint8Array,
  resultText: string | null,
  ErrorType: new (message: string) => Error,
): CompactResult {
  if (resultText === null || resultText === "") {
    throw new ErrorType("the contract has stored no accepted result for this tender yet");
  }
  let result: CompactResult;
  try {
    result = compactResultSchema.parse(JSON.parse(resultText));
  } catch {
    throw new ErrorType("the contract's accepted result could not be validated, so no report can be opened");
  }
  if (sha256Hex(bytes) !== result.bundle) {
    throw new ErrorType(
      "the evidence bundle does not match the hash in the contract's accepted result, so this report cannot be opened",
    );
  }
  return result;
}
