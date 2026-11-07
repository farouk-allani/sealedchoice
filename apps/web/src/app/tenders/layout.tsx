import type { ReactNode } from "react";
import { AppShell } from "../../components/app/app-shell.tsx";
import { WalletProvider } from "../../lib/wallet/wallet-provider.tsx";
import "../../components/ui/ui.css";
import "./app.css";

export default function TendersLayout({ children }: { children: ReactNode }) {
  return (
    <WalletProvider>
      <AppShell>{children}</AppShell>
    </WalletProvider>
  );
}
