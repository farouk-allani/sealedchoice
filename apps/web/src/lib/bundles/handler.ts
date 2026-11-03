// The bundle store's rules (docs/06-evidence-and-verification.md "Bundle store", task T06), kept
// apart from Next.js so tests call them directly with any backend:
// - PUT needs `Authorization: Bearer <BUNDLE_STORE_TOKEN>`; the body is at most MAX_BUNDLE_BYTES;
//   sha256(body) must equal the path; writes are once only, a repeat of the same bytes is a no-op.
// - GET is public and immutable. Bytes read back are hashed again before they are served, so a
//   store can withhold a bundle but cannot alter one through this route.
// - Nothing configured (no backend or no token) → 503: the store fails closed.
import { bytesEqual, concatBytes, sha256Bytes, sha256Hex, utf8ToBytes } from "@tender/crypto";
import { type BundleBackend, SHA256_HEX } from "./backend";

export interface BundleStore {
  /** null when the deployment has no backend configured. */
  backend: BundleBackend | null;
  /** The server's BUNDLE_STORE_TOKEN; undefined or empty refuses every PUT. */
  token: string | undefined;
  maxBytes: number;
}

const NO_STORE = { "Cache-Control": "no-store" };
const IMMUTABLE = "public, max-age=31536000, immutable";

function fail(status: number, error: string, headers: Record<string, string> = {}): Response {
  return Response.json({ error }, { status, headers: { ...NO_STORE, ...headers } });
}

/** Constant-time comparison of two tokens of any length (both are hashed first). */
function tokenMatches(given: string, expected: string): boolean {
  return bytesEqual(sha256Bytes(utf8ToBytes(given)), sha256Bytes(utf8ToBytes(expected)));
}

function bearer(req: Request): string | null {
  const h = req.headers.get("authorization");
  if (h === null) return null;
  const m = /^Bearer (\S+)$/.exec(h);
  return m?.[1] ?? null;
}

/** The request body, or null as soon as it passes `max` bytes. */
async function readLimited(req: Request, max: number): Promise<Uint8Array | null> {
  if (req.body === null) return new Uint8Array(0);
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return concatBytes(...chunks);
}

export async function handlePut(req: Request, sha256: string, store: BundleStore): Promise<Response> {
  if (store.backend === null || store.token === undefined || store.token === "") {
    return fail(503, "E_STORE_NOT_CONFIGURED");
  }
  const given = bearer(req);
  if (given === null || !tokenMatches(given, store.token)) {
    return fail(401, "E_UNAUTHORIZED", { "WWW-Authenticate": "Bearer" });
  }
  if (!SHA256_HEX.test(sha256)) return fail(400, "E_BAD_HASH");
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > store.maxBytes) return fail(413, "E_TOO_LARGE");
  const body = await readLimited(req, store.maxBytes);
  if (body === null) return fail(413, "E_TOO_LARGE");
  if (body.length === 0) return fail(400, "E_EMPTY_BODY");
  if (sha256Hex(body) !== sha256) return fail(400, "E_HASH_MISMATCH");

  const outcome = await store.backend.putIfAbsent(sha256, body);
  switch (outcome) {
    case "created":
      return Response.json({ sha256, stored: true }, { status: 201, headers: NO_STORE });
    case "exists":
      return Response.json({ sha256, stored: false }, { status: 200, headers: NO_STORE });
    case "conflict":
      return fail(409, "E_CONFLICT");
  }
}

export async function handleGet(sha256: string, store: BundleStore): Promise<Response> {
  if (!SHA256_HEX.test(sha256)) return fail(400, "E_BAD_HASH");
  if (store.backend === null) return fail(503, "E_STORE_NOT_CONFIGURED");
  const bytes = await store.backend.get(sha256);
  if (bytes === null) return fail(404, "E_NOT_FOUND");
  if (sha256Hex(bytes) !== sha256) return fail(500, "E_STORE_CORRUPT");
  return new Response(bytes.slice().buffer, {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": IMMUTABLE,
      ETag: `"${sha256}"`,
      "X-Content-Type-Options": "nosniff",
    },
  });
}
