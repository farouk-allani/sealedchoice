import type { ReactNode } from "react";
import { AppShell } from "../../components/app/app-shell.tsx";
import { WalletProvider } from "../../lib/wallet/wallet-provider.tsx";
import { appFontVariables } from "./app-fonts.ts";
import "../../components/ui/ui.css";
import "./app.css";

export default function TendersLayout({ children }: { children: ReactNode }) {
  return (
    <div className={appFontVariables}>
      <WalletProvider>
        <AppShell>{children}</AppShell>
      </WalletProvider>
    </div>
  );
}
