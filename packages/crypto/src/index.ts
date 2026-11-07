// Crypto primitives shared by the browser, scripts and the verifier (docs/05-crypto-and-keys.md).
// Browser-safe: no Node built-ins, no Buffer.
export {
  bytesEqual,
  bytesToHex,
  concatBytes,
  fromBase64,
  hexToBytes,
  sha256Bytes,
  sha256Hex,
  toBase64,
  u32le,
  u64le,
  utf8ToBytes,
} from "./bytes.ts";
export {
  SignatureFormatError,
  addressOfPublicKey,
  personalSignDigest,
  recoverPersonalSignAddress,
  verifyPersonalSign,
} from "./eip191.ts";
export { JcsError, jcs, jcsString } from "./jcs.ts";
export { merkleLeaf, merkleParent, merkleProof, merkleRoot, merkleVerify } from "./merkle.ts";
export type { ProofStep } from "./merkle.ts";
export {
  SALT_COMMITTEE,
  SALT_DEBRIEF,
  SALT_TENDER,
  deriveSecp256k1,
  hkdfSha256,
  isCompressedPublicKeyHex,
  keyDerivationMessage,
  nep413Nonce,
  publicKeyCompressed,
  readerKey,
} from "./keys.ts";
export type { ReaderPurpose } from "./keys.ts";
export { ECIES_OVERHEAD, eciesDecrypt, eciesEncrypt } from "./ecies.ts";
export { BidValidationError, buildBidPlaintext, randomSaltHex } from "./bid.ts";
export type { BidInput, BuiltBid } from "./bid.ts";
