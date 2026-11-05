import { LIMITS } from "../../content/landing.ts";
import { PRIOR_RUNS } from "../../config/evidence.ts";

/**
 * The section a technical reader checks the rest of the page against. It exists because a
 * reviewer who finds an unstated limit stops believing everything above it.
 */
export function Limits() {
  return (
    <section id="limits" className="border-y border-line bg-surface/40">
      <div className="mx-auto max-w-5xl px-6 py-28 sm:px-10">
        <div className="flex items-center gap-3 font-mono text-[11px] uppercase tracking-[0.22em]">
          <span className="text-flag">Limits</span>
          <span className="h-px w-8 bg-line-strong" />
          <span className="text-faint">Stated, not buried</span>
        </div>

        <h2 className="mt-5 max-w-[20ch] text-balance text-act font-semibold">{LIMITS.title}</h2>
        <p className="mt-6 max-w-[58ch] text-[15px] leading-relaxed text-muted">{LIMITS.lead}</p>

        <div className="mt-14 grid gap-px overflow-hidden rounded-2xl border border-line bg-line lg:grid-cols-3">
          {LIMITS.items.map((item, i) => (
            <div key={item.title} className="flex flex-col bg-ink px-7 py-8">
              <span className="font-mono text-[11px] text-faint">0{i + 1}</span>
              <h3 className="mt-4 text-[17px] font-medium leading-snug text-fg">{item.title}</h3>
              <p className="mt-4 text-[13px] leading-relaxed text-muted">{item.body}</p>
            </div>
          ))}
        </div>

        {/* The measurement behind limit 01, shown rather than described. */}
        <figure className="mt-10 overflow-hidden rounded-2xl border border-line bg-ink">
          <figcaption className="border-b border-line px-6 py-4 font-mono text-[11px] uppercase tracking-wider text-faint">
            Same rubric, same bid text, temperature 0, seed 1 — three real runs
          </figcaption>
          <table className="w-full text-left font-mono text-[13px] tabular-nums">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-faint">
                <th scope="col" className="px-6 py-3 font-normal">Run</th>
                <th scope="col" className="px-6 py-3 font-normal">Bid A · honest</th>
                <th scope="col" className="px-6 py-3 font-normal">Bid B · weak</th>
                <th scope="col" className="px-6 py-3 font-normal">Bid C · injection</th>
              </tr>
            </thead>
            <tbody>
              {PRIOR_RUNS.map((run) => (
                <tr key={run.tender} className="border-t border-line">
                  <td className="px-6 py-3.5 text-faint">Tender {run.tender}</td>
                  <td className="px-6 py-3.5 text-pass">{run.scores[0]!.toLocaleString("en-US")}</td>
                  <td className="px-6 py-3.5 text-steel-100">{run.scores[1]!.toLocaleString("en-US")}</td>
                  <td className="px-6 py-3.5 text-flag">{run.scores[2]!.toLocaleString("en-US")}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="border-t border-line px-6 py-4 text-[13px] leading-relaxed text-muted">
            On the third run the injection bid dropped below the weak bid, so second and third
            place swapped. What held every time is what is actually claimed: the honest bid won,
            and the injection bid was flagged by code — whatever the models scored it.
          </p>
        </figure>
      </div>
    </section>
  );
}
