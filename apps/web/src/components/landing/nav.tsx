"use client";

import { useState } from "react";
import { BRAND } from "@tender/shared";
import { CHAIN, explorerAccount } from "../../config/evidence.ts";

export function BrandMark() {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M2.036 17A14 14 0 0 1 29.077 11H8L14 17Z" />
      <path d="M29.964 15A14 14 0 0 1 2.923 21H24L18 15Z" />
    </svg>
  );
}
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
          className="nav-explorer"
          href={explorerAccount(CHAIN.tenderContract)}
          target="_blank"
          rel="noreferrer"
        >
          Explorer <span aria-hidden="true">↗</span>
        </a>
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
          ].map(([label, href]) => (
            <a key={href} href={href} onClick={() => setOpen(false)}>
              {label}
              <span>↗</span>
            </a>
          ))}
        </div>
      )}
    </nav>
  );
}
