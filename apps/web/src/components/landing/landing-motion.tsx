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
        .toArray<HTMLElement>(".result-art img")
        .forEach((art) => {
          gsap.from(art, {
            y: 18,
            ease: "none",
            scrollTrigger: {
              trigger: ".result-cards",
              start: "top bottom",
              end: "top 40%",
              scrub: 0.7,
            },
          });
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

      const accordions = gsap.utils
        .toArray<HTMLDetailsElement>(".limit-accordions details")
        .map((details) => {
          const summary = details.querySelector("summary")!;
          const panel = details.querySelector<HTMLElement>(".limit-panel")!;
          let expanded = details.open;
          let animation: gsap.core.Tween | undefined;

          const toggle = (event: MouseEvent) => {
            event.preventDefault();
            const height = details.open ? panel.getBoundingClientRect().height : 0;
            const opacity = details.open ? gsap.getProperty(panel, "opacity") : 0;
            animation?.kill();
            expanded = !expanded;
            details.dataset.expanded = String(expanded);
            // Keep native details open until the closing animation finishes.
            details.open = true;
            animation = gsap.fromTo(
              panel,
              { height, opacity },
              {
                height: expanded ? "auto" : 0,
                opacity: expanded ? 1 : 0,
                duration: 0.4,
                ease: "power3.out",
                onComplete: () => {
                  details.open = expanded;
                  gsap.set(panel, { clearProps: "height,opacity" });
                  ScrollTrigger.refresh();
                },
              },
            );
          };

          summary.addEventListener("click", toggle);
          return () => {
            summary.removeEventListener("click", toggle);
            animation?.kill();
            details.open = expanded;
            delete details.dataset.expanded;
            gsap.set(panel, { clearProps: "height,opacity" });
          };
        });

      return () => accordions.forEach((cleanup) => cleanup());
    });
    return () => media.revert();
  }, []);
  return null;
}
