import { VERIFY } from "../../content/landing.ts";
import { CHAIN, DEMO_TENDER, PRIOR_RUNS, explorerTx, outlayerRequest, short } from "../../config/evidence.ts";
import { CopyCommand } from "./copy-command.tsx";

/** Checks the verifier actually makes, named individually (D-032). */
const CHECKS = [
  "The stored bundle's bytes hash to the result's bundle field.",
  "The bundle validates against evidence-bundle.schema.json.",
  "The result echoes the frozen Merkle root and the rubric hash.",
  "Every model call carries a provider_tee signature over its own request and response bytes.",
  "The attestation's executed_wasm_sha256 equals the evaluator build pinned on the contract.",
  "The public bundle contains no bid text.",
  "Every bidder's debrief and every committee copy opens with its own key.",
] as const;

export function Verify() {
  return (
    <section id="verify" className="mx-auto max-w-5xl px-6 py-28 sm:px-10">
      <div className="flex items-center gap-3 font-mono text-[11px] uppercase tracking-[0.22em]">
        <span className="text-pass">{VERIFY.kicker}</span>
        <span className="h-px w-8 bg-line-strong" />
        <span className="text-faint">Nothing here needs trusting</span>
      </div>

      <h2 className="mt-5 max-w-[20ch] text-balance text-act font-semibold">{VERIFY.title}</h2>
      <p className="mt-6 max-w-[58ch] text-[15px] leading-relaxed text-muted">{VERIFY.lead}</p>

      <div className="mt-14 grid gap-10 lg:grid-cols-[1.1fr_0.9fr]">
        <div>
          <h3 className="font-mono text-[11px] uppercase tracking-[0.18em] text-faint">
            {DEMO_TENDER.evidenceChecks} checks against a tender&apos;s own evidence — among them
          </h3>
          <ul className="mt-5 space-y-3.5">
            {CHECKS.map((check) => (
              <li key={check} className="flex gap-3.5 text-[14px] leading-relaxed text-muted">
                <span aria-hidden="true" className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-pass" />
                <span>{check}</span>
              </li>
            ))}
          </ul>

          <div className="mt-9">
            <CopyCommand command={VERIFY.command} />
            <p className="mt-3 text-[12px] text-faint">
              The same checks run in the browser on each tender&apos;s verify page.
            </p>
          </div>
        </div>

        <div className="rounded-2xl border border-line bg-surface p-7">
          <h3 className="font-mono text-[11px] uppercase tracking-[0.18em] text-faint">
            Live right now
          </h3>

          <dl className="mt-6 space-y-4 font-mono text-[12px]">
            {[
              { term: "Tender contract", value: CHAIN.tenderContract },
              { term: "Code hash", value: short(CHAIN.codeHash, 10, 6) },
              { term: "Evaluator build", value: short(CHAIN.evaluatorBuild, 10, 6) },
              { term: "Escrow token", value: `${CHAIN.tokenContract} · ${DEMO_TENDER.tokenSymbol}` },
              { term: "Gas, whole tender", value: `${DEMO_TENDER.tgas} TGas` },
            ].map((row) => (
              <div key={row.term} className="flex items-baseline justify-between gap-4 border-b border-line pb-3.5">
                <dt className="shrink-0 uppercase tracking-wider text-faint">{row.term}</dt>
                <dd className="min-w-0 truncate text-right text-steel-100">{row.value}</dd>
              </div>
            ))}
          </dl>

          <h3 className="mt-8 font-mono text-[11px] uppercase tracking-[0.18em] text-faint">
            Evaluations in the TEE
          </h3>
          <ul className="mt-4 space-y-2.5 font-mono text-[12px]">
            {PRIOR_RUNS.filter((run) => run.request !== null).map((run) => (
              <li key={run.tender} className="flex items-center justify-between gap-3">
                <span className="text-faint">Tender {run.tender}</span>
                <span className="flex items-center gap-3">
                  <a
                    href={outlayerRequest(run.request!)}
                    target="_blank"
                    rel="noreferrer"
                    className="text-steel-100 underline decoration-line-strong underline-offset-4 hover:decoration-rim"
                  >
                    request {run.request}
                  </a>
                  <a
                    href={explorerTx(run.closeTx!)}
                    target="_blank"
                    rel="noreferrer"
                    className="text-steel-100 underline decoration-line-strong underline-offset-4 hover:decoration-rim"
                  >
                    {short(run.closeTx!, 6, 4)} ↗
                  </a>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
