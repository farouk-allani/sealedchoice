/**
 * Fetches the public evidence for a tender, so `runChecks` has something to be pure about.
 *
 * Uses only `fetch`, which Node 22 and every browser provide, and plain JSON-RPC rather than
 * near-api-js: T09 found that v7 pins `@noble` 2.2.0 while `packages/crypto` pins the 1.x line
 * that D-016 requires, and one copy in the browser bundle is the whole point of that decision.
 */
import { sha256Hex, toBase64, utf8ToBytes } from "@tender/crypto";
import {
  attemptViewSchema,
  bidViewSchema,
  configViewSchema,
  frozenViewSchema,
  tenderViewSchema,
} from "./evidence.ts";
import type { Evidence } from "./evidence.ts";

export class LoadError extends Error {
  override name = "LoadError";
}

export interface LoadOptions {
  contractId: string;
  tenderId: number;
  rpcUrl: string;
  bundleStoreUrl: string;
  explorerBase?: string;
  network?: string;
  /**
   * Download the evaluator artifact named by the tender and hash it. This is the only part of
   * check 4 that compares the pinned hash with real bytes, so it is on by default; it costs about
   * 2 MB.
   */
  fetchArtifact?: boolean;
  /** Injected in tests. Defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
}

interface Loaded {
  evidence: Evidence;
  artifact: { sha256: string; bytes: number } | null;
}

async function view<T>(f: typeof fetch, rpcUrl: string, contractId: string, method: string, args: unknown): Promise<T> {
  const res = await f(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "verify",
      method: "query",
      params: {
        request_type: "call_function",
        finality: "final",
        account_id: contractId,
        method_name: method,
        args_base64: toBase64(utf8ToBytes(JSON.stringify(args))),
      },
    }),
  });
  if (!res.ok) throw new LoadError(`RPC ${method} returned HTTP ${res.status}`);
  const body = (await res.json()) as {
    result?: { result?: number[] };
    error?: unknown;
  };
  if (body.error !== undefined || body.result?.result === undefined) {
    throw new LoadError(`RPC ${method} failed: ${JSON.stringify(body.error ?? body).slice(0, 200)}`);
  }
  const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(Uint8Array.from(body.result.result));
  return JSON.parse(text) as T;
}

async function codeHashOf(f: typeof fetch, rpcUrl: string, contractId: string): Promise<string | null> {
  try {
    const res = await f(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "verify",
        method: "query",
        params: { request_type: "view_account", finality: "final", account_id: contractId },
      }),
    });
    const body = (await res.json()) as { result?: { code_hash?: string } };
    return body.result?.code_hash ?? null;
  } catch {
    return null;
  }
}

export async function loadEvidence(o: LoadOptions): Promise<Loaded> {
  const f = o.fetchImpl ?? fetch;
  const { contractId, tenderId, rpcUrl } = o;

  const rawTender = await view<unknown>(f, rpcUrl, contractId, "get_tender", { tender_id: tenderId });
  if (rawTender === null) throw new LoadError(`tender ${tenderId} does not exist on ${contractId}`);

  const [tender, config, bids, frozen, attempts, resultText, codeHash] = await Promise.all([
    Promise.resolve(tenderViewSchema.parse(rawTender)),
    view<unknown>(f, rpcUrl, contractId, "get_config", {}).then((v) => configViewSchema.parse(v)),
    view<unknown[]>(f, rpcUrl, contractId, "get_bids", { tender_id: tenderId }).then((v) =>
      v.map((b) => bidViewSchema.parse(b)),
    ),
    view<unknown>(f, rpcUrl, contractId, "get_frozen", { tender_id: tenderId }).then((v) =>
      v === null ? null : frozenViewSchema.parse(v),
    ),
    view<unknown[]>(f, rpcUrl, contractId, "get_attempts", { tender_id: tenderId }).then((v) =>
      v.map((a) => attemptViewSchema.parse(a)),
    ),
    view<string | null>(f, rpcUrl, contractId, "get_result", { tender_id: tenderId }),
    codeHashOf(f, rpcUrl, contractId),
  ]);

  // Every frozen slot's ciphertext, so check 3 can rebuild the leaves from the chain itself.
  const ciphertexts: Record<number, string> = {};
  const slots = frozen?.slots ?? bids.filter((b) => !b.withdrawn).map((b) => b.slot);
  await Promise.all(
    slots.map(async (slot) => {
      const ct = await view<string | null>(f, rpcUrl, contractId, "get_bid_ciphertext", {
        tender_id: tenderId,
        slot,
      });
      if (typeof ct === "string") ciphertexts[slot] = ct;
    }),
  );

  // The bundle, by the hash the result commits to.
  let bundle: Evidence["bundle"] = null;
  if (typeof resultText === "string" && resultText !== "") {
    try {
      const hash = (JSON.parse(resultText) as { bundle?: string }).bundle;
      if (typeof hash === "string" && /^[0-9a-f]{64}$/.test(hash)) {
        const url = `${o.bundleStoreUrl.replace(/\/$/, "")}/api/bundles/${hash}`;
        // `identity` keeps the ETag strong; check 6 still strips a `W/` in case a CDN compresses.
        const res = await f(url, { headers: { "accept-encoding": "identity" } });
        if (res.ok) {
          bundle = {
            bytes: new Uint8Array(await res.arrayBuffer()),
            etag: res.headers.get("etag"),
            url,
          };
        }
      }
    } catch {
      bundle = null;
    }
  }

  let artifact: Loaded["artifact"] = null;
  if (o.fetchArtifact !== false && tender.evaluator.wasm_url.startsWith("https://")) {
    try {
      const res = await f(tender.evaluator.wasm_url);
      if (res.ok) {
        const bytes = new Uint8Array(await res.arrayBuffer());
        artifact = { sha256: sha256Hex(bytes), bytes: bytes.length };
      }
    } catch {
      artifact = null;
    }
  }

  return {
    evidence: {
      network: o.network ?? "testnet",
      contractId,
      tenderId,
      minDeadlineDelayNs: config.min_deadline_delay_ns,
      tender,
      bids,
      frozen,
      attempts,
      resultText: typeof resultText === "string" ? resultText : null,
      bundle,
      ciphertexts,
      codeHash,
      explorerBase: o.explorerBase ?? "https://testnet.nearblocks.io",
    },
    artifact,
  };
}
