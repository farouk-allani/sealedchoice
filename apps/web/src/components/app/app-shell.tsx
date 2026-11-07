"use client";

// The frame every tender page sits in: a way home, and the wallet. Read-only pages render the
// whole shell with no wallet connected and never ask for one (.claude/rules/web.md).
import Link from "next/link";
import type { ReactNode } from "react";
import { BRAND } from "@tender/shared";
import { BrandMark } from "../brand-mark.tsx";
import { Button } from "../ui/button.tsx";
import { useWallet } from "../../lib/wallet/wallet-provider.tsx";
import { NETWORK } from "../../config/demo.ts";
import { shortAccount } from "../../lib/tender/format.ts";

function WalletButton() {
  const wallet = useWallet();

  if (wallet.status === "loading") {
    return (
      <span className="app-wallet-state" aria-live="polite">
        Checking for a wallet
      </span>
    );
  }

  if (wallet.status === "connected" && wallet.accountId) {
    return (
      <span className="app-wallet">
        <span className="app-wallet-account" title={wallet.accountId}>
          {shortAccount(wallet.accountId, 24)}
        </span>
        <Button variant="secondary" size="small" onClick={() => void wallet.disconnect()}>
          Disconnect
        </Button>
      </span>
    );
  }

  return (
    <span className="app-wallet">
      {wallet.error && (
        <span className="app-wallet-error" role="status">
          {wallet.error}
        </span>
      )}
      <Button variant="primary" size="small" onClick={() => void wallet.connect()}>
        Connect wallet
      </Button>
    </span>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="app-theme app-shell">
      <header className="app-header">
        <div className="app-header-inner">
          <div className="app-header-left">
            <Link href="/" className="app-brand" aria-label={`${BRAND.name} home`}>
              <BrandMark />
              <span>{BRAND.name}</span>
            </Link>
            <nav className="app-nav" aria-label="Main">
              <Link href="/tenders">Tenders</Link>
              <Link href="/tenders/new">Create</Link>
            </nav>
          </div>
          <div className="app-header-right">
            <span className="app-network" title="The chain this page reads">
              {NETWORK}
            </span>
            <WalletButton />
          </div>
        </div>
      </header>
      <main className="app-main">{children}</main>
    </div>
  );
}
