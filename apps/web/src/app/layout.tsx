import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Inter, JetBrains_Mono } from "next/font/google";
import { BRAND } from "@tender/shared";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

// Hashes, basis points and account ids are read character by character, so they get a mono face
// with a slashed zero rather than the body font.
const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono-face",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: `${BRAND.name}: ${BRAND.tagline}`,
    template: `%s | ${BRAND.name}`,
  },
  description:
    "Suppliers encrypt each bid to a key that exists only inside a TEE. After the deadline the " +
    "tender contract has them opened and scored once, and every step is recorded on NEAR.",
};

export const viewport: Viewport = {
  themeColor: "#07080a",
  colorScheme: "dark",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    // The landing page is the only page today, so dark is the default. When T09 adds the app
    // pages, give them a route group with their own background rather than changing this.
    <html lang="en" className={`${inter.variable} ${mono.variable}`}>
      <body className="min-h-screen bg-ink text-fg antialiased">{children}</body>
    </html>
  );
}
