import Image from "next/image";
import {
  CHAIN,
  DEMO_RANKING,
  DEMO_TENDER,
  bpToString,
  explorerTx,
  tokensToString,
} from "../../config/evidence.ts";

// Switch to "studio" to restore the original brighter renders and card lighting.
const RESULT_ARTWORK: "studio" | "vault" = "vault";
const artworkSource = (asset: string) =>
  `/visuals/blender/result-${asset}${{ studio: "", vault: "-vault" }[RESULT_ARTWORK]}-poster.webp`;

export function Ranking() {
  return (
    <section id="result" className="results-section section-shell">
      <header className="results-heading">
        <h2 className="section-title">Every bid. On the record.</h2>
        <p>A completed confidential tender on NEAR {CHAIN.network}.</p>
      </header>
      <div className="result-cards" data-artwork={RESULT_ARTWORK}>
        {DEMO_RANKING.map((row) => (
          <article
            className={`result-card result-card-${row.outcome}`}
            key={row.label}
          >
            <div className="result-art" aria-hidden="true">
              <Image
                src={artworkSource(row.outcome === "awarded" ? "award" : row.outcome)}
                alt=""
                width={960}
                height={816}
                sizes="(max-width: 760px) 50vw, 25vw"
                unoptimized
              />
            </div>
            <div
              className={`result-status ${row.flagged ? "is-flag" : "is-pass"}`}
            >
              <strong>{bpToString(row.totalBp)}</strong>
              <span>
                {row.outcome === "awarded"
                  ? "AWARDED"
                  : row.flagged
                    ? "FLAGGED"
                    : "RANKED"}
              </span>
            </div>
            <h3>
              {row.label}
              <span>
                {row.outcome === "awarded"
                  ? "Committee selection"
                  : row.flagged
                    ? "Injection suspected"
                    : "Evaluation recorded"}
              </span>
            </h3>
            <p>{row.note}</p>
          </article>
        ))}
        <a className="result-card audit-card" href="#verify">
          <div className="result-art" aria-hidden="true">
            <Image
              src={artworkSource("evidence")}
              alt=""
              width={960}
              height={816}
              sizes="(max-width: 760px) 50vw, 25vw"
              unoptimized
            />
          </div>
          <div className="result-status is-pass">
            <strong>
              {DEMO_TENDER.evidenceChecks}/{DEMO_TENDER.evidenceChecks}
            </strong>
            <span>PASS</span>
          </div>
          <h3>
            OutLayer<span>TEE evidence checks</span>
          </h3>
          <p>
            Inspect the recorded attestation, inputs and model calls. &#8599;
          </p>
        </a>
      </div>
      <div className="result-receipt">
        <p>
          <strong>
            {tokensToString(
              DEMO_TENDER.paidToVendor,
              DEMO_TENDER.tokenDecimals,
            )}{" "}
            {DEMO_TENDER.tokenSymbol}
          </strong>{" "}
          paid to the awarded supplier.
          <br />
          <span>
            {tokensToString(DEMO_TENDER.paidToBuyer, DEMO_TENDER.tokenDecimals)}{" "}
            {DEMO_TENDER.tokenSymbol} returned to the buyer.
          </span>
        </p>
        <a
          className="text-link"
          href={explorerTx(DEMO_TENDER.acceptAwardTx)}
          target="_blank"
          rel="noreferrer"
        >
          View the settlement &#8599;
        </a>
      </div>
      <p className="results-note">
        Recorded demonstration, tender {DEMO_TENDER.id}. Model scores vary
        between runs. <a href="#limits">See the measured limits.</a>
      </p>
    </section>
  );
}
