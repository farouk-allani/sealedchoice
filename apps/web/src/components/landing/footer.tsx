import { BRAND } from "@tender/shared";
import { CHAIN, explorerAccount } from "../../config/evidence.ts";

export function Footer() {
  return (
    <footer className="border-t border-line">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-6 px-6 py-12 sm:px-10">
        <div>
          <div className="flex items-center gap-2.5">
            <span className="grid h-5 w-5 place-items-center rounded-[6px] border border-steel-500 bg-raised">
              <span className="h-1.5 w-1.5 rounded-full bg-rim" />
            </span>
            <span className="text-[13px] font-semibold tracking-tight">{BRAND.name}</span>
          </div>
          <p className="mt-3 max-w-[40ch] text-[12px] leading-relaxed text-faint">
            {BRAND.tagline} Built on NEAR for the NEAR hackathon. Running on {CHAIN.network} —
            nothing here moves real money.
          </p>
        </div>

        <div className="flex flex-wrap gap-x-7 gap-y-2 font-mono text-[11px] text-faint">
          <a
            href={explorerAccount(CHAIN.tenderContract)}
            target="_blank"
            rel="noreferrer"
            className="transition-colors hover:text-fg"
          >
            Tender contract ↗
          </a>
          <a
            href={explorerAccount(CHAIN.tokenContract)}
            target="_blank"
            rel="noreferrer"
            className="transition-colors hover:text-fg"
          >
            Escrow token ↗
          </a>
          <a href="#limits" className="transition-colors hover:text-fg">
            Limits
          </a>
        </div>
      </div>
    </footer>
  );
}
