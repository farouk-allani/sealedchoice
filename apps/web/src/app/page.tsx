import type { Metadata } from "next";
import { BRAND } from "@tender/shared";
import { Nav } from "../components/landing/nav.tsx";
import { Hero } from "../components/landing/hero.tsx";
import { Story } from "../components/landing/story.tsx";
import { Ranking } from "../components/landing/ranking.tsx";
import { Limits } from "../components/landing/limits.tsx";
import { Verify } from "../components/landing/verify.tsx";
import { Footer } from "../components/landing/footer.tsx";

import { LandingMotion } from "../components/landing/landing-motion.tsx";
import "./landing.css";

export const metadata: Metadata = {
  alternates: { canonical: "/" },
  openGraph: {
    url: "/",
    siteName: BRAND.name,
    type: "website",
  },
};

export default function Home() {
  return (
    <>
      <noscript>
        <style>{`
          .vault-experience { height: 100svh; min-height: 650px; }
          .hero-stage { position: relative; }
          .results-section { margin-top: 0; }
          .mobile-menu-toggle { display: none; }
        `}</style>
      </noscript>
      <a href="#story" className="skip-link">
        Skip introduction
      </a>
      <Nav />
      <LandingMotion />
      <main id="top">
        <Hero />
        <Ranking />
        <Story />
        <Limits />
        <Verify />
      </main>
      <Footer />
    </>
  );
}
