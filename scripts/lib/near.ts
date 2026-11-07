// NEAR testnet plumbing for the scripts, on near-api-js 7.4 (docs/references.md: v7 renamed most
// of the v5/v6 API, so older examples do not apply here).
//
// Signing accounts come from `.env` and are only the ones a script must impersonate (buyer,
// vendors). The accounts that own contracts and hold escrow - `tenders.` and `usdc.` - keep their
// full-access keys in the OS keychain and are driven by `scripts/testnet/deploy.sh`, so a key that
// can replace a contract is never in a file.
import { Account, JsonRpcProvider, teraToGas } from "near-api-js";
import type { Env, Network } from "./env.ts";

/**
 * Public RPC per network. `NEAR_RPC_URL` overrides it.
 *
 * FastNEAR, because `rpc.testnet.near.org` and `rpc.mainnet.near.org` were retired and now
 * answer every request with `-429 THIS ENDPOINT IS DEPRECATED` (measured 2026-11-07, T09).
 */
const DEFAULT_RPC: Record<Network, string> = {
  testnet: "https://test.rpc.fastnear.com",
  mainnet: "https://free.rpc.fastnear.com",
};

export function provider(env: Env, network: Network): JsonRpcProvider {
  return new JsonRpcProvider({ url: env.NEAR_RPC_URL ?? DEFAULT_RPC[network] });
}

/** Signing account. The private key string is passed straight to `Account`; v7 ships no KeyStore. */
export function signer(p: JsonRpcProvider, accountId: string, privateKey: string): Account {
  // `KeyPairString` is a type-only export in 7.4, so the cast stays local to this one line.
  return new Account(accountId, p, privateKey as `ed25519:${string}`);
}

/** A view call. Note `method`, not `methodName`: the provider and the account differ here. */
export async function view<T>(
  p: JsonRpcProvider,
  contractId: string,
  method: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  return (await p.callFunction({ contractId, method, args })) as T;
}

export interface CallOptions {
  contractId: string;
  methodName: string;
  args?: Record<string, unknown>;
  /** yoctoNEAR. */
  deposit?: bigint;
  tgas?: number;
}

export interface CallResult<T> {
  value: T;
  txHash: string;
  /** Total gas burnt across every receipt, in TGas. */
  tgasBurnt: number;
  logs: string[];
}

/**
 * A change call that returns what a run needs for the record: the value, the transaction hash to
 * put in PROGRESS, the gas actually burnt and every log line the receipts emitted (the contract
 * reports refusals like `E_WRONG_AMOUNT` as logs from `ft_on_transfer`, not as failures).
 */
export async function call<T>(account: Account, o: CallOptions): Promise<CallResult<T>> {
  const outcome = await account.callFunctionRaw({
    contractId: o.contractId,
    methodName: o.methodName,
    args: o.args ?? {},
    deposit: o.deposit ?? 0n,
    gas: teraToGas(o.tgas ?? 100),
  });
  const receipts = outcome.receipts_outcome ?? [];
  const gas =
    Number(outcome.transaction_outcome?.outcome?.gas_burnt ?? 0) +
    receipts.reduce((n, r) => n + Number(r.outcome?.gas_burnt ?? 0), 0);
  const logs = receipts.flatMap((r) => r.outcome?.logs ?? []);
  const status = outcome.status as { SuccessValue?: string; Failure?: unknown };
  if (status?.Failure !== undefined) {
    throw new Error(`${o.methodName} failed: ${JSON.stringify(status.Failure).slice(0, 400)}`);
  }
  const raw = status?.SuccessValue ?? "";
  const value = raw === "" ? undefined : JSON.parse(Buffer.from(raw, "base64").toString("utf8"));
  return {
    value: value as T,
    txHash: String(outcome.transaction_outcome?.id ?? ""),
    tgasBurnt: gas / 1e12,
    logs,
  };
}

/** Polls `read` until `done`, or throws after `timeoutMs`. */
export async function until<T>(
  what: string,
  read: () => Promise<T>,
  done: (v: T) => boolean,
  { timeoutMs = 180_000, everyMs = 3_000 } = {},
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const v = await read();
    if (done(v)) return v;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what} after ${timeoutMs} ms`);
    await new Promise((r) => setTimeout(r, everyMs));
  }
}

export const yocto = (near: string): bigint => {
  const [whole, frac = ""] = near.split(".");
  return BigInt(whole + frac.padEnd(24, "0").slice(0, 24));
};
