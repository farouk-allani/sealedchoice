import { BRAND } from "@tender/shared";
import Link from "next/link";
import { CHAIN, explorerAccount } from "../../config/evidence.ts";
import { BrandMark } from "./nav.tsx";
import { DOCS_URL } from "../../config/links.ts";

export function Footer() {
  return (
    <footer className="landing-footer section-shell">
      <div className="footer-top">
        <a className="footer-brand" href="#top">
          <BrandMark />
          {BRAND.name}
        </a>
        <p>
          Sealed tenders.
          <br />
          Verifiable awards.
        </p>
        <Link className="button button-light footer-app-link" href="/tenders">
          Open app
        </Link>
      </div>
      <div className="footer-wordmark" aria-hidden="true">
        {BRAND.name}
      </div>
      <div className="footer-bottom">
        <span>BUILT FOR THE NEAR HACKATHON 2026</span>
        <div>
          <a
            href={explorerAccount(CHAIN.tenderContract)}
            target="_blank"
            rel="noreferrer"
          >
            Contract ↗
          </a>
          <a href="#limits">Trust boundaries</a>
          <a href={DOCS_URL}>Documentation</a>
          <a href="#top">
            Back to top <span aria-hidden="true">↑</span>
          </a>
          <span>
            {CHAIN.network} / no real funds
          </span>
        </div>
      </div>
    </footer>
  );
}
