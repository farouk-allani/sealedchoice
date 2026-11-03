// T06 acceptance: hash mismatch → 400; missing/wrong token → 401; second PUT of the same content →
// 200 idempotent; GET unknown → 404. Plus the other rules in handler.ts, against the local driver.
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { jcs, sha256Hex, utf8ToBytes } from "@tender/crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { BundleBackend } from "./backend";
import { type BundleStore, handleGet, handlePut } from "./handler";
import { localBackend } from "./local";

const BEARER = "unit-test-bearer-value";
const bundle = jcs({ v: 1, tid: "1", bids: [{ index: 0, flags: 0 }] });
const hash = sha256Hex(bundle);

let dir: string;
let store: BundleStore;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "bundles-"));
  store = { backend: localBackend(dir), token: BEARER, maxBytes: 1024 };
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function put(body: Uint8Array | string, auth: string | null = `Bearer ${BEARER}`): Request {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (auth !== null) headers.authorization = auth;
  const bytes = typeof body === "string" ? utf8ToBytes(body) : body;
  return new Request("http://store.test/api/bundles/x", { method: "PUT", headers, body: bytes.slice().buffer });
}

describe("PUT", () => {
  it("stores a bundle under its sha256 (201), then a repeat is a 200 no-op", async () => {
    const first = await handlePut(put(bundle), hash, store);
    expect(first.status).toBe(201);
    expect(await first.json()).toEqual({ sha256: hash, stored: true });
    const again = await handlePut(put(bundle), hash, store);
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ sha256: hash, stored: false });
    expect(await readdir(dir)).toEqual([`${hash}.json`]);
  });

  it("rejects a body whose sha256 is not the path (400)", async () => {
    const other = sha256Hex(utf8ToBytes("something else"));
    const res = await handlePut(put(bundle), other, store);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "E_HASH_MISMATCH" });
    expect(await readdir(dir)).toEqual([]);
  });

  it.each([
    ["missing", null],
    ["wrong", "Bearer not-the-token"],
    ["a prefix of the right one", `Bearer ${BEARER.slice(0, -1)}`],
    ["not a bearer header", `Basic ${BEARER}`],
    ["bearer without a value", "Bearer "],
  ])("rejects a %s token (401)", async (_name, auth) => {
    const res = await handlePut(put(bundle, auth), hash, store);
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toBe("Bearer");
    expect(await readdir(dir)).toEqual([]);
  });

  it("checks the token before anything about the body", async () => {
    const res = await handlePut(put("not even json", null), "not-a-hash", store);
    expect(res.status).toBe(401);
  });

  it.each([
    ["uppercase hex", hash.toUpperCase()],
    ["too short", hash.slice(1)],
    ["a path", `../${hash.slice(3)}`],
  ])("rejects a path that is not lowercase sha256 hex: %s (400)", async (_name, path) => {
    const res = await handlePut(put(bundle), path, store);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "E_BAD_HASH" });
  });

  it("rejects a body over the size limit (413), whatever Content-Length says", async () => {
    const big = utf8ToBytes(`"${"x".repeat(2000)}"`);
    const res = await handlePut(put(big), sha256Hex(big), store);
    expect(res.status).toBe(413);
    // A chunked body without Content-Length is cut off while it is read.
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        for (let i = 0; i < 4; i++) c.enqueue(big.subarray(i * 500, (i + 1) * 500));
        c.close();
      },
    });
    const chunked = new Request("http://store.test/api/bundles/x", {
      method: "PUT",
      headers: { authorization: `Bearer ${BEARER}` },
      body: stream,
      duplex: "half",
    } as RequestInit);
    expect((await handlePut(chunked, sha256Hex(big), store)).status).toBe(413);
    expect(await readdir(dir)).toEqual([]);
  });

  it("rejects an empty body (400)", async () => {
    const empty = new Uint8Array(0);
    const res = await handlePut(put(empty), sha256Hex(empty), store);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "E_EMPTY_BODY" });
  });

  it("refuses different bytes already stored under the hash (409), never overwrites", async () => {
    await writeFile(join(dir, `${hash}.json`), "tampered");
    const res = await handlePut(put(bundle), hash, store);
    expect(res.status).toBe(409);
  });

  it.each([
    ["no token configured", { token: undefined }],
    ["an empty token configured", { token: "" }],
    ["no backend configured", { backend: null }],
  ])("fails closed with %s (503)", async (_name, patch) => {
    const res = await handlePut(put(bundle), hash, { ...store, ...patch });
    expect(res.status).toBe(503);
  });
});

describe("GET", () => {
  it("returns 404 for an unknown hash, not cached", async () => {
    const res = await handleGet(hash, store);
    expect(res.status).toBe(404);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("serves a stored bundle byte for byte, immutable, as JSON", async () => {
    await handlePut(put(bundle), hash, store);
    const res = await handleGet(hash, store);
    expect(res.status).toBe(200);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(bundle);
    expect(res.headers.get("content-type")).toBe("application/json");
    expect(res.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(res.headers.get("etag")).toBe(`"${hash}"`);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("needs no token", async () => {
    await handlePut(put(bundle), hash, store);
    expect((await handleGet(hash, { ...store, token: undefined })).status).toBe(200);
  });

  it("never serves bytes that do not hash to the path (500)", async () => {
    const lying: BundleBackend = {
      name: "lying",
      get: () => Promise.resolve(utf8ToBytes("{}")),
      putIfAbsent: () => Promise.resolve("created"),
    };
    const res = await handleGet(hash, { ...store, backend: lying });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "E_STORE_CORRUPT" });
  });

  it("rejects a malformed hash (400)", async () => {
    expect((await handleGet("abc", store)).status).toBe(400);
  });
});
