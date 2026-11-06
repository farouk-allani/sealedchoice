"use client";

import Image from "next/image";
import { useEffect, useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

const FRAME_COUNT = 24;

/** A Cycles-rendered camera move. The browser composites frames; it does not relight the asset. */
export function BlenderVault() {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

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
        context.globalAlpha = frame - base;
        context.drawImage(next, 0, 0, canvas.width, canvas.height);
        context.globalAlpha = 1;
      }
      host.dataset.ready = "true";
      host.dataset.phase =
        frame < 1 ? "front" : frame > 21 ? "receded" : "tilting";
    };
    const requestDraw = () => {
      if (!disposed && !animationFrame)
        animationFrame = requestAnimationFrame(draw);
    };
    poster.onload = requestDraw;
    poster.src = "/visuals/blender/vault-poster.webp";
    const resize = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const size = Math.min(
        1600,
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
      image.src = `/visuals/blender/vault-${String(index).padStart(3, "0")}.webp`;
    };
    // Four small concurrent requests, all local; the full-resolution poster remains the first frame.
    for (let i = 0; i < 4; i++) loadNext();
    gsap.registerPlugin(ScrollTrigger);
    const state = { frame: 0 };
    const media = gsap.matchMedia();
    media.add("(prefers-reduced-motion: no-preference)", () => {
      loadNext();
      gsap.to(state, {
        frame: FRAME_COUNT - 1,
        ease: "none",
        onUpdate: () => {
          requestedFrame = state.frame;
          requestDraw();
        },
        scrollTrigger: {
          trigger: host.closest("#vault-experience"),
          start: "top top",
          end: "bottom bottom",
          scrub: 0.65,
        },
      });
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
  }, []);

  return (
    <div className="cinema-vault" ref={hostRef} aria-hidden="true">
      <Image
        src="/visuals/blender/vault-poster.webp"
        alt=""
        fill
        sizes="(max-width: 760px) 180vw, 120vh"
        priority
        unoptimized
        className="vault-still"
      />
      <canvas ref={canvasRef} />
    </div>
  );
}
