"use client";

// The one place the app talks to a wallet. Chosen at G5: NEAR Connect 0.12.0, filtered on
// signMessage, because a bidder cannot take part without NEP-413 (docs/05, reader keys).
//
// Everything read-only must work with no wallet at all (.claude/rules/web.md), so nothing here
// runs until a component asks for it: the connector is constructed on the client, after mount,
// and a page that never calls `useWallet().connect` never loads it.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { NearConnector } from "@hot-labs/near-connect";
import { NETWORK } from "../../config/demo.ts";

export interface SignedMessage {
  accountId: string;
  publicKey: string;
  /** Base64. The connector re-encodes whatever the wallet produced (G5). */
  signature: string;
}

export interface FunctionCallAction {
  methodName: string;
  args: Record<string, unknown>;
  /** Gas in gas units as a decimal string. */
  gas: string;
  /** yoctoNEAR as a decimal string. */
  deposit: string;
}

export interface WalletState {
  /** "loading" only until the stored session has been looked up. */
  status: "loading" | "disconnected" | "connected";
  accountId: string | null;
  walletName: string | null;
  error: string | null;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  signMessage: (params: { message: string; recipient: string; nonce: Uint8Array }) => Promise<SignedMessage>;
  signAndSend: (params: { receiverId: string; actions: FunctionCallAction[] }) => Promise<string>;
}

const WalletContext = createContext<WalletState | null>(null);

/** 300 TGas, the most a transaction may carry. */
export const MAX_GAS = "300000000000000";
export const TGAS = (n: number): string => `${BigInt(n) * 1_000_000_000_000n}`;

export function WalletProvider({ children }: { children: ReactNode }) {
  const connectorRef = useRef<NearConnector | null>(null);
  const [status, setStatus] = useState<WalletState["status"]>("loading");
  const [accountId, setAccountId] = useState<string | null>(null);
  const [walletName, setWalletName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const getConnector = useCallback(async (): Promise<NearConnector> => {
    if (connectorRef.current) return connectorRef.current;
    const { NearConnector } = await import("@hot-labs/near-connect");
    const connector = new NearConnector({
      network: NETWORK,
      autoConnect: true,
      // A bidder must be able to sign a NEP-413 message, so a wallet that cannot is not offered.
      // On testnet the connector narrows this further to wallets whose manifest declares testnet,
      // which is why MyNearWallet does not appear there (G5).
      features: { signMessage: true },
    });
    connectorRef.current = connector;
    return connector;
  }, []);

  // Restore a session the user already had, including after a wallet that signs by redirecting
  // sent the page through a reload.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const connector = await getConnector();
        const { wallet, accounts } = await connector.getConnectedWallet();
        if (cancelled) return;
        if (accounts?.length) {
          setAccountId(accounts[0]!.accountId);
          setWalletName(wallet.manifest?.name ?? null);
          setStatus("connected");
          return;
        }
      } catch {
        // No stored session. That is the normal first visit.
      }
      if (!cancelled) setStatus("disconnected");
    })();
    return () => {
      cancelled = true;
    };
  }, [getConnector]);

  const connect = useCallback(async () => {
    setError(null);
    try {
      const connector = await getConnector();
      const wallet = await connector.connect();
      let accounts = await wallet.getAccounts().catch(() => []);
      if (!accounts?.length) accounts = await wallet.signIn().catch(() => []);
      const first = accounts?.[0];
      if (!first) throw new Error("the wallet returned no account");
      setAccountId(first.accountId);
      setWalletName(wallet.manifest?.name ?? null);
      setStatus("connected");
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      // Closing the wallet chooser is a choice, not a failure worth shouting about.
      if (message !== "User rejected") setError(message);
      setStatus((s) => (s === "connected" ? s : "disconnected"));
    }
  }, [getConnector]);

  const disconnect = useCallback(async () => {
    setError(null);
    try {
      const connector = await getConnector();
      await connector.disconnect();
    } catch {
      // Dropping the local session is what matters; the wallet may already be gone.
    }
    setAccountId(null);
    setWalletName(null);
    setStatus("disconnected");
  }, [getConnector]);

  const signMessage = useCallback<WalletState["signMessage"]>(
    async ({ message, recipient, nonce }) => {
      const connector = await getConnector();
      const { wallet } = await connector.getConnectedWallet();
      const signed = await wallet.signMessage({ message, recipient, nonce });
      return {
        accountId: signed.accountId,
        publicKey: signed.publicKey,
        signature: signed.signature,
      };
    },
    [getConnector],
  );

  const signAndSend = useCallback<WalletState["signAndSend"]>(
    async ({ receiverId, actions }) => {
      const connector = await getConnector();
      const { wallet } = await connector.getConnectedWallet();
      const outcome = await wallet.signAndSendTransaction({
        receiverId,
        actions: actions.map((a) => ({
          type: "FunctionCall" as const,
          params: { methodName: a.methodName, args: a.args, gas: a.gas, deposit: a.deposit },
        })),
      });
      const hash =
        (outcome as { transaction?: { hash?: string } }).transaction?.hash ??
        (outcome as { transaction_outcome?: { id?: string } }).transaction_outcome?.id;
      if (!hash) throw new Error("the wallet returned no transaction hash");
      return hash;
    },
    [getConnector],
  );

  const value = useMemo<WalletState>(
    () => ({ status, accountId, walletName, error, connect, disconnect, signMessage, signAndSend }),
    [status, accountId, walletName, error, connect, disconnect, signMessage, signAndSend],
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet(): WalletState {
  const context = useContext(WalletContext);
  if (!context) throw new Error("useWallet must be used inside <WalletProvider>");
  return context;
}

/**
 * The wallet, or null outside a provider. For read-only components that want to offer an action
 * when a wallet happens to be connected but must render without one.
 */
export function useOptionalWallet(): WalletState | null {
  return useContext(WalletContext);
}
