"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { loadEvidence, runChecks, summarise } from "@tender/verify";
import type { CheckResult } from "@tender/verify";
import { CONTRACT_ID, NETWORK, RPC_URL } from "../../config/demo.ts";
import { CHAIN } from "../../config/evidence.ts";
import { Icon } from "../ui/icon.tsx";

/**
 * Runs the ten public checks in the reader's own browser.
 *
 * It matters that this runs here and not on our server: the point of the checklist is that nobody
 * has to trust SealedChoice. The page fetches the chain, the bundle store and the published
 * evaluator artifact directly, then calls exactly the functions `pnpm verify` calls, so the two
 * cannot drift (docs/06-evidence-and-verification.md).
 */

type Stage = "loading" | "done" | "error";

const FIRST_STEP = "Reading the tender, the bids and the result from the chain";
/** Ten placeholders, so the list does not jump in height when the results land. */
const PENDING_ROWS: null[] = Array.from({ length: 10 }, () => null);

const EXPLORER = NETWORK === "mainnet" ? "https://nearblocks.io" : "https://testnet.nearblocks.io";

function verdict(r: CheckResult): { label: string; tone: string } {
  if (r.pass) return { label: "Pass", tone: "pass" };
  if (r.skipped) return { label: "Not checked", tone: "skip" };
  return { label: "Fail", tone: "fail" };
}

export function VerifyPanel({ tenderId }: { tenderId: number }) {
  // Mount already shows the first stage, so the effect below changes no state synchronously.
  const [stage, setStage] = useState<Stage>("loading");
  const [step, setStep] = useState(FIRST_STEP);
  const [results, setResults] = useState<CheckResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ms, setMs] = useState<number | null>(null);
  // Which run owns the state. Bumping it abandons whatever is in flight, which matters because a
  // run downloads about 3 MB: StrictMode mounts effects twice in development, and a reader can
  // press "Run again" while the first pass is still fetching.
  const runId = useRef(0);

  const run = useCallback(async (isRerun: boolean) => {
    const id = runId.current + 1;
    runId.current = id;
    const current = () => runId.current === id;
    if (isRerun) {
      setStage("loading");
      setError(null);
      setResults(null);
      setMs(null);
      setStep(FIRST_STEP);
    }
    const started = Date.now();
    try {
      const { evidence, artifact } = await loadEvidence({
        contractId: CONTRACT_ID,
        tenderId,
        rpcUrl: RPC_URL,
        bundleStoreUrl: CHAIN.bundleStore,
        explorerBase: EXPLORER,
        network: NETWORK,
        fetchArtifact: true,
      });
      if (!current()) return;
      setStep("Running the ten checks");
      const out = runChecks(evidence, artifact);
      if (!current()) return;
      setResults(out);
      setMs(Date.now() - started);
      setStage("done");
    } catch (e) {
      if (!current()) return;
      setError(e instanceof Error ? e.message : String(e));
      setStage("error");
    }
  }, [tenderId]);

  // Start as soon as the page is interactive: a reader who opened this page has already asked.
  // Deferred to a task so mounting never sets state synchronously, and cancelled on unmount.
  useEffect(() => {
    const timer = setTimeout(() => void run(false), 0);
    return () => {
      clearTimeout(timer);
      runId.current += 1;
    };
  }, [run]);

  const summary = results ? summarise(results) : null;

  return (
    <section className="verify-panel" aria-labelledby="verify-heading">
      <div className="verify-head">
        <div>
          <h2 id="verify-heading">The ten public checks</h2>
          <p className="verify-lead">
            These run in your browser, against the chain, the bundle store and the published
            evaluator build. <code>pnpm verify --tender {tenderId}</code> runs the same code and
            prints the same answers.
          </p>
        </div>
        <button type="button" className="ui-button" onClick={() => void run(true)} disabled={stage === "loading"}>
          {stage === "loading" ? "Checking" : "Run again"}
        </button>
      </div>

      <p className="verify-status" role="status" aria-live="polite">
        {stage === "loading" && `${step}...`}
        {stage === "error" && `The checks could not run: ${error}`}
        {stage === "done" && summary
          ? `${summary.passed} of ${summary.total} checks passed${summary.skipped > 0 ? `, ${summary.skipped} not checked` : ""}${ms === null ? "" : ` in ${(ms / 1000).toFixed(1)}s`}.`
          : null}
      </p>

      {/* A failure and a skip are different claims, so they do not share a banner. A failure says
          the evidence contradicts itself and is worth an alert; a skip says this evidence cannot
          settle that question, which is a note. */}
      {stage === "done" && summary && summary.failed > 0 ? (
        <p className="verify-warning" role="alert">
          {summary.failed === 1 ? "One check failed" : `${summary.failed} checks failed`}. Each line
          below says what was compared, so you can look at the same values yourself.
        </p>
      ) : null}

      {stage === "done" && summary && summary.failed === 0 && summary.skipped > 0 ? (
        <p className="verify-note">
          Every check that could run passed.{" "}
          {summary.skipped === 1 ? "One check" : `${summary.skipped} checks`} could not be settled
          from this evidence, and each says below what would settle it.
        </p>
      ) : null}

      <ol className="verify-list">
        {(results ?? PENDING_ROWS).map((r, i) => {
          if (r === null) {
            return (
              <li key={`pending-${String(i)}`} className="verify-item is-pending">
                <span className="verify-number">{String(i + 1).padStart(2, "0")}</span>
                <span className="verify-body">
                  <span className="verify-name">Waiting</span>
                </span>
              </li>
            );
          }
          const v = verdict(r);
          return (
            <li key={r.id} className={`verify-item is-${v.tone}`}>
              <span className="verify-number">{String(r.id).padStart(2, "0")}</span>
              <span className="verify-body">
                <span className="verify-name">{r.name}</span>
                <span className="verify-detail">{r.details}</span>
                {r.links.length > 0 ? (
                  <span className="verify-links">
                    {r.links.map((l) => (
                      <a key={l.href} href={l.href} target="_blank" rel="noreferrer noopener">
                        {l.label}
                        <Icon name="external" size={14} />
                      </a>
                    ))}
                  </span>
                ) : null}
              </span>
              <span className={`verify-verdict is-${v.tone}`}>{v.label}</span>
            </li>
          );
        })}
      </ol>

      <p className="verify-foot">
        What these checks do not cover is in the trust boundaries: the rubric can favour a
        supplier, a model score is not reproducible run to run, and the bundle store can withhold
        a bundle though it cannot alter one.
      </p>
    </section>
  );
}
