"use client";

import { useState } from "react";
import Link from "next/link";
import { BRAND } from "@tender/shared";
import { CHAIN, explorerAccount } from "../../config/evidence.ts";
import { BrandMark } from "../brand-mark.tsx";

export { BrandMark } from "../brand-mark.tsx";
export function Nav() {
  const [open, setOpen] = useState(false);
  return (
    <nav className="landing-nav" aria-label="Main navigation">
      <div className="nav-island">
        <a href="#top" className="brand" aria-label={`${BRAND.name} home`}>
          <span className="brand-mark">
            <BrandMark />
          </span>
          <span>{BRAND.name}</span>
        </a>
        <div className="nav-links">
          <a href="#story">Protocol</a>
          <a href="#result">Demo tender</a>
          <a href="#limits">Limits</a>
        </div>
      </div>
      <div className="nav-island nav-actions">
        <a href="#verify" className="nav-verify">
          Verifier
        </a>
        <a
          className="nav-verify"
          href={explorerAccount(CHAIN.tenderContract)}
          target="_blank"
          rel="noreferrer noopener"
        >
          Explorer <span aria-hidden="true">↗</span>
        </a>
        <Link href="/tenders" className="nav-app">
          Open app
        </Link>
        <button
          className="mobile-menu-toggle"
          type="button"
          aria-expanded={open}
          aria-controls="mobile-nav"
          onClick={() => setOpen(!open)}
          aria-label={open ? "Close navigation" : "Open navigation"}
        >
          {open ? "−" : "+"}
        </button>
      </div>
      {open && (
        <div id="mobile-nav" className="mobile-nav">
          {[
            ["Protocol", "#story"],
            ["Demo tender", "#result"],
            ["Limits", "#limits"],
            ["Verifier", "#verify"],
            ["Explorer", explorerAccount(CHAIN.tenderContract)],
          ].map(([label, href]) => (
            <a
              key={href}
              href={href}
              onClick={() => setOpen(false)}
              target={href?.startsWith("https://") ? "_blank" : undefined}
              rel={
                href?.startsWith("https://") ? "noreferrer noopener" : undefined
              }
            >
              {label}
              <span aria-hidden="true">↗</span>
            </a>
          ))}
        </div>
      )}
    </nav>
  );
}
