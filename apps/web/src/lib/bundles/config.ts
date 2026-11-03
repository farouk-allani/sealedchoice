// Picks the bundle store backend from server-side env (DECISIONS D-021). Never `NEXT_PUBLIC_`.
//   BUNDLE_STORE_TOKEN    bearer token the evaluator sends with PUT (also an OutLayer secret); at
//                         least MIN_TOKEN_CHARS, else PUT is refused as if no token were set
//   BUNDLE_STORE_BACKEND  "local" | "vercel-blob"; unset → "local" outside production, none in
//                         production (the store then answers 503 rather than guess)
//   BUNDLE_STORE_DIR      local driver directory (default `.bundle-store` in the app folder)
//   BUNDLE_BLOB_ACCESS    "public" (default) | "private": the Blob store's access mode
//   BLOB_READ_WRITE_TOKEN read by @vercel/blob itself
import { join } from "node:path";
import { MAX_BUNDLE_BYTES } from "@tender/shared";
import { z } from "zod";
import type { BundleBackend } from "./backend";
import type { BundleStore } from "./handler";
import { localBackend } from "./local";
import { vercelBlobBackend } from "./vercel-blob";

/** Shorter tokens are treated as unset: PUT answers 503 (fail closed). */
export const MIN_TOKEN_CHARS = 32;

const Env = z.object({
  NODE_ENV: z.string().optional(),
  BUNDLE_STORE_TOKEN: z.string().optional(),
  BUNDLE_STORE_BACKEND: z.enum(["local", "vercel-blob"]).optional(),
  BUNDLE_STORE_DIR: z.string().min(1).optional(),
  BUNDLE_BLOB_ACCESS: z.enum(["public", "private"]).default("public"),
});

export function bundleStoreFromEnv(env: Record<string, string | undefined> = process.env): BundleStore {
  // An empty value (`KEY=` copied from .env.example) means unset.
  const set = Object.fromEntries(Object.entries(env).filter(([, v]) => v !== undefined && v !== ""));
  const parsed = Env.safeParse(set);
  if (!parsed.success) {
    // Names only, never values (one of them is a secret).
    const keys = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    console.error(`bundle store: invalid configuration (${keys})`);
    return { backend: null, token: undefined, maxBytes: MAX_BUNDLE_BYTES };
  }
  const e = parsed.data;
  const kind = e.BUNDLE_STORE_BACKEND ?? (e.NODE_ENV === "production" ? undefined : "local");
  let backend: BundleBackend | null = null;
  if (kind === "local") {
    backend = localBackend(e.BUNDLE_STORE_DIR ?? join(process.cwd(), ".bundle-store"));
  } else if (kind === "vercel-blob") {
    backend = vercelBlobBackend({ access: e.BUNDLE_BLOB_ACCESS });
  }
  let token = e.BUNDLE_STORE_TOKEN;
  if (token !== undefined && token.length < MIN_TOKEN_CHARS) {
    console.error(`bundle store: BUNDLE_STORE_TOKEN is shorter than ${MIN_TOKEN_CHARS} characters; PUT disabled`);
    token = undefined;
  }
  return { backend, token, maxBytes: MAX_BUNDLE_BYTES };
}
