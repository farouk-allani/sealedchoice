"use client";

import { forwardRef, useImperativeHandle, useRef } from "react";
import type { VaultState } from "../../lib/landing/vault-state.ts";
import { DEMO_TENDER } from "../../config/evidence.ts";

export type VaultHandle = {
  /** Called on every scroll frame. Writes straight to the DOM; never sets React state. */
  apply: (state: VaultState) => void;
};

const BOLT_COUNT = 8;
/** Stacked discs that give the door slab its thickness when it swings. */
const DOOR_SLICES = 16;
const DOOR_THICKNESS = 52;
/** Receding rings that give the open doorway depth. */
const CHAMBER_RINGS = 7;
const SPOKE_COUNT = 4;

/**
 * Brushed steel. A conic gradient around the disc is what sells turned metal — a linear one
 * reads as plastic however many stops it has. The light sits upper-left and everything else
 * (specular, occlusion, rim) agrees with it.
 */
const BRUSHED =
  "conic-gradient(from 212deg at 50% 50%, " +
  "#20232a 0deg, #474d59 26deg, #1b1e25 58deg, #3d434e 92deg, #23262e 128deg, " +
  "#565d6a 168deg, #1c1f26 204deg, #414751 242deg, #262a32 282deg, #4b515d 318deg, #20232a 360deg)";

const SPECULAR =
  "radial-gradient(circle at 31% 22%, rgba(255,255,255,0.26) 0%, rgba(255,255,255,0.07) 22%, transparent 52%)";

/**
 * The vault, drawn with CSS gradients and SVG.
 *
 * This is the low-power path: it is what a reader gets on a phone, with WebGL unavailable, or
 * with prefers-reduced-motion set. Any WebGL version is driven by the same `VaultState`, so the
 * two can never tell different stories.
 */
export const VaultFigure = forwardRef<VaultHandle, { className?: string }>(function VaultFigure(
  { className = "" },
  ref,
) {
  const sceneRef = useRef<HTMLDivElement>(null);
  const doorRef = useRef<HTMLDivElement>(null);
  const dialRef = useRef<SVGGElement>(null);
  const slotRef = useRef<SVGRectElement>(null);
  const engraveRef = useRef<SVGGElement>(null);
  const interiorRef = useRef<HTMLDivElement>(null);
  const boltRefs = useRef<Array<SVGGElement | null>>([]);

  useImperativeHandle(ref, () => ({
    apply(state) {
      if (sceneRef.current) {
        const scale = 1 + state.dolly * 1.1;
        sceneRef.current.style.transform = `translate3d(0, ${state.dolly * -3}%, 0) scale(${scale})`;
        // Never disappears completely: the open doorway stays as a frame around the chamber.
        sceneRef.current.style.opacity = String(1 - state.dolly * 0.55);
      }

      if (doorRef.current) {
        doorRef.current.style.transform = `rotateY(${-state.door * 104}deg)`;
      }

      if (dialRef.current) {
        dialRef.current.style.transform = `rotate(${state.dial * 360}deg)`;
      }

      if (slotRef.current) {
        const width = 168 * state.slot;
        slotRef.current.setAttribute("x", String(300 - width / 2));
        slotRef.current.setAttribute("width", String(width));
        slotRef.current.style.opacity = String(Math.min(1, state.slot * 2.5) * 0.38);
      }

      if (engraveRef.current) {
        engraveRef.current.style.opacity = String(state.engrave);
      }

      if (interiorRef.current) {
        interiorRef.current.style.opacity = String(state.interior);
      }

      for (let i = 0; i < boltRefs.current.length; i += 1) {
        const bolt = boltRefs.current[i];
        if (!bolt) continue;
        // Bolts release in sequence; eight moving together read as a single part.
        const stagger = i / (BOLT_COUNT * 2.2);
        const local = Math.max(0, Math.min(1, (state.bolts - stagger) / (1 - stagger)));
        bolt.style.transform = `translateX(${-local * 40}px)`;
      }
    },
  }));

  return (
    <div className={`pointer-events-none select-none ${className}`} aria-hidden="true">
      <div className="relative h-full w-full [perspective:1800px]">
        <div
          ref={sceneRef}
          className="absolute inset-0 origin-center will-change-transform"
          style={{ transformStyle: "preserve-3d" }}
        >
          {/* The frame: the ring of steel the door seats into. */}
          <div
            className="absolute inset-0 rounded-full"
            style={{
              background: BRUSHED,
              boxShadow:
                "inset 0 2px 3px rgba(255,255,255,0.14), inset 0 -3px 8px rgba(0,0,0,0.85), " +
                "0 40px 120px rgba(0,0,0,0.9)",
            }}
          />
          {/* The recess the door sits in, so an open door reveals depth rather than a hole. */}
          <div
            className="absolute inset-[7%] rounded-full"
            style={{
              background: "radial-gradient(circle at 50% 44%, #0b0d12 0%, #06070a 70%, #04050700 100%)",
              boxShadow: "inset 0 10px 34px rgba(0,0,0,0.95)",
            }}
          />

          {/*
            The chamber. Receding rings give the doorway somewhere to lead: without depth here
            an open door is just a hole, and the whole moment falls flat.
          */}
          <div
            ref={interiorRef}
            className="absolute inset-[9%] rounded-full opacity-0"
            style={{ transformStyle: "preserve-3d" }}
          >
            {Array.from({ length: CHAMBER_RINGS }, (_, i) => {
              const t = (i + 1) / CHAMBER_RINGS;
              const inset = 4 + t * 26;
              return (
                <div
                  key={i}
                  className="absolute rounded-full"
                  style={{
                    inset: `${inset}%`,
                    transform: `translateZ(${-60 - t * 320}px)`,
                    border: "1px solid rgba(132,144,190,0.16)",
                    background: `radial-gradient(circle at 50% 44%, rgba(108,120,255,${0.1 * t}) 0%, rgba(7,8,11,${0.5 + t * 0.4}) 72%)`,
                  }}
                />
              );
            })}
            {/* The light at the far end. */}
            <div
              className="absolute inset-[34%] rounded-full"
              style={{
                transform: "translateZ(-400px)",
                background:
                  "radial-gradient(circle, rgba(214,220,255,0.92) 0%, rgba(108,120,255,0.55) 34%, rgba(108,120,255,0.1) 68%, transparent 100%)",
                filter: "blur(6px)",
              }}
            />
          </div>

          {/* The door. Hinged on its left edge. */}
          <div
            ref={doorRef}
            className="absolute inset-0 origin-left will-change-transform"
            style={{ transformStyle: "preserve-3d" }}
          >
            {/*
              A vault door's thickness is the whole visual. CSS 3D gives a plane no volume, so
              the slab is built from stacked discs at increasing depth — edge-on they read as
              one machined cylinder, which is exactly the moment the door swings open.
            */}
            {Array.from({ length: DOOR_SLICES }, (_, i) => {
              const depth = ((i + 1) / DOOR_SLICES) * DOOR_THICKNESS;
              const shade = 1 - (i / DOOR_SLICES) * 0.72;
              return (
                <div
                  key={i}
                  className="absolute inset-[9%] rounded-full"
                  style={{
                    transform: `translateZ(${-depth}px)`,
                    background: `linear-gradient(176deg, rgba(104,112,126,${0.95 * shade}) 0%, rgba(44,48,56,${shade}) 38%, rgba(20,22,27,${shade}) 72%, rgba(8,9,12,${shade}) 100%)`,
                  }}
                />
              );
            })}

            {/* The back of the door: plain plate, no dial, no engraving. */}
            <div
              className="absolute inset-[9%] rounded-full"
              style={{
                transform: `translateZ(${-DOOR_THICKNESS - 1}px)`,
                background:
                  "radial-gradient(circle at 62% 38%, #30343d 0%, #1b1e24 52%, #0e1014 100%)",
                boxShadow: "inset 0 0 0 2px rgba(0,0,0,0.6)",
              }}
            />

            <div
              className="absolute inset-[9%] rounded-full"
              style={{
                background: BRUSHED,
                boxShadow:
                  "inset 0 0 0 1px rgba(108,120,255,0.3), " +
                  "inset 0 3px 4px rgba(255,255,255,0.16), " +
                  "inset 0 -10px 26px rgba(0,0,0,0.8), " +
                  "0 24px 70px rgba(0,0,0,0.75)",
              }}
            />
            {/* Specular: one light, upper-left, as everything else assumes. */}
            <div
              className="absolute inset-[9%] rounded-full"
              style={{ background: SPECULAR, mixBlendMode: "screen" }}
            />
            {/* Contact shadow where the plate meets the frame. */}
            <div
              className="absolute inset-[9%] rounded-full"
              style={{
                background:
                  "radial-gradient(circle at 50% 50%, transparent 72%, rgba(0,0,0,0.55) 93%, rgba(0,0,0,0.8) 100%)",
              }}
            />

            <svg viewBox="0 0 600 600" className="absolute inset-0 h-full w-full">
              <defs>
                <linearGradient id="sc-bolt" x1="0%" y1="0%" x2="0%" y2="100%">
                  <stop offset="0%" stopColor="#99a1b0" />
                  <stop offset="18%" stopColor="#6b7281" />
                  <stop offset="55%" stopColor="#363b45" />
                  <stop offset="100%" stopColor="#1d2026" />
                </linearGradient>
                <linearGradient id="sc-spoke" x1="0%" y1="0%" x2="0%" y2="100%">
                  <stop offset="0%" stopColor="#aab1bf" />
                  <stop offset="30%" stopColor="#6d7482" />
                  <stop offset="70%" stopColor="#3a3f49" />
                  <stop offset="100%" stopColor="#23262d" />
                </linearGradient>
                <radialGradient id="sc-hub" cx="36%" cy="28%" r="78%">
                  <stop offset="0%" stopColor="#3c424d" />
                  <stop offset="55%" stopColor="#23272f" />
                  <stop offset="100%" stopColor="#14161b" />
                </radialGradient>
              </defs>

              {/* Turned rings. Thin, low contrast, two tones — this is what reads as machined. */}
              {[232, 214, 198, 156].map((r, i) => (
                <g key={r}>
                  <circle cx="300" cy="300" r={r} fill="none" stroke="#000" strokeWidth="1.5" opacity="0.5" />
                  <circle
                    cx="300"
                    cy="300"
                    r={r - 1}
                    fill="none"
                    stroke="#8e96a5"
                    strokeWidth="1"
                    opacity={i === 0 ? 0.3 : 0.18}
                  />
                </g>
              ))}

              {/* Locking bolts, each retracting toward the centre along its own radius. */}
              {Array.from({ length: BOLT_COUNT }, (_, i) => {
                const angle = (360 / BOLT_COUNT) * i;
                return (
                  <g key={i} transform={`rotate(${angle} 300 300)`}>
                    {/*
                      Radius matters: the bolt sits between the outer turned ring and the door
                      edge (r 196..266 of a 244 plate), so it reads as a bolt shooting into the
                      frame. Drawn on the right and rotated into place.
                    */}
                    {/* The channel the bolt withdraws into. */}
                    <rect x="492" y="285" width="78" height="30" rx="9" fill="#07080b" opacity="0.8" />
                    <g
                      ref={(node) => {
                        boltRefs.current[i] = node;
                      }}
                      className="will-change-transform"
                    >
                      <rect x="496" y="288" width="70" height="24" rx="7" fill="url(#sc-bolt)" />
                      <rect x="499" y="290" width="64" height="2" rx="1" fill="#c3cad6" opacity="0.6" />
                      <rect x="556" y="287" width="10" height="26" rx="4" fill="#9ba3b1" opacity="0.5" />
                    </g>
                  </g>
                );
              })}

              {/* The bid slot: open while bids are accepted, shut at the deadline. */}
              <g>
                <rect x="216" y="466" width="168" height="18" rx="9" fill="#05060a" opacity="0.92" />
                <rect x="216" y="466" width="168" height="1.5" rx="1" fill="#000" opacity="0.6" />
                <rect
                  ref={slotRef}
                  x="216"
                  y="469"
                  width="168"
                  height="12"
                  rx="6"
                  fill="var(--color-rim)"
                  opacity="0.38"
                />
              </g>

              {/* The engraving that appears once the bid set is frozen. */}
              <g ref={engraveRef} style={{ opacity: 0 }}>
                <text
                  x="300"
                  y="118"
                  textAnchor="middle"
                  fill="#aeb5c2"
                  fontSize="14"
                  letterSpacing="6"
                  fontFamily="var(--font-mono)"
                >
                  BID SET FROZEN
                </text>
                <text
                  x="300"
                  y="140"
                  textAnchor="middle"
                  fill="var(--color-rim)"
                  fontSize="12"
                  letterSpacing="3.5"
                  fontFamily="var(--font-mono)"
                  opacity="0.85"
                >
                  {`${DEMO_TENDER.bids} BIDS · ATTEMPT ${DEMO_TENDER.attempt}`}
                </text>
              </g>

              {/* Centre dial and its spoke handle. */}
              <g
                ref={dialRef}
                className="will-change-transform"
                style={{ transformOrigin: "300px 300px" }}
              >
                {Array.from({ length: SPOKE_COUNT }, (_, i) => (
                  <g key={i} transform={`rotate(${(360 / SPOKE_COUNT) * i} 300 300)`}>
                    <rect x="294" y="168" width="12" height="136" rx="6" fill="#000" opacity="0.45" />
                    <rect x="295" y="166" width="10" height="136" rx="5" fill="url(#sc-spoke)" />
                    <circle cx="300" cy="170" r="13" fill="url(#sc-hub)" stroke="#8d95a3" strokeWidth="1.5" />
                    <circle cx="297" cy="166" r="4" fill="#c7cedb" opacity="0.4" />
                  </g>
                ))}
                <circle cx="300" cy="300" r="92" fill="url(#sc-hub)" stroke="#000" strokeWidth="2" />
                <circle cx="300" cy="300" r="90" fill="none" stroke="#7d8593" strokeWidth="1" opacity="0.35" />
                <circle cx="300" cy="300" r="70" fill="none" stroke="#000" strokeWidth="1.5" opacity="0.5" />
                <circle cx="300" cy="300" r="30" fill="#1b1e24" stroke="#737b89" strokeWidth="2" />
                <circle cx="300" cy="300" r="8" fill="var(--color-rim)" opacity="0.85" />
              </g>
            </svg>
          </div>
        </div>
      </div>
    </div>
  );
});
