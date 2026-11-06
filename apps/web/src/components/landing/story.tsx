"use client";

import { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { ACTS } from "../../content/landing.ts";
import {
  ProtocolAssembly,
  type ProtocolControls,
} from "./protocol-assembly.tsx";

/**
 * One short headline per stage, plus a single supporting line. This is the landing page,
 * not the documentation: the measured numbers and the full argument live in the result and
 * verify sections. Keep each line to one clause a reader takes in at a glance.
 */
const STEPS = [
  {
    title: "Sealed in your browser.",
    line: "Encrypted on your device. The buyer can count the bids, not read them.",
  },
  {
    title: "The deadline locks the set.",
    line: "A Merkle root freezes the bids. Nothing added late, nothing quietly dropped.",
  },
  {
    title: "Opened inside the TEE.",
    line: "The contract calls the evaluator it pinned before bidding opened.",
  },
  {
    title: "Models read. Code checks.",
    line: "Models assess written criteria. They never see prices and never rank.",
  },
  {
    title: "The committee awards.",
    line: "Going outside the ranking needs a written rationale. The contract pays once.",
  },
  {
    title: "Receipts for every step.",
    line: "Recompute what the code decided from the recorded evidence.",
  },
];

export function Story() {
  const [active, setActive] = useState(0);
  const panelRef = useRef<HTMLParagraphElement>(null);
  const controls = useRef<ProtocolControls | null>(null);
  /**
   * Scroll owns the stage: the steps are a way to jump within the cycle, not a separate
   * selection. Under reduced motion no ScrollTrigger exists, so `controls` stays null and
   * the click simply selects a still.
   */
  const select = (index: number) => {
    setActive(index);
    controls.current?.scrollToStage(index);
  };
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const context = gsap.context(() => {
      gsap.fromTo(
        panelRef.current,
        { opacity: 0, y: 8 },
        { opacity: 1, y: 0, duration: 0.4, ease: "power2.out" },
      );
    });
    return () => context.revert();
  }, [active]);
  const act = ACTS[active]!;
  const step = STEPS[active]!;
  return (
    <section id="story" className="protocol-section section-shell">
      <div className="protocol-scroll">
        <div className="protocol-sticky">
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
                className="protocol-steps"
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
                    onClick={() => select(index)}
                    onKeyDown={(event) => {
                      const next =
                        event.key === "ArrowDown" || event.key === "ArrowRight"
                          ? (active + 1) % ACTS.length
                          : event.key === "ArrowUp" || event.key === "ArrowLeft"
                            ? (active + ACTS.length - 1) % ACTS.length
                            : event.key === "Home"
                              ? 0
                              : event.key === "End"
                                ? ACTS.length - 1
                                : null;
                      if (next !== null) {
                        event.preventDefault();
                        select(next);
                        document.getElementById(`step-${next}`)?.focus();
                      }
                    }}
                  >
                    <span className="protocol-step-index">{item.index}</span>
                    <span className="protocol-step-title">
                      {STEPS[index]!.title}
                    </span>
                  </button>
                ))}
              </div>
              <p
                id="protocol-panel"
                role="tabpanel"
                aria-labelledby={`step-${active}`}
                tabIndex={0}
                ref={panelRef}
                className="protocol-line"
              >
                {step.line}
              </p>
            </div>
            <figure className="protocol-visual" data-stage={act.id}>
              <ProtocolAssembly
                stage={active}
                onStage={setActive}
                controls={controls}
              />
            </figure>
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
