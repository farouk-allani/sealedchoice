"use client";

import { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { ACTS } from "../../content/landing.ts";
import Image from "next/image";
import { BlenderSeal } from "./blender-seal.tsx";

const STEPS = [
  {
    title: "Sealed in your browser.",
    body: "Your bid is encrypted before it leaves your device. The buyer can count the submissions, but cannot read them before the deadline.",
  },
  {
    title: "The deadline closes the door.",
    body: "A Merkle root freezes the submitted bid set. Nothing added late. Nothing quietly dropped. The evaluator works with that exact set.",
  },
  {
    title: "A pinned evaluator. An isolated environment.",
    body: "The contract calls the evaluator selected before bidding began. Decryption and evaluation happen inside an OutLayer trusted execution environment.",
  },
  {
    title: "Models read. Code checks.",
    body: "Models assess written criteria without seeing prices. Code checks their quoted evidence, flags suspected prompt injection, and calculates the final ranking.",
  },
  {
    title: "Human judgment. A recorded decision.",
    body: "A committee makes the award. Choosing outside the ranking requires a written rationale. The contract pays the awarded bidder once.",
  },
  {
    title: "The result comes with the receipts.",
    body: "Inspect the frozen root, evaluator attestation, signed model calls and scores. Recompute what the code decided from the recorded evidence.",
  },
];
export function Story() {
  const [active, setActive] = useState(0);
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const context = gsap.context(() => {
      gsap.fromTo(
        panelRef.current,
        { opacity: 0, y: 14 },
        { opacity: 1, y: 0, duration: 0.45, ease: "power2.out" },
      );
    });
    return () => context.revert();
  }, [active]);
  const act = ACTS[active]!;
  const step = STEPS[active]!;
  return (
    <section id="story" className="protocol-section section-shell">
      <div className="section-topline">
        <span className="eyebrow">01 / INSIDE THE PROTOCOL</span>
        <span className="section-aside">
          CONFIDENTIAL INPUTS. INSPECTABLE OUTPUTS.
        </span>
      </div>
      <div className="protocol-grid">
        <div className="protocol-copy">
          <h2 className="section-title">
            Pinned evaluator.
            <br />
            <span>Private inputs.</span>
          </h2>
          <div
            className="protocol-tabs"
            role="tablist"
            aria-label="Tender lifecycle"
          >
            {ACTS.map((item, index) => (
              <button
                type="button"
                role="tab"
                id={`step-${index}`}
                aria-controls="protocol-panel"
                aria-selected={active === index}
                tabIndex={active === index ? 0 : -1}
                key={item.id}
                onClick={() => setActive(index)}
                onKeyDown={(event) => {
                  const next =
                    event.key === "ArrowRight"
                      ? (active + 1) % ACTS.length
                      : event.key === "ArrowLeft"
                        ? (active + ACTS.length - 1) % ACTS.length
                        : event.key === "Home"
                          ? 0
                          : event.key === "End"
                            ? ACTS.length - 1
                            : null;
                  if (next !== null) {
                    event.preventDefault();
                    setActive(next);
                    document.getElementById(`step-${next}`)?.focus();
                  }
                }}
              >
                <span>{item.index}</span>
                {item.kicker}
              </button>
            ))}
          </div>
          <div
            id="protocol-panel"
            role="tabpanel"
            aria-labelledby={`step-${active}`}
            tabIndex={0}
            ref={panelRef}
            className="protocol-panel"
          >
            <h3>{step.title}</h3>
            <p>{step.body}</p>
            <dl>
              {act.facts.map((fact) => (
                <div key={fact.label}>
                  <dt>{fact.label}</dt>
                  <dd className={fact.kind === "pass" ? "is-pass" : ""}>
                    {fact.value}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
        <div className="protocol-visual">
          <div className="podium-art">
            <Image
              src="/visuals/blender/podium-poster.webp"
              alt="Three satin-metal podiums"
              fill
              sizes="(max-width: 760px) 100vw, 60vw"
              unoptimized
              className="podium-render"
            />
            <BlenderSeal className="podium-seal" podium />
          </div>
        </div>
      </div>
      <div className="protocol-foundation">
        <span>BUILT ON</span>
        <strong>
          NEAR<span className="foundation-symbol">↗</span>
        </strong>
        <span className="foundation-divider" />
        <strong>
          OutLayer <small>Trusted execution</small>
        </strong>
        <span className="foundation-divider" />
        <strong>
          NEAR AI <small>Signed model calls</small>
        </strong>
        <p>
          Encrypted in the browser.
          <br />
          Recorded on the chain.
        </p>
      </div>
    </section>
  );
}
