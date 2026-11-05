import type { Act } from "../../content/landing.ts";

/** The small mono facts under each act. Each one is backed by a value in config/evidence.ts. */
function Fact({ label, value, kind }: Act["facts"][number]) {
  const tone =
    kind === "pass" ? "text-pass" : kind === "flag" ? "text-flag" : "text-steel-100";
  return (
    <div className="flex items-baseline gap-3 border-t border-line py-2.5 font-mono text-[11px] tracking-wide">
      <span className="min-w-0 shrink-0 text-faint uppercase">{label}</span>
      <span className={`ml-auto text-right ${tone}`}>{value}</span>
    </div>
  );
}

export function ActPanel({ act, active, stacked = false }: { act: Act; active: boolean; stacked?: boolean }) {
  return (
    <article
      aria-hidden={!stacked && !active}
      className={
        stacked
          ? "border-t border-line py-16"
          : [
              "absolute inset-x-0 top-1/2 -translate-y-1/2",
              "transition-[opacity,transform] duration-700 ease-[cubic-bezier(0.16,1,0.3,1)]",
              active
                ? "pointer-events-auto translate-y-[-50%] opacity-100 blur-none"
                : "pointer-events-none translate-y-[-44%] opacity-0 blur-[3px]",
            ].join(" ")
      }
    >
      <div className="flex items-center gap-3 font-mono text-[11px] uppercase tracking-[0.22em]">
        <span className="text-rim">{act.index}</span>
        <span className="h-px w-8 bg-line-strong" />
        <span className="text-faint">{act.kicker}</span>
      </div>

      <h2 className="mt-4 max-w-[17ch] text-balance text-act font-semibold text-fg">{act.title}</h2>

      <p className="mt-5 max-w-[50ch] text-[14px] leading-relaxed text-muted sm:text-[15px]">{act.body}</p>

      <div className="mt-7 max-w-sm">
        {act.facts.map((fact) => (
          <Fact key={fact.label} {...fact} />
        ))}
      </div>
    </article>
  );
}
