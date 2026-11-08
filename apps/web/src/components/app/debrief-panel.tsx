"use client";

import { useCallback, useRef, useState } from "react";
import {
  DebriefError,
  explainFlags,
  loadEvidence,
  openDebrief,
  runDebriefChecks,
  summarise,
} from "@tender/verify";
import type { CheckResult, OpenedDebrief } from "@tender/verify";
import { utf8ToBytes } from "@tender/crypto";
import { formatBp } from "../../lib/tender/format.ts";
import { CONTRACT_ID, NETWORK, RPC_URL } from "../../config/demo.ts";
import { CHAIN } from "../../config/evidence.ts";
import { deriveReaderKeyFromWallet } from "../../lib/wallet/reader-key.ts";
import { useWallet } from "../../lib/wallet/wallet-provider.tsx";
import { Button } from "../ui/button.tsx";
import { TextAreaField } from "../ui/field.tsx";
import { Icon } from "../ui/icon.tsx";

/**
 * A bidder's own debrief, opened in their browser with a key only their wallet can derive.
 *
 * Nothing here is taken on trust from this site: the envelope is decrypted locally, and the five
 * checks of docs/06 are run by `@tender/verify`, the same code `pnpm verify` runs. The private key
 * is wiped as soon as the envelope is open, because it is only ever needed once.
 */

const EXPLORER = NETWORK === "mainnet" ? "https://nearblocks.io" : "https://testnet.nearblocks.io";

type Stage = "idle" | "working" | "open" | "error";

function verdict(r: CheckResult): { label: string; tone: string } {
  if (r.pass) return { label: "Pass", tone: "pass" };
  if (r.skipped) return { label: "Not checked", tone: "skip" };
  return { label: "Fail", tone: "fail" };
}

export function DebriefPanel({ tenderId }: { tenderId: number }) {
  const wallet = useWallet();
  const [stage, setStage] = useState<Stage>("idle");
  const [step, setStep] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [opened, setOpened] = useState<OpenedDebrief | null>(null);
  const [proposal, setProposal] = useState("");
  const [showPaste, setShowPaste] = useState(false);
  const runId = useRef(0);

  const open = useCallback(
    async () => {
      const id = runId.current + 1;
      runId.current = id;
      const current = () => runId.current === id;
      setStage("working");
      setError(null);
      try {
        setStep("Asking your wallet to sign the key derivation");
        const key = await deriveReaderKeyFromWallet(wallet.signMessage, {
          purpose: "debrief",
          contractId: CONTRACT_ID,
          tenderId: String(tenderId),
          accountId: wallet.accountId ?? "",
        });
        if (!current()) return;
        setStep("Reading the chain and the evidence bundle");
        const { evidence } = await loadEvidence({
          contractId: CONTRACT_ID,
          tenderId,
          rpcUrl: RPC_URL,
          bundleStoreUrl: CHAIN.bundleStore,
          explorerBase: EXPLORER,
          network: NETWORK,
          fetchArtifact: false,
        });
        if (!current()) {
          key.secretKey.fill(0);
          return;
        }
        setStep("Opening your envelope and running the checks");
        try {
          const result = openDebrief({
            evidence,
            secretKey: key.secretKey,
          });
          if (!current()) return;
          setOpened(result);
          setStage("open");
        } finally {
          // The key is needed once. Keeping it in memory after that is a liability and no help.
          key.secretKey.fill(0);
        }
      } catch (e) {
        if (!current()) return;
        setError(e instanceof DebriefError || e instanceof Error ? e.message : String(e));
        setStage("error");
      }
    },
    [tenderId, wallet.signMessage, wallet.accountId],
  );

  // Re-running the checks needs no wallet: the envelope is already open, and the only thing that
  // changed is the text to check the quotes against. Asking for a second signature to do local
  // arithmetic would train a reader to approve signatures without reading them.
  const recompute = useCallback(() => {
    setOpened((prev) =>
      prev === null
        ? prev
        : (() => {
            const input = { ...prev.input, proposalPlaintext: utf8ToBytes(proposal) };
            return { ...prev, input, results: runDebriefChecks(input) };
          })(),
    );
  }, [proposal]);

  if (wallet.status !== "connected") {
    return (
      <section className="verify-panel" aria-labelledby="debrief-heading">
        <h2 id="debrief-heading">Your debrief</h2>
        <p className="verify-lead">
          Connect the wallet that submitted the bid. Your debrief is encrypted to a key only that
          account can derive, so no one else can open it, including us.
        </p>
      </section>
    );
  }

  const summary = opened ? summarise(opened.results) : null;

  return (
    <section className="verify-panel" aria-labelledby="debrief-heading">
      <div className="verify-head">
        <div>
          <h2 id="debrief-heading">Your debrief</h2>
          <p className="verify-lead">
            Signing derives your reader key in this page. The key opens your envelope and is then
            wiped. It is never sent anywhere.
          </p>
        </div>
        <Button onClick={() => void open()} disabled={stage === "working"}>
          {stage === "working" ? "Working" : opened ? "Open again" : "Open my debrief"}
        </Button>
      </div>

      <p className="verify-status" role="status" aria-live="polite">
        {stage === "working" && `${step}...`}
        {stage === "error" && `Could not open your debrief: ${error}`}
        {stage === "open" && summary
          ? `${summary.passed} of ${summary.total} checks passed${summary.skipped > 0 ? `, ${summary.skipped} not checked` : ""}.`
          : null}
      </p>

      {opened ? <Result opened={opened} /> : null}

      {opened ? (
        <div className="debrief-paste">
          <button
            type="button"
            className="ui-button ui-button--quiet"
            onClick={() => {
              setShowPaste((v) => !v);
            }}
            aria-expanded={showPaste}
          >
            <Icon name="arrow" />
            {showPaste ? "Hide" : "Recompute my score from my own proposal"}
          </button>
          {showPaste ? (
            <>
              <p className="verify-detail">
                Your bid is sealed to the tender key, which exists only inside the TEE, so not even
                you can recover its text from the chain. Paste the proposal you submitted and the
                page will re-run the scoring rules over the model answers in your debrief.
              </p>
              <TextAreaField
                label="Your proposal, as you submitted it"
                rows={6}
                value={proposal}
                placeholder={'{"methodology": "...", "track_record": "..."}'}
                hint="It stays in this page. Nothing here is uploaded."
                onChange={(ev) => {
                  setProposal(ev.target.value);
                }}
              />
              <Button
                variant="secondary"
                onClick={recompute}
                disabled={opened === null || proposal.trim() === ""}
              >
                Recompute
              </Button>
            </>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function Result({ opened }: { opened: OpenedDebrief }) {
  const d = opened.debrief;
  const flags = explainFlags(d.flags);
  return (
    <>
      <dl className="debrief-summary">
        <div>
          <dt>Rank</dt>
          <dd>
            {d.rank} of {d.of}
          </dd>
        </div>
        <div>
          <dt>Score</dt>
          <dd>{formatBp(d.total_bp)}</dd>
        </div>
        <div>
          <dt>Eligible</dt>
          <dd>{d.eligible ? "Yes" : "No"}</dd>
        </div>
      </dl>

      {!d.eligible && d.ineligible_reasons !== undefined && d.ineligible_reasons.length > 0 ? (
        <div className="verify-warning" role="note">
          Code refused this bid before anything was scored: {d.ineligible_reasons.join(", ")}.
        </div>
      ) : null}

      {flags.length > 0 ? (
        <div className="debrief-flags">
          <h3>What was flagged</h3>
          {flags.map((f) => (
            <div key={f.label} className="debrief-flag">
              <span className="debrief-flag-label">{f.label}</span>
              <span className="verify-detail">{f.meaning}</span>
            </div>
          ))}
        </div>
      ) : null}

      <h3>Score by criterion</h3>
      <ul className="debrief-criteria">
        {Object.entries(d.criteria as Record<string, unknown>).map(([id, raw]) => {
          const c = raw as { bp?: number; median?: number | null; models?: unknown[] };
          const models = Array.isArray(c.models) ? c.models : [];
          return (
            <li key={id} className="debrief-criterion">
              <div className="debrief-criterion-head">
                <span className="verify-name">{id}</span>
                <span className="debrief-bp">{formatBp(c.bp ?? 0)}</span>
              </div>
              {models.length > 0 ? (
                <table className="debrief-models">
                  <thead>
                    <tr>
                      <th scope="col">Model</th>
                      <th scope="col">Said</th>
                      <th scope="col">Counted</th>
                      <th scope="col">Quotes that matched</th>
                    </tr>
                  </thead>
                  <tbody>
                    {models.map((m, i) => {
                      const d2 = m as {
                        model: number;
                        valid: boolean;
                        raw?: number;
                        score?: number;
                        valid_quotes?: number;
                        clamped?: boolean;
                      };
                      return (
                        <tr key={`${id}-${String(i)}`}>
                          <td>Model {d2.model + 1}</td>
                          <td>{d2.valid ? (d2.raw ?? "") : "no usable answer"}</td>
                          <td>
                            {d2.valid ? (d2.score ?? "") : "-"}
                            {d2.clamped === true ? " (capped)" : ""}
                          </td>
                          <td>{d2.valid ? (d2.valid_quotes ?? 0) : "-"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              ) : (
                <p className="verify-detail">Scored by code from your own numbers, not by a model.</p>
              )}
            </li>
          );
        })}
      </ul>

      <h3>What you can check for yourself</h3>
      <ol className="verify-list">
        {opened.results.map((r) => {
          const v = verdict(r);
          return (
            <li key={r.id} className={`verify-item is-${v.tone}`}>
              <span className="verify-number">{String(r.id).padStart(2, "0")}</span>
              <span className="verify-body">
                <span className="verify-name">{r.name}</span>
                <span className="verify-detail">{r.details}</span>
              </span>
              <span className={`verify-verdict is-${v.tone}`}>{v.label}</span>
            </li>
          );
        })}
      </ol>
    </>
  );
}
