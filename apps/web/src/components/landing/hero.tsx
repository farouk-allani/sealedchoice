"use client";
import { useEffect, useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { CHAIN, DEMO_TENDER } from "../../config/evidence.ts";
import { BlenderVault } from "./blender-vault.tsx";

export function Hero() {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    gsap.registerPlugin(ScrollTrigger);
    const media = gsap.matchMedia();
    media.add("(prefers-reduced-motion: no-preference)", () => {
      const context = gsap.context(() => {
        gsap.from(".hero-copy > *", {
          y: 22,
          autoAlpha: 0,
          duration: 1.1,
          stagger: 0.12,
          ease: "power3.out",
        });
        const timeline = gsap.timeline({
          scrollTrigger: {
            trigger: ref.current,
            start: "top top",
            end: "bottom bottom",
            scrub: 0.65,
          },
        });
        timeline
          .to(".hero-copy", { y: -90, autoAlpha: 0, duration: 0.4 }, 0.05)
          .to(".hero-bottom", { autoAlpha: 0, duration: 0.25 }, 0)
          .to(
            ".cinema-vault",
            { yPercent: 35, scale: 0.68, ease: "none", duration: 1 },
            0,
          );
      }, ref);
      return () => context.revert();
    });
    return () => media.revert();
  }, []);
  return (
    <section id="vault-experience" className="vault-experience" ref={ref}>
      <div className="hero-stage">
        <BlenderVault />
        <div className="hero-copy">
          <h1>
            Sealed tenders.
            <br />
            Verifiable awards.
          </h1>
          <div className="hero-actions">
            <a href="#result" className="button button-light">
              Explore demo tender
            </a>
            <a href="#verify" className="button button-outline">
              Verify {DEMO_TENDER.evidenceChecks}/{DEMO_TENDER.evidenceChecks}
            </a>
          </div>
        </div>
        <div className="hero-bottom">
          <p>
            Encrypted in your browser.
            <br />
            Evaluated inside a TEE.
            <br />
            Recorded on NEAR {CHAIN.network}.
          </p>
          <a href="#result" className="scroll-cue">
            Scroll to explore <span aria-hidden="true">&#8595;</span>
          </a>
          <p>
            Confidential bids.
            <br />
            An inspectable decision.
          </p>
        </div>
      </div>
    </section>
  );
}
