// The Next.js route wired to the local driver through env, end to end.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { jcs, sha256Hex } from "@tender/crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET, PUT } from "./route";

const BEARER = "route-test-bearer-value-of-32-chars-at-least";
let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "bundles-route-"));
  process.env.BUNDLE_STORE_BACKEND = "local";
  process.env.BUNDLE_STORE_DIR = dir;
  process.env.BUNDLE_STORE_TOKEN = BEARER;
});
afterAll(async () => {
  delete process.env.BUNDLE_STORE_BACKEND;
  delete process.env.BUNDLE_STORE_DIR;
  delete process.env.BUNDLE_STORE_TOKEN;
  await rm(dir, { recursive: true, force: true });
});

const ctx = (sha256: string) => ({ params: Promise.resolve({ sha256 }) });

describe("/api/bundles/[sha256]", () => {
  it("PUT then GET returns the same bytes", async () => {
    const bundle = jcs({ v: 1, note: "route" });
    const hash = sha256Hex(bundle);
    expect((await GET(new Request("http://t/"), ctx(hash))).status).toBe(404);
    const put = new Request("http://t/", {
      method: "PUT",
      headers: { authorization: `Bearer ${BEARER}` },
      body: bundle.slice().buffer,
    });
    expect((await PUT(put, ctx(hash))).status).toBe(201);
    const got = await GET(new Request("http://t/"), ctx(hash));
    expect(got.status).toBe(200);
    expect(new Uint8Array(await got.arrayBuffer())).toEqual(bundle);
  });
});
