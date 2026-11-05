"use client";

import { BRAND } from "@tender/shared";
import { NAV } from "../../content/landing.ts";
import { CHAIN, explorerAccount } from "../../config/evidence.ts";

/** Anchor jumps are handled here because CSS smooth scrolling fights GSAP's ScrollTrigger. */
function scrollTo(hash: string): void {
  const target = document.querySelector(hash);
  if (!target) return;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  target.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
}

export function Nav() {
  return (
    <nav className="fixed inset-x-0 top-0 z-50 flex items-center justify-between gap-4 px-4 py-4 sm:px-7">
      <div className="edge flex items-center gap-1 rounded-full bg-surface/70 p-1.5 pr-2 backdrop-blur-xl">
        <a
          href="#top"
          onClick={(event) => {
            event.preventDefault();
            window.scrollTo({ top: 0, behavior: "smooth" });
          }}
          className="flex items-center gap-2.5 rounded-full px-3 py-1.5"
        >
          <span className="grid h-5 w-5 place-items-center rounded-[6px] border border-steel-500 bg-raised">
            <span className="h-1.5 w-1.5 rounded-full bg-rim" />
          </span>
          <span className="text-[13px] font-semibold tracking-tight">{BRAND.name}</span>
        </a>

        <span className="mx-1 hidden h-4 w-px bg-line sm:block" />

        <div className="hidden items-center sm:flex">
          {NAV.map((item) => (
            <a
              key={item.href}
              href={item.href}
              onClick={(event) => {
                event.preventDefault();
                scrollTo(item.href);
              }}
              className="rounded-full px-3 py-1.5 text-[13px] text-muted transition-colors hover:bg-raised hover:text-fg"
            >
              {item.label}
            </a>
          ))}
        </div>
      </div>

      <a
        href={explorerAccount(CHAIN.tenderContract)}
        target="_blank"
        rel="noreferrer"
        className="edge rounded-full bg-surface/70 px-4 py-2.5 text-[13px] font-medium backdrop-blur-xl transition-colors hover:bg-raised"
      >
        <span className="hidden sm:inline">View on explorer </span>↗
      </a>
    </nav>
  );
}
