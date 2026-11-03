// Filesystem driver: one file per bundle, `<dir>/<sha256>.json`. Used by the tests and for local
// development (`BUNDLE_STORE_BACKEND=local`). Not for Vercel: its filesystem does not persist.
import { randomUUID } from "node:crypto";
import { link, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { bytesEqual } from "@tender/crypto";
import { type BundleBackend, type PutOutcome, SHA256_HEX } from "./backend";

function isErrno(e: unknown, code: string): boolean {
  return typeof e === "object" && e !== null && "code" in e && e.code === code;
}

export function localBackend(dir: string): BundleBackend {
  const path = (sha256: string): string => {
    // The route checks the form first; checked again so no other input can reach the filesystem.
    if (!SHA256_HEX.test(sha256)) throw new Error("bundle store: bad hash");
    return join(dir, `${sha256}.json`);
  };

  async function get(sha256: string): Promise<Uint8Array | null> {
    try {
      return new Uint8Array(await readFile(path(sha256)));
    } catch (e) {
      if (isErrno(e, "ENOENT")) return null;
      throw e;
    }
  }

  async function putIfAbsent(sha256: string, body: Uint8Array): Promise<PutOutcome> {
    const final = path(sha256);
    await mkdir(dir, { recursive: true });
    // Write a temporary file, then hard-link it into place: `link` fails if the target exists,
    // so the write is atomic and never overwrites, and no reader sees a partial file.
    const tmp = join(dir, `.tmp-${randomUUID()}`);
    await writeFile(tmp, body, { flag: "wx" });
    try {
      await link(tmp, final);
      return "created";
    } catch (e) {
      if (!isErrno(e, "EEXIST")) throw e;
      const existing = await get(sha256);
      return existing !== null && bytesEqual(existing, body) ? "exists" : "conflict";
    } finally {
      await unlink(tmp).catch(() => undefined);
    }
  }

  return { name: "local", get, putIfAbsent };
}
