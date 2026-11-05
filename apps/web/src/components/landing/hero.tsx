import { HERO } from "../../content/landing.ts";
import { CHAIN, DEMO_TENDER, explorerAccount } from "../../config/evidence.ts";
import { HeroVault } from "./hero-vault.tsx";

export function Hero() {
  return (
    <header className="relative isolate flex min-h-screen flex-col justify-center overflow-hidden px-6 pb-28 pt-28 sm:px-10">
      {/* The door, shut. In iteration 3 this and the story share one canvas so it never cuts. */}
      <HeroVault />

      {/*
        Two scrims, not one. The inner one darkens just the band the headline sits in so white
        type stays legible over steel; the outer one sinks the vault into the page edges.
      */}
      <div
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background:
            "radial-gradient(ellipse 58% 40% at 50% 42%, rgba(7,8,10,0.78) 0%, rgba(7,8,10,0.35) 55%, transparent 78%)",
        }}
      />
      <div
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background:
            "radial-gradient(ellipse 72% 72% at 50% 46%, transparent 42%, rgba(7,8,10,0.82) 82%, var(--color-ink) 100%)",
        }}
      />

      <div className="relative mx-auto w-full max-w-5xl text-center">
        <h1 className="text-display font-semibold text-fg">
          {HERO.lines.map((line, i) => (
            <span key={line} className={i === HERO.lines.length - 1 ? "block text-steel-100" : "block"}>
              {line}
            </span>
          ))}
        </h1>

        <p className="mx-auto mt-7 max-w-[58ch] text-balance text-[15px] leading-relaxed text-muted sm:text-base">
          {HERO.lead}
        </p>

        <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
          <a
            href={HERO.primary.href}
            className="rounded-full bg-fg px-7 py-3.5 text-sm font-medium text-ink transition-colors hover:bg-white"
          >
            {HERO.primary.label}
          </a>
          <a
            href={HERO.secondary.href}
            className="edge rounded-full px-7 py-3.5 text-sm font-medium text-fg transition-colors hover:border-line-strong hover:bg-raised"
          >
            {HERO.secondary.label}
          </a>
        </div>

        <div className="mt-12 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 font-mono text-[11px] tracking-wide text-faint">
          <span className="flex items-center gap-2">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-pass opacity-60" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-pass" />
            </span>
            Live on NEAR {CHAIN.network}
          </span>
          <a
            href={explorerAccount(CHAIN.tenderContract)}
            target="_blank"
            rel="noreferrer"
            className="underline decoration-line-strong underline-offset-4 transition-colors hover:text-steel-100"
          >
            {CHAIN.tenderContract} ↗
          </a>
          <span>{DEMO_TENDER.evidenceChecks} of {DEMO_TENDER.evidenceChecks} evidence checks pass</span>
        </div>
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-8 flex justify-center">
        <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-faint">
          {HERO.scrollHint}
        </span>
      </div>
    </header>
  );
}
