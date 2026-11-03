import { describe, expect, it } from "vitest";
import { bundleStoreFromEnv } from "./config";

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

  it("passes the token through and caps bundles at MAX_BUNDLE_BYTES", () => {
    const store = bundleStoreFromEnv({ BUNDLE_STORE_TOKEN: "abc" });
    expect(store.token).toBe("abc");
    expect(store.maxBytes).toBe(2 * 1024 * 1024);
  });
});
