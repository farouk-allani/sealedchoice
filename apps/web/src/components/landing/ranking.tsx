import {
  DEMO_RANKING,
  DEMO_TENDER,
  bpToString,
  explorerTx,
  short,
  tokensToString,
} from "../../config/evidence.ts";

/**
 * The real result of tender 3, including the uncomfortable part: the bid that tried prompt
 * injection came last here, but on two earlier runs it came second. Both are shown.
 */
export function Ranking() {
  return (
    <section id="result" className="mx-auto max-w-5xl px-6 py-28 sm:px-10">
      <div className="flex items-center gap-3 font-mono text-[11px] uppercase tracking-[0.22em]">
        <span className="text-rim">Result</span>
        <span className="h-px w-8 bg-line-strong" />
        <span className="text-faint">Tender {DEMO_TENDER.id} · NEAR testnet</span>
      </div>

      <h2 className="mt-5 max-w-[22ch] text-balance text-act font-semibold">
        One evaluation, three bids, and the receipt for all of it.
      </h2>

      <div className="mt-12 overflow-hidden rounded-2xl border border-line bg-surface">
        {DEMO_RANKING.map((row) => (
          <div
            key={row.label}
            className="flex flex-wrap items-center gap-x-6 gap-y-3 border-b border-line px-5 py-5 last:border-b-0 sm:px-7"
          >
            <span className="w-7 shrink-0 font-mono text-sm text-faint">{row.rank}</span>

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2.5">
                <span className="text-[15px] font-medium">{row.label}</span>
                {row.outcome === "awarded" && (
                  <span className="rounded-full border border-pass/35 bg-pass/10 px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-pass">
                    Awarded
                  </span>
                )}
                {row.flagged && (
                  <span className="rounded-full border border-flag/35 bg-flag/10 px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-flag">
                    {row.flag}
                  </span>
                )}
              </div>
              <p className="mt-1 text-[13px] text-muted">{row.note}</p>
            </div>

            <div className="text-right">
              <div
                className={`font-mono text-xl tabular-nums ${row.flagged ? "text-flag" : "text-fg"}`}
              >
                {bpToString(row.totalBp)}
              </div>
              <div className="font-mono text-[10px] uppercase tracking-wider text-faint">
                {row.totalBp.toLocaleString("en-US")} bp
              </div>
            </div>
          </div>
        ))}
      </div>

      <p className="mt-4 text-[13px] text-faint">
        Totals are basis points from the accepted on-chain result — integer arithmetic, never a
        float, and never a model.
      </p>

      <dl className="mt-12 grid gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
        {[
          {
            term: "Evaluation",
            value: `${(DEMO_TENDER.evalMs / 1000).toFixed(1)} s`,
            note: "inside the TEE, of a 180 s ceiling",
          },
          {
            term: "On-chain result",
            value: `${DEMO_TENDER.resultBytes} bytes`,
            note: `accepted on attempt ${DEMO_TENDER.attempt}`,
          },
          {
            term: "Paid to the vendor",
            value: `${tokensToString(DEMO_TENDER.paidToVendor, DEMO_TENDER.tokenDecimals)} ${DEMO_TENDER.tokenSymbol}`,
            note: "its own sealed bid price",
          },
          {
            term: "Returned to the buyer",
            value: `${tokensToString(DEMO_TENDER.paidToBuyer, DEMO_TENDER.tokenDecimals)} ${DEMO_TENDER.tokenSymbol}`,
            note: "remainder, same transaction",
          },
        ].map((stat) => (
          <div key={stat.term} className="bg-surface px-6 py-7">
            <dt className="font-mono text-[10px] uppercase tracking-[0.18em] text-faint">
              {stat.term}
            </dt>
            <dd className="mt-3 font-mono text-lg tabular-nums text-fg">{stat.value}</dd>
            <dd className="mt-1.5 text-[12px] text-muted">{stat.note}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-8 flex flex-wrap gap-x-7 gap-y-3 font-mono text-[11px]">
        {[
          { label: "propose_award", hash: DEMO_TENDER.proposeAwardTx },
          { label: "accept_award", hash: DEMO_TENDER.acceptAwardTx },
        ].map((tx) => (
          <a
            key={tx.label}
            href={explorerTx(tx.hash)}
            target="_blank"
            rel="noreferrer"
            className="group flex items-center gap-2.5 text-faint transition-colors hover:text-fg"
          >
            <span className="uppercase tracking-wider">{tx.label}</span>
            <span className="text-steel-100 underline decoration-line-strong underline-offset-4 group-hover:decoration-rim">
              {short(tx.hash)}
            </span>
            <span aria-hidden="true">↗</span>
          </a>
        ))}
      </div>
    </section>
  );
}
