import type { ReactNode } from "react";
import { AppShell } from "../../components/app/app-shell.tsx";
import { WalletProvider } from "../../lib/wallet/wallet-provider.tsx";
import { appFontVariables } from "../tenders/app-fonts.ts";
import "../../components/ui/ui.css";
import "../tenders/app.css";
import "./attacks.css";

export default function AttacksLayout({ children }: { children: ReactNode }) {
  return <div className={appFontVariables}><WalletProvider><AppShell>{children}</AppShell></WalletProvider></div>;
}
