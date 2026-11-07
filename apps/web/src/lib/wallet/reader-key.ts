// Reader keys (docs/05-crypto-and-keys.md "Reader keys"). A bidder's debrief key and a committee
// member's report key are HKDF of a NEP-413 wallet signature, so there is no extra secret to look
// after and the same wallet re-derives the same key later.
//
// The private key is returned to the caller and never written anywhere by this module. The only
// way it leaves the page is the download fallback below, which the user asks for.
import {
  SALT_COMMITTEE,
  SALT_DEBRIEF,
  bytesToHex,
  deriveSecp256k1,
  hexToBytes,
  keyDerivationMessage,
  nep413Nonce,
  publicKeyCompressed,
  readerKey,
  utf8ToBytes,
} from "@tender/crypto";
import type { ReaderPurpose } from "@tender/crypto";

export type { ReaderPurpose };

export interface ReaderKeyPair {
  /** 32 bytes. Never persist this, never send it anywhere. */
  secretKey: Uint8Array;
  /** 33-byte compressed point, lowercase hex. This is what goes on chain. */
  publicKeyHex: string;
  /** How it was made, so the UI can tell the user what to keep. */
  source: "wallet" | "generated" | "file";
}

const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function base58Decode(text: string): Uint8Array {
  let num = 0n;
  for (const ch of text) {
    const index = BASE58.indexOf(ch);
    if (index < 0) throw new Error("signature is not valid base58");
    num = num * 58n + BigInt(index);
  }
  const out: number[] = [];
  while (num > 0n) {
    out.unshift(Number(num & 0xffn));
    num >>= 8n;
  }
  for (const ch of text) {
    if (ch !== "1") break;
    out.unshift(0);
  }
  return Uint8Array.from(out);
}

function base64Decode(text: string): Uint8Array {
  const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

/**
 * The 64 raw signature bytes. NEAR Connect hands back base64 (G5), but a wallet or a pasted
 * value may carry the `ed25519:<base58>` form, so both are accepted.
 */
export function signatureBytes(signature: string): Uint8Array {
  const bytes = signature.startsWith("ed25519:")
    ? base58Decode(signature.slice("ed25519:".length))
    : base64Decode(signature);
  if (bytes.length !== 64) {
    throw new Error(`expected a 64-byte ed25519 signature, got ${bytes.length} bytes`);
  }
  return bytes;
}

export interface DeriveParams {
  purpose: ReaderPurpose;
  contractId: string;
  tenderId: string;
  accountId: string;
}

/** What the wallet is asked to sign. Shown to the user before they approve it. */
export function derivationRequest(params: Omit<DeriveParams, "accountId">): {
  message: string;
  nonce: Uint8Array;
  recipient: string;
} {
  const message = keyDerivationMessage(params.contractId, params.tenderId, params.purpose);
  return { message, nonce: nep413Nonce(message), recipient: params.contractId };
}

type SignMessage = (params: {
  message: string;
  recipient: string;
  nonce: Uint8Array;
}) => Promise<{ accountId: string; signature: string }>;

/**
 * Derive the reader key from a wallet signature. The account the key is bound to is the one the
 * wallet says signed, not the one the caller believed: a wallet with several accounts can sign
 * with a different one, and a key derived under the wrong account id decrypts nothing.
 */
export async function deriveReaderKeyFromWallet(
  signMessage: SignMessage,
  params: DeriveParams,
): Promise<ReaderKeyPair & { accountId: string }> {
  const { message, nonce, recipient } = derivationRequest(params);
  const signed = await signMessage({ message, recipient, nonce });
  const accountId = signed.accountId || params.accountId;
  const secretKey = readerKey(
    signatureBytes(signed.signature),
    params.purpose,
    params.contractId,
    params.tenderId,
    accountId,
  );
  return {
    secretKey,
    publicKeyHex: bytesToHex(publicKeyCompressed(secretKey)),
    source: "wallet",
    accountId,
  };
}

/**
 * The fallback of docs/05: a key the browser generates, for a wallet that does not sign
 * deterministically and for anyone who would rather keep a file. G5 found no non-deterministic
 * wallet among the ones testnet offers, so this is a choice, not a workaround.
 *
 * `deriveSecp256k1` is used rather than raw random bytes so the result is always a valid scalar.
 */
export function generateReaderKey(params: DeriveParams): ReaderKeyPair {
  const ikm = new Uint8Array(32);
  crypto.getRandomValues(ikm);
  const salt = params.purpose === "committee" ? SALT_COMMITTEE : SALT_DEBRIEF;
  const info = `${params.contractId}:${params.tenderId}:${params.accountId}`;
  const secretKey = deriveSecp256k1(ikm, utf8ToBytes(salt), utf8ToBytes(info));
  ikm.fill(0);
  return {
    secretKey,
    publicKeyHex: bytesToHex(publicKeyCompressed(secretKey)),
    source: "generated",
  };
}

export interface ReaderKeyFile {
  format: "sealedchoice-reader-key";
  v: 1;
  purpose: ReaderPurpose;
  contract_id: string;
  tender_id: string;
  account_id: string;
  public_key: string;
  secret_key: string;
  created_at: string;
  warning: string;
}

/** Suggested file name from docs/05. */
export function readerKeyFileName(params: Pick<DeriveParams, "tenderId" | "accountId">): string {
  return `sealedchoice-key-${params.tenderId}-${params.accountId}.json`;
}

/** The downloadable file. Holds the private key: it is the thing the user must keep safe. */
export function readerKeyFile(key: ReaderKeyPair, params: DeriveParams): ReaderKeyFile {
  return {
    format: "sealedchoice-reader-key",
    v: 1,
    purpose: params.purpose,
    contract_id: params.contractId,
    tender_id: params.tenderId,
    account_id: params.accountId,
    public_key: key.publicKeyHex,
    secret_key: bytesToHex(key.secretKey),
    created_at: new Date().toISOString(),
    warning:
      "This file holds the private key that decrypts your result for this tender. " +
      "Anyone who has it can read that result. Keep it, and do not send it to anyone.",
  };
}

/** Read a key file back. Checks that the key in it really is the key it claims to be. */
export function loadReaderKeyFile(text: string): ReaderKeyPair & { file: ReaderKeyFile } {
  const parsed = JSON.parse(text) as ReaderKeyFile;
  if (parsed?.format !== "sealedchoice-reader-key" || parsed.v !== 1) {
    throw new Error("not a SealedChoice reader key file");
  }
  if (!/^[0-9a-f]{64}$/.test(parsed.secret_key)) throw new Error("the key file is malformed");
  const secretKey = hexToBytes(parsed.secret_key);
  const publicKeyHex = bytesToHex(publicKeyCompressed(secretKey));
  if (publicKeyHex !== parsed.public_key) {
    throw new Error("the key file's public key does not match its private key");
  }
  return { secretKey, publicKeyHex, source: "file", file: parsed };
}
