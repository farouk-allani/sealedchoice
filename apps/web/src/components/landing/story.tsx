"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { ACTS } from "../../content/landing.ts";
import { Foundation } from "./foundation.tsx";
import { ProtocolAssembly, STAGE_STEP } from "./protocol-assembly.tsx";

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

const HEADING = "Pinned evaluator. Private inputs.";
const SPAN = STEPS.length - 1;
/**
 * A caption holds full strength across this much of its window, then fades out. Two
 * captions crossing in the same place is unreadable however the opacities are tuned, so
 * they also travel: the outgoing one leaves upward as the next arrives from below, clipped
 * by the caption window. At the boundary they are 110px apart and a third as strong.
 */
const HOLD = 0.34;
const FADE = 0.58;
const TRAVEL = 110;

export function Story() {
  const [active, setActive] = useState(0);
  /**
   * "unknown" until the motion preference is read. The server renders the static sequence
   * without its stills, so a reader who then gets the scrubbed stage fetches none of them:
   * lazy loading alone was not enough, Chrome pulled the first three anyway.
   */
  const [mode, setMode] = useState<"unknown" | "static" | "scrubbed">(
    "unknown",
  );
  const captions = useRef<Array<HTMLDivElement | null>>([]);
  const fill = useRef<HTMLSpanElement>(null);

  /**
   * Scroll position drives the captions directly rather than through React state: a caption
   * is at full strength while its stage is the one being read, then crosses over fast near
   * the boundary. State changes only when the nearest stage changes, which the counter needs.
   */
  const paint = (progress: number) => {
    captions.current.forEach((node, index) => {
      if (!node) return;
      const offset = progress * SPAN - index;
      const distance = Math.abs(offset);
      const strength =
        distance <= HOLD
          ? 1
          : distance >= FADE
            ? 0
            : (FADE - distance) / (FADE - HOLD);
      node.style.opacity = `${strength}`;
      node.style.visibility = strength > 0.01 ? "visible" : "hidden";
      node.style.transform = `translate3d(0, ${(offset * -TRAVEL).toFixed(1)}px, 0)`;
    });
    if (fill.current) fill.current.style.transform = `scaleX(${progress})`;
  };

  /**
   * The static sequence is the baseline: it is what a reader without JavaScript keeps and
   * what a reader who asks for less motion gets. The scrubbed stage replaces it only once
   * motion is known to be welcome. Its stills are the cycle's own stage frames, so the two
   * presentations cannot drift apart when the scene is re-rendered.
   */
  useEffect(() => {
    const motionless = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setMode(motionless.matches ? "static" : "scrubbed");
    sync();
    motionless.addEventListener("change", sync);
    return () => motionless.removeEventListener("change", sync);
  }, []);

  if (mode !== "scrubbed") {
    return (
      <section id="story" className="protocol-section section-shell">
        <div className="protocol-static">
          <h2 className="protocol-heading">{HEADING}</h2>
          <ol className="protocol-sequence">
            {STEPS.map((step, index) => (
              <li key={step.title} data-stage={ACTS[index]!.id}>
                {mode === "static" ? (
                  <Image
                    src={`/visuals/blender/protocol-seq-${String(index * STAGE_STEP).padStart(4, "0")}.webp`}
                    alt=""
                    width={860}
                    height={622}
                    sizes="(max-width: 760px) 86vw, 30vw"
                    unoptimized
                  />
                ) : null}
                <div>
                  <span className="protocol-count">
                    <strong>{ACTS[index]!.index}</strong>
                  </span>
                  <h3>{step.title}</h3>
                  <p>{step.line}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
        <Foundation />
      </section>
    );
  }

  return (
    <section id="story" className="protocol-section section-shell">
      <div className="protocol-scroll">
        <div className="protocol-sticky">
          <div className="protocol-stage" data-stage={ACTS[active]!.id}>
            <h2 className="protocol-heading">{HEADING}</h2>
            <ProtocolAssembly onStage={setActive} onProgress={paint} />
            <div className="protocol-captions">
              {STEPS.map((step, index) => (
                <div
                  className="protocol-caption"
                  key={step.title}
                  ref={(node) => {
                    captions.current[index] = node;
                  }}
                >
                  <h3>{step.title}</h3>
                  <p>{step.line}</p>
                </div>
              ))}
            </div>
            <div className="protocol-progress">
              <span className="protocol-count">
                <strong>{ACTS[active]!.index}</strong>
                <span>of {String(STEPS.length).padStart(2, "0")}</span>
              </span>
              <span className="protocol-track">
                <span className="protocol-track-fill" ref={fill} />
              </span>
              <span className="protocol-stage-name">{ACTS[active]!.id}</span>
            </div>
          </div>
        </div>
      </div>
      <Foundation />
    </section>
  );
}
