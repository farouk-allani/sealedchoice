"use client";

import Image from "next/image";
import { useEffect, useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

let sequence: Promise<HTMLImageElement[]> | undefined;
function loadSequence() {
  sequence ??= Promise.all(
    Array.from(
      { length: 24 },
      (_, index) =>
        new Promise<HTMLImageElement>((resolve) => {
          const image = new window.Image();
          image.onload = () => resolve(image);
          image.onerror = () => resolve(image);
          image.src = `/visuals/blender/seal-${String(index).padStart(3, "0")}.webp`;
        }),
    ),
  );
  return sequence;
}

export function BlenderSeal({
  className = "",
  variant = 0,
  podium = false,
}: {
  className?: string;
  variant?: number;
  podium?: boolean;
}) {
  const ref = useRef<HTMLImageElement>(null);
  useEffect(() => {
    const image = ref.current;
    if (!image) return;
    let disposed = false;
    let frames: HTMLImageElement[] = [];
    let last = -1;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const pose = { frame: variant * 3 };
    const draw = () => {
      const index = Math.round(pose.frame);
      const frame = frames[index];
      if (disposed || reduced.matches || last === index || !frame?.naturalWidth)
        return;
      image.src = frame.src;
      last = index;
    };
    gsap.registerPlugin(ScrollTrigger);
    const media = gsap.matchMedia();
    media.add("(prefers-reduced-motion: no-preference)", () => {
      const observer = new IntersectionObserver(
        ([entry]) => {
          if (!entry?.isIntersecting) return;
          observer.disconnect();
          void loadSequence().then((loaded) => {
            if (!disposed) {
              frames = loaded;
              draw();
            }
          });
        },
        { rootMargin: "600px" },
      );
      observer.observe(image);
      gsap.to(pose, {
        frame: podium ? 23 : 13 + variant * 3,
        ease: "none",
        onUpdate: draw,
        scrollTrigger: {
          trigger: image.closest(podium ? "#story" : "#result"),
          start: "top bottom",
          end: podium ? "bottom top" : "center center",
          scrub: 0.7,
        },
      });
      return () => {
        observer.disconnect();
        image.src = "/visuals/blender/seal-poster.webp";
        last = -1;
      };
    });
    return () => {
      disposed = true;
      media.revert();
    };
  }, [podium, variant]);
  return (
    <Image
      ref={ref}
      className={className}
      src="/visuals/blender/seal-poster.webp"
      alt=""
      width={640}
      height={640}
      sizes="(max-width: 760px) 45vw, 24vw"
      unoptimized
    />
  );
}
