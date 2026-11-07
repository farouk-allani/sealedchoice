// View calls over plain JSON-RPC.
//
// Deliberately not near-api-js: v7 pins @noble/curves and @noble/hashes at 2.2.0 exactly, while
// packages/crypto pins the 1.x line (D-016, docs/references.md). Two copies of the curve code in
// one browser bundle is the thing D-016 exists to prevent, and a read needs nothing from the SDK
// beyond base64 and fetch.
import type { z } from "zod";
import { RPC_URL } from "../../config/demo.ts";

/** The RPC endpoint or the network refused the request. */
export class RpcError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "RpcError";
  }
}

/** The contract ran and panicked. `code` is the `E_<NAME>` from env::panic_str when there is one. */
export class ContractError extends Error {
  readonly code: string | null;
  constructor(message: string) {
    super(message);
    this.name = "ContractError";
    this.code = /\bE_[A-Z0-9_]+/.exec(message)?.[0] ?? null;
  }
}

const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const encoder = new TextEncoder();

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  // btoa exists in browsers and in Node 16+; no Buffer, so this file runs in both.
  return btoa(binary);
}

export interface ViewOptions<T> {
  contractId: string;
  method: string;
  args?: Record<string, unknown>;
  schema: z.ZodType<T>;
  /**
   * "optimistic" reads the newest block, which is what a user wants right after their own
   * transaction. "final" lags a couple of seconds and is what a verifier wants.
   */
  finality?: "optimistic" | "final";
  signal?: AbortSignal;
}

/**
 * One `call_function` view, validated. Throws `RpcError` if the endpoint failed and
 * `ContractError` if the contract panicked.
 */
export async function viewCall<T>(options: ViewOptions<T>): Promise<T> {
  const { contractId, method, args = {}, schema, finality = "optimistic", signal } = options;

  const body = {
    jsonrpc: "2.0",
    id: `${method}:${contractId}`,
    method: "query",
    params: {
      request_type: "call_function",
      finality,
      account_id: contractId,
      method_name: method,
      args_base64: toBase64(encoder.encode(JSON.stringify(args))),
    },
  };

  let response: Response;
  try {
    response = await fetch(RPC_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
      signal,
    });
  } catch (error) {
    throw new RpcError(`${method}: could not reach the NEAR RPC`, { cause: error });
  }

  if (!response.ok) {
    throw new RpcError(`${method}: RPC answered ${response.status} ${response.statusText}`);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch (error) {
    throw new RpcError(`${method}: RPC answer was not JSON`, { cause: error });
  }

  const envelope = payload as {
    error?: { message?: string; data?: unknown; cause?: { name?: string; info?: unknown } };
    result?: { result?: number[]; error?: string; logs?: string[] };
  };

  if (envelope.error) {
    const detail =
      envelope.error.cause?.name ?? envelope.error.message ?? JSON.stringify(envelope.error);
    throw new RpcError(`${method}: ${detail}`);
  }

  const result = envelope.result;
  if (!result) throw new RpcError(`${method}: RPC answer had no result`);
  if (typeof result.error === "string") throw new ContractError(`${method}: ${result.error}`);
  if (!Array.isArray(result.result)) throw new RpcError(`${method}: result was not a byte array`);

  let text: string;
  try {
    text = decoder.decode(Uint8Array.from(result.result));
  } catch (error) {
    throw new RpcError(`${method}: result was not valid UTF-8`, { cause: error });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new RpcError(`${method}: result was not JSON`, { cause: error });
  }

  const checked = schema.safeParse(parsed);
  if (!checked.success) {
    throw new RpcError(`${method}: unexpected shape (${checked.error.issues[0]?.message ?? "?"})`);
  }
  return checked.data;
}
