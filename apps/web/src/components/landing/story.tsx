"use client";

import { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { ACTS } from "../../content/landing.ts";
import { vaultStateAt } from "../../lib/landing/vault-state.ts";
import { useReducedMotion } from "../../lib/landing/use-reduced-motion.ts";
import { VaultFigure, type VaultHandle } from "./vault-figure.tsx";
import { ActPanel } from "./act-panel.tsx";

/** Scroll distance given to the whole story. Six acts, so a little over one screen each. */
const STORY_VH = 700;

/** The state the figure rests at when motion is reduced: open, lit, nothing moving. */
const STATIC_STATE = vaultStateAt(0.62);

export function Story() {
  const containerRef = useRef<HTMLDivElement>(null);
  const vaultRef = useRef<VaultHandle>(null);
  const railRef = useRef<HTMLDivElement>(null);
  const lastAct = useRef(0);
  const [act, setAct] = useState(0);
  const reduced = useReducedMotion();

  useEffect(() => {
    if (reduced) {
      vaultRef.current?.apply(STATIC_STATE);
      return;
    }

    const container = containerRef.current;
    if (!container) return;

    gsap.registerPlugin(ScrollTrigger);

    // One trigger reads scroll position; everything downstream is a pure function of it.
    const trigger = ScrollTrigger.create({
      trigger: container,
      start: "top top",
      end: "bottom bottom",
      invalidateOnRefresh: true,
      onUpdate: (self) => {
        const state = vaultStateAt(self.progress);
        vaultRef.current?.apply(state);
        if (railRef.current) {
          railRef.current.style.transform = `scaleX(${state.progress})`;
        }
        // React state changes six times across the whole page, not every frame.
        if (state.act !== lastAct.current) {
          lastAct.current = state.act;
          setAct(state.act);
        }
      },
    });

    vaultRef.current?.apply(vaultStateAt(trigger.progress));

    return () => {
      trigger.kill();
    };
  }, [reduced]);

  // Reduced motion: the same six acts as a plain stacked document, nothing pinned, nothing fading.
  if (reduced) {
    return (
      <section id="story" className="mx-auto max-w-3xl px-6 py-24">
        <div className="mx-auto mb-16 h-64 w-64">
          <VaultFigure ref={vaultRef} className="h-full w-full" />
        </div>
        {ACTS.map((item) => (
          <ActPanel key={item.id} act={item} active stacked />
        ))}
      </section>
    );
  }

  return (
    <section id="story" ref={containerRef} style={{ height: `${STORY_VH}vh` }} className="relative">
      <div className="sticky top-0 h-screen overflow-hidden">
        {/* The vault sits behind the text on small screens and beside it on large ones. */}
        <div className="absolute inset-0 flex items-center justify-center opacity-30 lg:left-1/2 lg:opacity-100">
          <VaultFigure
            ref={vaultRef}
            className="aspect-square w-[128vw] max-w-none sm:w-[92vw] lg:w-[min(80vh,40rem)]"
          />
        </div>

        {/* Ink wash so the text never has to fight the metal behind it. */}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-ink via-ink/85 to-transparent lg:via-ink/70" />

        <div className="relative mx-auto h-full max-w-7xl px-6 sm:px-10">
          <div className="relative h-full lg:w-[46%]">
            {ACTS.map((item, i) => (
              <ActPanel key={item.id} act={item} active={i === act} />
            ))}
          </div>
        </div>

        {/* Progress rail: which act, and how far through the story. */}
        <div className="pointer-events-none absolute bottom-10 left-6 right-6 flex items-center gap-4 sm:left-10 sm:right-10">
          <div className="relative h-px flex-1 bg-line-strong">
            <div
              ref={railRef}
              className="absolute inset-0 origin-left bg-rim will-change-transform"
              style={{ transform: "scaleX(0)" }}
            />
          </div>
          <span className="font-mono text-[11px] tracking-[0.2em] text-faint">
            {ACTS[act]?.index ?? "01"} / {String(ACTS.length).padStart(2, "0")}
          </span>
        </div>
      </div>
    </section>
  );
}
