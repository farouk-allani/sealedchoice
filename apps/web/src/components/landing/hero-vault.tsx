"use client";

import { useEffect, useRef } from "react";
import gsap from "gsap";
import { vaultStateAt } from "../../lib/landing/vault-state.ts";
import { useReducedMotion } from "../../lib/landing/use-reduced-motion.ts";
import { VaultFigure, type VaultHandle } from "./vault-figure.tsx";

/** The closed door behind the headline: sealed, lit, and following the pointer a little. */
export function HeroVault() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const vaultRef = useRef<VaultHandle>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    vaultRef.current?.apply(vaultStateAt(0));
    if (reduced) return;

    const wrap = wrapRef.current;
    if (!wrap) return;

    const move = gsap.quickTo(wrap, "x", { duration: 1.1, ease: "power3.out" });
    const moveY = gsap.quickTo(wrap, "y", { duration: 1.1, ease: "power3.out" });

    const onPointer = (event: PointerEvent): void => {
      const dx = event.clientX / window.innerWidth - 0.5;
      const dy = event.clientY / window.innerHeight - 0.5;
      move(dx * 34);
      moveY(dy * 26);
    };

    window.addEventListener("pointermove", onPointer, { passive: true });
    return () => window.removeEventListener("pointermove", onPointer);
  }, [reduced]);

  return (
    <div className="pointer-events-none absolute inset-0 -z-20 flex items-center justify-center">
      <div ref={wrapRef} className="will-change-transform">
        <VaultFigure
          ref={vaultRef}
          className="aspect-square w-[128vw] opacity-80 sm:w-[min(94vh,74vw)] sm:opacity-95"
        />
      </div>
    </div>
  );
}
