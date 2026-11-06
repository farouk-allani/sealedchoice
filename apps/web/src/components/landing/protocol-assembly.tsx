"use client";

import { useEffect, useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { ACTS } from "../../content/landing.ts";

/** Frames in the rendered cycle. Must match build_protocol_sequence.py (step 12, six stages). */
const FRAME_COUNT = 61;
export const STAGE_STEP = 12;

/** The copy describes the stage the machine is nearest to. */
const stageForFrame = (frame: number) =>
  Math.min(ACTS.length - 1, Math.max(0, Math.round(frame / STAGE_STEP)));

/**
 * One Cycles-rendered machine cycle, scrubbed by scroll. The browser composites frames and
 * cross-blends between them; it does not relight the asset. This component is only mounted
 * when motion is allowed, so the sequence is never fetched for a reduced-motion reader.
 */
export function ProtocolAssembly({
  onStage,
  onProgress,
}: {
  onStage: (index: number) => void;
  onProgress: (progress: number) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const report = useRef({ onStage, onProgress });
  // Kept in a ref so the scrub effect below can stay mounted for the life of the section.
  useEffect(() => {
    report.current = { onStage, onProgress };
  }, [onStage, onProgress]);

  useEffect(() => {
    const host = hostRef.current;
    const canvas = canvasRef.current;
    if (!host || !canvas) return;
    const context = canvas.getContext("2d", { alpha: true });
    if (!context) return;
    const motionless = window.matchMedia("(prefers-reduced-motion: reduce)");
    let disposed = false;
    let requestedFrame = 0;
    let animationFrame = 0;
    const images: Array<HTMLImageElement | undefined> = [];

    const draw = () => {
      animationFrame = 0;
      if (disposed || motionless.matches) return;
      const frame = requestedFrame;
      const base = Math.floor(frame);
      const current = images[base];
      // Until a frame has arrived, hold the nearest one that has: scrubbing never blanks out.
      const available = images
        .map((image, index) => ({ image, distance: Math.abs(index - frame) }))
        .filter(({ image }) => image?.complete && image.naturalWidth)
        .sort((a, b) => a.distance - b.distance)[0]?.image;
      const image =
        current?.complete && current.naturalWidth ? current : available;
      if (!image) return;
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.globalAlpha = 1;
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const next = images[Math.min(FRAME_COUNT - 1, base + 1)];
      if (image === current && next?.complete && next.naturalWidth) {
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

    const resize = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const { width, height } = entry.contentRect;
      const scale = Math.min(devicePixelRatio, 1.5);
      canvas.width = Math.min(1200, Math.ceil(width * scale));
      canvas.height = Math.ceil(canvas.width * (height / width));
      requestDraw();
    });
    resize.observe(host);

    let loadIndex = 0;
    const loadNext = () => {
      if (disposed || motionless.matches || loadIndex >= FRAME_COUNT) return;
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
      let reportedStage = -1;
      const tween = gsap.to(state, {
        frame: FRAME_COUNT - 1,
        ease: "none",
        onUpdate: () => {
          requestedFrame = state.frame;
          requestDraw();
          report.current.onProgress(state.frame / (FRAME_COUNT - 1));
          const next = stageForFrame(state.frame);
          if (next !== reportedStage) {
            reportedStage = next;
            report.current.onStage(next);
          }
        },
        scrollTrigger: {
          trigger: host.closest(".protocol-scroll"),
          start: "top top",
          end: "bottom bottom",
          scrub: 0.65,
        },
      });
      return () => {
        tween.scrollTrigger?.kill();
        tween.kill();
      };
    });

    const onMotion = () => {
      if (!motionless.matches) loadNext();
      requestDraw();
    };
    motionless.addEventListener("change", onMotion);
    return () => {
      disposed = true;
      media.revert();
      resize.disconnect();
      motionless.removeEventListener("change", onMotion);
      cancelAnimationFrame(animationFrame);
      images.forEach((image) => {
        if (image) {
          image.onload = null;
          image.onerror = null;
        }
      });
    };
  }, []);

  return (
    <div className="protocol-assembly" ref={hostRef} aria-hidden="true">
      <canvas className="protocol-canvas" ref={canvasRef} />
    </div>
  );
}
