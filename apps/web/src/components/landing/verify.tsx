import {
  CHAIN,
  DEMO_TENDER,
  EARLIER_CONTRACT_ID,
  PRIOR_RUNS,
  explorerAccount,
  outlayerRequest,
  short,
} from "../../config/evidence.ts";
import { VERIFY } from "../../content/landing.ts";
import { CopyCommand } from "./copy-command.tsx";

const CHECKS = [
  "Bundle hash and schema",
  "Frozen bid set and rubric",
  "Signed model call evidence",
  "Pinned evaluator attestation",
  "No plaintext in the public bundle",
];
export function Verify() {
  return (
    <section id="verify" className="verify-section section-shell">
      <div className="section-topline">
        <span className="eyebrow">04 / INDEPENDENT VERIFICATION</span>
        <span className="section-aside">THE RECORD IS OPEN.</span>
      </div>
      <div className="verify-grid">
        <div className="verify-copy">
          <p className="eyebrow is-pass">LESS TRUST. MORE PROOF.</p>
          <h2 className="section-title">
            Don’t take
            <br />
            <span>our word for it.</span>
          </h2>
          <p className="section-description">
            Inspect the contract, the evaluator and the recorded model calls.
            The result should stand up to more than a landing page.
          </p>
          <a
            className="button button-light"
            href={explorerAccount(CHAIN.tenderContract)}
            target="_blank"
            rel="noreferrer"
          >
            Open the contract <span>↗</span>
          </a>
          <div className="verify-build">
            <span>PINNED EVALUATOR BUILD</span>
            <code title={CHAIN.evaluatorBuild}>
              {short(CHAIN.evaluatorBuild, 14, 10)}
            </code>
          </div>
        </div>
        <div className="evidence-terminal">
          <div className="terminal-top">
            <span className="terminal-dots">
              <i />
              <i />
              <i />
            </span>
            <span>sealedchoice / evidence</span>
            <span>↗</span>
          </div>
          <div className="terminal-content">
            <div className="terminal-heading">
              <span>RECORDED DEMO / TENDER {DEMO_TENDER.id}</span>
              <span className="is-pass">COMPLETE</span>
            </div>
            <div className="terminal-total">
              {DEMO_TENDER.evidenceChecks}
              <span>/ {DEMO_TENDER.evidenceChecks}</span>
              <small>evidence checks passed</small>
            </div>
            <ul>
              {CHECKS.map((check) => (
                <li key={check}>
                  <span className="terminal-check">✓</span>
                  <span>{check}</span>
                  <span className="is-pass">PASS</span>
                </li>
              ))}
            </ul>
            <div className="terminal-meta">
              <span>
                Evaluation{" "}
                <strong>{(DEMO_TENDER.evalMs / 1000).toFixed(1)}s</strong>
              </span>
              <span>
                Signed calls{" "}
                <strong>
                  {DEMO_TENDER.modelCalls}/{DEMO_TENDER.modelCalls}
                </strong>
              </span>
              <span>
                Result <strong>{DEMO_TENDER.resultBytes} bytes</strong>
              </span>
            </div>
          </div>
          <div className="terminal-bottom">
            PUBLIC EVIDENCE. PRIVATE BID TEXT.
          </div>
        </div>
      </div>
      <div className="evidence-links">
        <span>INSPECT RECORDED EXECUTIONS</span>
        <a
          href={outlayerRequest(DEMO_TENDER.outlayerRequest)}
          target="_blank"
          rel="noreferrer"
        >
          Final tender {DEMO_TENDER.id} <span>OutLayer #{DEMO_TENDER.outlayerRequest} ↗</span>
        </a>
        {PRIOR_RUNS.filter((run) => run.request !== null).map((run) => (
          <a
            key={run.tender}
            href={outlayerRequest(run.request!)}
            target="_blank"
            rel="noreferrer"
          >
            Earlier tender {run.tender} <span>OutLayer #{run.request} ↗</span>
          </a>
        ))}
      </div>
      <details className="developer-command">
        <summary>
          For developers <span>+</span>
        </summary>
        <p>
          Run the same ten public checks against the final demo tender. Earlier
          executions above belong to the previous contract, {EARLIER_CONTRACT_ID}.
        </p>
        <CopyCommand command={VERIFY.command} />
      </details>
    </section>
  );
}
