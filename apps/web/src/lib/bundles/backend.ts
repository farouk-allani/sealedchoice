// Storage behind the bundle store route (docs/06-evidence-and-verification.md "Bundle store",
// DECISIONS D-021). The route does every check (token, size, hash, write-once); a backend only
// stores and returns bytes by their sha256. Two drivers: `local` (filesystem, used by the tests
// and local development) and `vercel-blob`.

/** What a write did. `conflict` means different bytes already sit under that hash: content
 * addressing makes it impossible unless the store was tampered with, so the route refuses it. */
export type PutOutcome = "created" | "exists" | "conflict";

export interface BundleBackend {
  readonly name: string;
  /** The stored bytes, or null when nothing is stored under this hash. */
  get(sha256: string): Promise<Uint8Array | null>;
  /** Stores `body` under `sha256` unless something is already there. Never overwrites. */
  putIfAbsent(sha256: string, body: Uint8Array): Promise<PutOutcome>;
}

/** Lowercase hex of 32 bytes: the only path form the store accepts. */
export const SHA256_HEX = /^[0-9a-f]{64}$/;
