import { describe, expect, it } from "vitest";
import { MIN_TOKEN_CHARS, bundleStoreFromEnv } from "./config";
import { handlePut } from "./handler";

describe("bundleStoreFromEnv", () => {
  it("uses the local driver outside production when nothing is set", () => {
    expect(bundleStoreFromEnv({ NODE_ENV: "development" }).backend?.name).toBe("local");
  });

  it("has no backend in production unless one is named (the store answers 503)", () => {
    expect(bundleStoreFromEnv({ NODE_ENV: "production" }).backend).toBeNull();
    expect(
      bundleStoreFromEnv({ NODE_ENV: "production", BUNDLE_STORE_BACKEND: "vercel-blob" }).backend?.name,
    ).toBe("vercel-blob");
  });

  it("refuses an unknown backend name, and does not print values", () => {
    const store = bundleStoreFromEnv({ BUNDLE_STORE_BACKEND: "s3", BUNDLE_STORE_TOKEN: "zzz" });
    expect(store.backend).toBeNull();
    expect(store.token).toBeUndefined();
  });

  it("reads empty values as unset", () => {
    const store = bundleStoreFromEnv({ NODE_ENV: "development", BUNDLE_STORE_BACKEND: "", BUNDLE_BLOB_ACCESS: "", BUNDLE_STORE_TOKEN: "" });
    expect(store.backend?.name).toBe("local");
    expect(store.token).toBeUndefined();
  });

  it("passes a token of at least 32 characters through and caps bundles at MAX_BUNDLE_BYTES (4 MiB)", () => {
    const token = "t".repeat(MIN_TOKEN_CHARS);
    const store = bundleStoreFromEnv({ BUNDLE_STORE_TOKEN: token });
    expect(store.token).toBe(token);
    expect(store.maxBytes).toBe(4 * 1024 * 1024);
  });

  it("treats a token shorter than 32 characters as unset, so PUT fails closed", async () => {
    const store = bundleStoreFromEnv({ NODE_ENV: "development", BUNDLE_STORE_TOKEN: "t".repeat(MIN_TOKEN_CHARS - 1) });
    expect(MIN_TOKEN_CHARS).toBe(32);
    expect(store.token).toBeUndefined();
    const put = new Request("http://t/", { method: "PUT", headers: { authorization: `Bearer ${"t".repeat(31)}` }, body: "{}" });
    expect((await handlePut(put, "0".repeat(64), store)).status).toBe(503);
  });
});
