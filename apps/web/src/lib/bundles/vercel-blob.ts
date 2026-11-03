// Vercel Blob driver (DECISIONS D-021), `@vercel/blob` 2.8.2. One blob per bundle at
// `bundles/<sha256>.json`, written with `allowOverwrite: false` and no random suffix.
// Authentication: `BLOB_READ_WRITE_TOKEN` (the SDK's default) unless a token is passed.
import { bytesEqual } from "@tender/crypto";
import { get, put } from "@vercel/blob";
import { type BundleBackend, type PutOutcome, SHA256_HEX } from "./backend";

export interface VercelBlobOptions {
  /** Blob access mode of the store. Bundles are public either way: readers go through the route. */
  access: "public" | "private";
  /** Read-write token; omitted → the SDK reads `BLOB_READ_WRITE_TOKEN`. */
  token?: string;
}

/** One year: a bundle never changes under its hash. */
const CACHE_SECONDS = 365 * 24 * 60 * 60;

export function vercelBlobBackend(opts: VercelBlobOptions): BundleBackend {
  const pathname = (sha256: string): string => {
    if (!SHA256_HEX.test(sha256)) throw new Error("bundle store: bad hash");
    return `bundles/${sha256}.json`;
  };
  const auth = opts.token === undefined ? {} : { token: opts.token };

  async function read(sha256: string): Promise<Uint8Array | null> {
    // Origin, not CDN: a cached "not found" must not hide a bundle written a moment ago.
    const r = await get(pathname(sha256), { access: opts.access, useCache: false, ...auth });
    if (r === null || r.statusCode !== 200) return null;
    return new Uint8Array(await new Response(r.stream).arrayBuffer());
  }

  async function putIfAbsent(sha256: string, body: Uint8Array): Promise<PutOutcome> {
    const existing = await read(sha256);
    if (existing !== null) return bytesEqual(existing, body) ? "exists" : "conflict";
    try {
      await put(pathname(sha256), body.slice().buffer, {
        access: opts.access,
        addRandomSuffix: false,
        allowOverwrite: false,
        contentType: "application/json",
        cacheControlMaxAge: CACHE_SECONDS,
        ...auth,
      });
      return "created";
    } catch (e) {
      // `put` refuses to overwrite: a concurrent writer may have stored the same hash first.
      const now = await read(sha256);
      if (now === null) throw e;
      return bytesEqual(now, body) ? "exists" : "conflict";
    }
  }

  return { name: "vercel-blob", get: read, putIfAbsent };
}
