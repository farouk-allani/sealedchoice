"use client";

// The frame every tender page sits in: a way home, and the wallet. Read-only pages render the
// whole shell with no wallet connected and never ask for one (.claude/rules/web.md).
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { BRAND } from "@tender/shared";
import { BrandMark } from "../brand-mark.tsx";
import { Button } from "../ui/button.tsx";
import { Icon } from "../ui/icon.tsx";
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
        <Button
          variant="secondary"
          size="small"
          onClick={() => void wallet.disconnect()}
        >
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
      <Button
        variant="primary"
        size="small"
        loading={wallet.status === "connecting"}
        onClick={() => void wallet.connect()}
      >
        Connect wallet
      </Button>
    </span>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return (
    <div className="app-theme app-shell">
      <a className="app-skip" href="#app-content">
        Skip to content
      </a>
      <header className="app-header">
        <div className="app-header-inner">
          <div className="app-header-left">
            <Link
              href="/"
              className="app-brand"
              aria-label={`${BRAND.name} home`}
            >
              <BrandMark />
              <span>{BRAND.name}</span>
            </Link>
            <nav className="app-nav" aria-label="Main">
              <Link
                href="/tenders"
                aria-current={
                  pathname === "/tenders" ||
                  (pathname.startsWith("/tenders/") &&
                    pathname !== "/tenders/new")
                    ? "page"
                    : undefined
                }
              >
                Tenders
              </Link>
              <Link
                href="/tenders/new"
                aria-current={pathname === "/tenders/new" ? "page" : undefined}
              >
                Create<span className="app-nav-label"> tender</span>
              </Link>
            </nav>
          </div>
          <div className="app-header-right ui-paper">
            <span
              className="app-network"
              title="This is a test network. Tokens have no mainnet value."
            >
              {NETWORK}
            </span>
            <WalletButton />
          </div>
        </div>
      </header>
      <main className="app-main" id="app-content" tabIndex={-1}>
        <div className="app-workspace ui-paper">{children}</div>
      </main>
      <footer className="app-footer">
        <span>
          <Icon name="lock" size={15} /> Sealed in your browser. Recorded on
          NEAR.
        </span>
        <Link href="/#limits">
          Understand the limits <Icon name="external" size={14} />
        </Link>
      </footer>
    </div>
  );
}
