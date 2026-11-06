import { LIMITS } from "../../content/landing.ts";
import { PRIOR_RUNS } from "../../config/evidence.ts";

export function Limits() {
  return (
    <section id="limits" className="limits-section section-shell">
      <div className="section-topline">
        <span className="eyebrow">03 / THE TRUST BOUNDARY</span>
        <span className="section-aside">TRANSPARENCY INCLUDES THE LIMITS.</span>
      </div>
      <div className="limits-grid">
        <div>
          <h2 className="section-title">
            Trust the evidence.
            <br />
            <span>Know the limits.</span>
          </h2>
          <p className="section-description">
            Confidentiality and verification have boundaries. Here are ours,
            with the measurements to back them up.
          </p>
          <a href="#verify" className="text-link">
            Check the evidence <span>↗</span>
          </a>
        </div>
        <div className="limit-accordions">
          {LIMITS.items.map((item, index) => (
            <details key={item.title} open={index === 0}>
              <summary>
                <span className="limit-index">0{index + 1}</span>
                <h3>{item.title}</h3>
                <span className="details-toggle" aria-hidden="true">
                  +
                </span>
              </summary>
              <div className="limit-body">
                <p>{item.body}</p>
                {index === 0 && (
                  <div className="run-comparison">
                    <div className="run-comparison-title">
                      BID A / THREE RECORDED RUNS
                    </div>
                    {PRIOR_RUNS.map((run) => (
                      <div key={run.tender}>
                        <span>Tender {run.tender}</span>
                        <div className="run-bar">
                          <i style={{ width: `${run.scores[0]! / 100}%` }} />
                        </div>
                        <strong>
                          {run.scores[0]!.toLocaleString("en-US")}{" "}
                          <small>bp</small>
                        </strong>
                      </div>
                    ))}
                    <p>Same rubric and bid text. Temperature 0, seed 1.</p>
                  </div>
                )}
              </div>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
