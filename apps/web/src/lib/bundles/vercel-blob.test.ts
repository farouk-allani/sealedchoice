// The Vercel Blob driver against an in-memory stand-in for @vercel/blob that keeps its documented
// rules: `put` throws when the pathname exists and `allowOverwrite` is false; `get` returns null for
// an unknown pathname. The real service is exercised once Farouk creates the store (T06, D-021).
import { sha256Hex, utf8ToBytes } from "@tender/crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const blobs = new Map<string, Uint8Array>();
const calls: { put: { pathname: string; options: Record<string, unknown> }[] } = { put: [] };
/** Writes another client "wins" between our existence check and our put. */
let racer: Uint8Array | null = null;

vi.mock("@vercel/blob", () => ({
  get: (pathname: string) => {
    const b = blobs.get(pathname);
    if (b === undefined) return Promise.resolve(null);
    return Promise.resolve({ statusCode: 200, stream: new Response(b.slice()).body });
  },
  put: (pathname: string, body: ArrayBuffer, options: Record<string, unknown>) => {
    calls.put.push({ pathname, options });
    if (racer !== null) {
      blobs.set(pathname, racer);
      racer = null;
    }
    if (blobs.has(pathname) && options.allowOverwrite !== true) {
      return Promise.reject(new Error("Vercel Blob: This blob already exists"));
    }
    blobs.set(pathname, new Uint8Array(body));
    return Promise.resolve({ pathname, url: `https://blob.test/${pathname}` });
  },
}));

const { vercelBlobBackend } = await import("./vercel-blob");

const body = utf8ToBytes('{"v":1}');
const hash = sha256Hex(body);
const path = `bundles/${hash}.json`;

beforeEach(() => {
  blobs.clear();
  calls.put = [];
  racer = null;
});

describe("vercelBlobBackend", () => {
  const backend = vercelBlobBackend({ access: "public" });

  it("writes once, without overwrite or random suffix, as JSON, cached for a year", async () => {
    expect(await backend.putIfAbsent(hash, body)).toBe("created");
    expect(calls.put).toHaveLength(1);
    expect(calls.put[0]?.pathname).toBe(path);
    expect(calls.put[0]?.options).toMatchObject({
      access: "public",
      addRandomSuffix: false,
      allowOverwrite: false,
      contentType: "application/json",
      cacheControlMaxAge: 31_536_000,
    });
    expect(await backend.get(hash)).toEqual(body);
  });

  it("answers exists for the same bytes and conflict for others, without writing", async () => {
    await backend.putIfAbsent(hash, body);
    expect(await backend.putIfAbsent(hash, body)).toBe("exists");
    expect(await backend.putIfAbsent(hash, utf8ToBytes('{"v":2}'))).toBe("conflict");
    expect(calls.put).toHaveLength(1);
  });

  it("settles a lost race by reading back", async () => {
    racer = body;
    expect(await backend.putIfAbsent(hash, body)).toBe("exists");
    racer = utf8ToBytes("other");
    blobs.clear();
    expect(await backend.putIfAbsent(hash, body)).toBe("conflict");
  });

  it("returns null for an unknown hash and refuses malformed ones", async () => {
    expect(await backend.get(hash)).toBeNull();
    await expect(backend.get("../x")).rejects.toThrow("bad hash");
  });
});
