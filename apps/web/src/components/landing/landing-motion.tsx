"use client";
import { useEffect } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

export function LandingMotion() {
  useEffect(() => {
    gsap.registerPlugin(ScrollTrigger);
    const media = gsap.matchMedia();
    media.add("(prefers-reduced-motion: no-preference)", () => {
      gsap.from(".results-heading", {
        y: 45,
        opacity: 0,
        ease: "none",
        scrollTrigger: {
          trigger: "#result",
          start: "top 95%",
          end: "top 45%",
          scrub: 0.65,
        },
      });
      gsap.utils
        .toArray<HTMLElement>(".rendered-seal")
        .forEach((seal, index) => {
          gsap.from(seal, {
            x: (index - 1.5) * 60,
            y: -60,
            ease: "none",
            scrollTrigger: {
              trigger: ".result-cards",
              start: "top bottom",
              end: "top 40%",
              scrub: 0.7,
            },
          });
        });
      gsap.from(".podium-art", {
        y: 170,
        ease: "none",
        scrollTrigger: {
          trigger: "#story",
          start: "top 90%",
          end: "top 15%",
          scrub: 0.8,
        },
      });
      gsap.from(".podium-seal", {
        y: -80,
        ease: "none",
        scrollTrigger: {
          trigger: "#story",
          start: "top 90%",
          end: "top 15%",
          scrub: 0.8,
        },
      });
      gsap.utils
        .toArray<HTMLElement>(
          ".limits-section .section-title, .verify-copy .section-title",
        )
        .forEach((element) => {
          gsap.from(element, {
            y: 28,
            opacity: 0,
            duration: 0.9,
            ease: "power3.out",
            scrollTrigger: { trigger: element, start: "top 90%", once: true },
          });
        });
    });
    return () => media.revert();
  }, []);
  return null;
}
