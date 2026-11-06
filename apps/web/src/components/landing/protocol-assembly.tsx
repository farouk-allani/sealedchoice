"use client";

import Image from "next/image";
import { useEffect, useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { ACTS } from "../../content/landing.ts";

/** Frames in the rendered cycle. Must match build_protocol_sequence.py (step 12, six stages). */
const FRAME_COUNT = 61;
export const STAGE_STEP = 12;

/**
 * The copy switches a little past the midpoint of a transition, so the panel describes the
 * stage the machine has mostly arrived at rather than the one it is still leaving.
 */
const STAGE_BIAS = 0.35;
export const stageForFrame = (frame: number) =>
  Math.min(
    ACTS.length - 1,
    Math.max(0, Math.floor(frame / STAGE_STEP + STAGE_BIAS)),
  );

export type ProtocolControls = { scrollToStage: (index: number) => void };

/**
 * One Cycles-rendered machine cycle, scrubbed by scroll. The browser composites frames and
 * cross-blends between them; it does not relight the asset. Under reduced motion the sequence
 * is never fetched and the six stage posters are shown instead, selected by the tabs.
 */
export function ProtocolAssembly({
  stage,
  onStage,
  controls,
}: {
  stage: number;
  onStage: (index: number) => void;
  controls: { current: ProtocolControls | null };
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const onStageRef = useRef(onStage);
  // Kept in a ref so the scrub effect below can stay mounted for the life of the section.
  useEffect(() => {
    onStageRef.current = onStage;
  }, [onStage]);

  useEffect(() => {
    const host = hostRef.current;
    const canvas = canvasRef.current;
    if (!host || !canvas) return;
    const context = canvas.getContext("2d", { alpha: true });
    if (!context) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    let disposed = false;
    let requestedFrame = 0;
    let animationFrame = 0;
    const images: Array<HTMLImageElement | undefined> = [];
    const poster = new window.Image();

    const draw = () => {
      animationFrame = 0;
      if (disposed) return;
      const frame = reduced.matches ? 0 : requestedFrame;
      const base = Math.floor(frame);
      const current = frame < 0.2 ? poster : images[base];
      // Until a frame has arrived, hold the nearest one that has: scrubbing never blanks out.
      const available = images
        .map((image, index) => ({ image, distance: Math.abs(index - frame) }))
        .filter(({ image }) => image?.complete && image.naturalWidth)
        .sort((a, b) => a.distance - b.distance)[0]?.image;
      const image =
        current?.complete && current.naturalWidth
          ? current
          : (available ?? poster);
      if (!image.complete || !image.naturalWidth) return;
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.globalAlpha = 1;
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const next = images[Math.min(FRAME_COUNT - 1, base + 1)];
      if (
        image === current &&
        frame > 0.2 &&
        next?.complete &&
        next.naturalWidth
      ) {
        // Blend the fractional part, so 61 frames read as continuous motion under a slow scrub.
        context.globalAlpha = frame - base;
        context.drawImage(next, 0, 0, canvas.width, canvas.height);
        context.globalAlpha = 1;
      }
      host.dataset.ready = "true";
    };
    const requestDraw = () => {
      if (!disposed && !animationFrame)
        animationFrame = requestAnimationFrame(draw);
    };
    poster.onload = requestDraw;
    poster.src = "/visuals/blender/protocol-sealed-poster.webp";

    const resize = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const size = Math.min(
        1200,
        Math.ceil(entry.contentRect.width * Math.min(devicePixelRatio, 1.5)),
      );
      canvas.width = size;
      canvas.height = size;
      requestDraw();
    });
    resize.observe(host);

    let loadIndex = 0;
    const loadNext = () => {
      if (disposed || reduced.matches || loadIndex >= FRAME_COUNT) return;
      const index = loadIndex++;
      const image = new window.Image();
      images[index] = image;
      image.onload = () => {
        requestDraw();
        loadNext();
      };
      image.onerror = loadNext;
      image.src = `/visuals/blender/protocol-seq-${String(index).padStart(4, "0")}.webp`;
    };
    for (let i = 0; i < 4; i++) loadNext();

    gsap.registerPlugin(ScrollTrigger);
    const state = { frame: 0 };
    const media = gsap.matchMedia();
    media.add("(prefers-reduced-motion: no-preference)", () => {
      loadNext();
      let reported = -1;
      const tween = gsap.to(state, {
        frame: FRAME_COUNT - 1,
        ease: "none",
        onUpdate: () => {
          requestedFrame = state.frame;
          requestDraw();
          const next = stageForFrame(state.frame);
          if (next !== reported) {
            reported = next;
            onStageRef.current(next);
          }
        },
        scrollTrigger: {
          trigger: host.closest(".protocol-scroll"),
          start: "top top",
          end: "bottom bottom",
          scrub: 0.65,
        },
      });
      const trigger = tween.scrollTrigger;
      controls.current = {
        scrollToStage: (index) => {
          if (!trigger) return;
          const span = trigger.end - trigger.start;
          const target =
            trigger.start + (span * (index * STAGE_STEP)) / (FRAME_COUNT - 1);
          window.scrollTo({ top: target, behavior: "smooth" });
        },
      };
      return () => {
        controls.current = null;
      };
    });

    const onMotion = () => {
      if (!reduced.matches) loadNext();
      requestDraw();
    };
    reduced.addEventListener("change", onMotion);
    return () => {
      disposed = true;
      media.revert();
      resize.disconnect();
      reduced.removeEventListener("change", onMotion);
      cancelAnimationFrame(animationFrame);
      images.forEach((image) => {
        if (image) {
          image.onload = null;
          image.onerror = null;
        }
      });
      poster.onload = null;
    };
  }, [controls]);

  return (
    <div className="protocol-assembly" ref={hostRef} aria-hidden="true">
      <canvas className="protocol-canvas" ref={canvasRef} />
      {/* Reduced motion shows these instead: no sequence is fetched and the tabs select. */}
      <div className="protocol-stills">
        {ACTS.map((item, index) => (
          <Image
            key={item.id}
            src={`/visuals/blender/protocol-${item.id}-poster.webp`}
            alt=""
            fill
            sizes="(max-width: 760px) 100vw, 55vw"
            unoptimized
            className={`protocol-render ${index === stage ? "is-active" : ""}`}
          />
        ))}
      </div>
    </div>
  );
}
