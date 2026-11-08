"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import {
  CommitteeError,
  MIN_DEVIATION_RATIONALE_CHARS,
  checkAward,
  explainFlags,
  loadEvidence,
  openCommitteeReport,
} from "@tender/verify";
import type { CommitteeBid, CommitteeReport } from "@tender/verify";
import { CONTRACT_ID, NETWORK, RPC_URL, TOKEN_DECIMALS, TOKEN_SYMBOL } from "../../config/demo.ts";
import { CHAIN } from "../../config/evidence.ts";
import { deriveReaderKeyFromWallet } from "../../lib/wallet/reader-key.ts";
import { TGAS, useWallet } from "../../lib/wallet/wallet-provider.tsx";
import { formatBp, formatUnits, plainUnits, unitsToMinor } from "../../lib/tender/format.ts";
import { Button } from "../ui/button.tsx";
import { TextAreaField, TextField } from "../ui/field.tsx";

/**
 * The committee's view: every proposal in the open, and the one decision code will not make.
 *
 * The report is decrypted here, with a key only a member's wallet can derive. The award form
 * decides "is this a deviation?" with `checkAward`, which is a port of the rule `propose_award`
 * applies, so the form never asks for a rationale the contract will not want, nor lets one be
 * omitted that it will demand.
 */

const EXPLORER = NETWORK === "mainnet" ? "https://nearblocks.io" : "https://testnet.nearblocks.io";

type Stage = "idle" | "working" | "open" | "error";

export interface CommitteePanelProps {
  tenderId: number;
  /** Budget cap in minor units, as a decimal string. */
  budgetCapMinor: string;
  /** Bid indices that already lapsed, from the award on chain. */
  lapsed: number[];
  /** Whether the tender is still in a state that accepts a proposal. */
  canPropose: boolean;
  /** The pending proposal, if one is already on chain. */
  pending: { bidIndex: number | null; amountMinor: string; rationale: string; approvals: string[] } | null;
  approvalsRequired: number;
}

export function CommitteePanel(props: CommitteePanelProps) {
  const wallet = useWallet();
  const [stage, setStage] = useState<Stage>("idle");
  const [step, setStep] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<CommitteeReport | null>(null);
  const [chosen, setChosen] = useState<number | null>(null);
  const [amount, setAmount] = useState("");
  const [rationale, setRationale] = useState("");
  const [sent, setSent] = useState<{ what: string; hash: string } | null>(null);
  const [sending, setSending] = useState(false);
  const runId = useRef(0);

  const capMinor = BigInt(props.budgetCapMinor);

  const open = useCallback(async () => {
    const id = runId.current + 1;
    runId.current = id;
    const current = () => runId.current === id;
    setStage("working");
    setError(null);
    try {
      setStep("Asking your wallet to sign the key derivation");
      const key = await deriveReaderKeyFromWallet(wallet.signMessage, {
        purpose: "committee",
        contractId: CONTRACT_ID,
        tenderId: String(props.tenderId),
        accountId: wallet.accountId ?? "",
      });
      if (!current()) {
        key.secretKey.fill(0);
        return;
      }
      setStep("Reading the chain and the evidence bundle");
      const { evidence } = await loadEvidence({
        contractId: CONTRACT_ID,
        tenderId: props.tenderId,
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
      setStep("Opening the report");
      try {
        const opened = await openCommitteeReport({
          evidence,
          secretKey: key.secretKey,
          lapsed: props.lapsed,
        });
        if (!current()) return;
        setReport(opened);
        const pick = props.pending?.bidIndex ?? opened.recommended;
        setChosen(pick);
        setAmount(defaultAmount(opened, pick, props.pending?.amountMinor));
        setRationale(props.pending?.rationale ?? "");
        setStage("open");
      } finally {
        key.secretKey.fill(0);
      }
    } catch (e) {
      if (!current()) return;
      setError(e instanceof CommitteeError || e instanceof Error ? e.message : String(e));
      setStage("error");
    }
  }, [props.tenderId, props.lapsed, props.pending, wallet.signMessage, wallet.accountId]);

  const amountMinor = useMemo(() => {
    try {
      return amount.trim() === "" ? 0n : unitsToMinor(amount, TOKEN_DECIMALS);
    } catch {
      return -1n;
    }
  }, [amount]);

  const check = useMemo(() => {
    if (report === null || chosen === null) return null;
    if (amountMinor < 0n) return { deviation: false, errors: ["That amount is not a number."] };
    return checkAward(
      { bidIndex: chosen, amountMinor, rationale },
      { ranking: report.ranking, budgetCapMinor: capMinor, lapsed: props.lapsed },
    );
  }, [report, chosen, amountMinor, rationale, capMinor, props.lapsed]);

  /**
   * The contract's error codes in plain words. A raw panic string tells a reader nothing, and the
   * one they are most likely to see is E_BAD_STATUS from sending the same decision twice, which is
   * the contract refusing a duplicate rather than anything being wrong.
   */
  function explain(message: string): string {
    const codes: [string, string][] = [
      ["E_BAD_STATUS", "this tender is no longer waiting for a proposal, usually because one has already been recorded. Reload to see where it stands."],
      ["E_NOT_COMMITTEE", "this account is not on the committee for this tender."],
      ["E_BID_INELIGIBLE", "code refused that bid, and the contract will not award it whatever the committee decides."],
      ["E_BID_LAPSED", "that bid was awarded before and the winner did not accept in time, so it cannot be awarded again."],
      ["E_RATIONALE_REQUIRED", "awarding anything but the top eligible bid needs a rationale."],
      ["E_BAD_AMOUNT", "the amount must be above zero and at most the budget cap."],
      ["E_NO_SUCH_BID", "that bid is not in the accepted result."],
    ];
    const hit = codes.find(([code]) => message.includes(code));
    return hit === undefined ? message : `${hit[0]}: ${hit[1]}`;
  }

  async function send(method: "propose_award" | "approve_award" | "close_without_award") {
    setSending(true);
    setError(null);
    try {
      const args =
        method === "propose_award"
          ? { tender_id: props.tenderId, bid_index: chosen, amount: amountMinor.toString(), rationale }
          : method === "approve_award"
            ? {
                tender_id: props.tenderId,
                bid_index: props.pending?.bidIndex ?? chosen,
                amount: props.pending?.amountMinor ?? amountMinor.toString(),
              }
            : { tender_id: props.tenderId, rationale };
      const out = await wallet.signAndSend({
        receiverId: CONTRACT_ID,
        actions: [{ methodName: method, args, gas: TGAS(100), deposit: "0" }],
      });
      setSent({ what: method, hash: out.hash });
    } catch (e) {
      setError(explain(e instanceof Error ? e.message : String(e)));
    } finally {
      setSending(false);
    }
  }

  if (wallet.status !== "connected") {
    return (
      <section className="verify-panel" aria-labelledby="committee-heading">
        <h2 id="committee-heading">Committee</h2>
        <p className="verify-lead">
          Connect the wallet of a committee member. The report is encrypted to a key only a member
          can derive, so nobody outside the committee can read the proposals, including us.
        </p>
      </section>
    );
  }

  return (
    <section className="verify-panel" aria-labelledby="committee-heading">
      <div className="verify-head">
        <div>
          <h2 id="committee-heading">Committee</h2>
          <p className="verify-lead">
            Scores and flags come from code and the models. Who wins is yours to decide, and the
            contract records both the decision and the reason.
          </p>
        </div>
        <Button onClick={() => void open()} disabled={stage === "working"}>
          {stage === "working" ? "Working" : report ? "Open again" : "Open the report"}
        </Button>
      </div>

      <p className="verify-status" role="status" aria-live="polite">
        {stage === "working" && `${step}...`}
        {stage === "error" && `Could not open the report: ${error}`}
        {stage === "open" && report
          ? `${report.bids.length} proposal(s) open. The ranking recommends ${
              report.recommended === null ? "no bid" : `bid ${report.recommended}`
            }.`
          : null}
      </p>

      {sent ? (
        <p className="verify-note" role="status">
          Sent {sent.what.replaceAll("_", " ")}.{" "}
          <a href={`${EXPLORER}/txns/${sent.hash}`} target="_blank" rel="noreferrer noopener">
            {sent.hash.slice(0, 10)}...
          </a>{" "}
          This page now shows what was true before that, so reload before deciding anything else.
        </p>
      ) : null}

      {stage === "open" && error !== null ? (
        <div className="verify-warning" role="alert">
          The chain refused that: {error}
        </div>
      ) : null}

      {report ? (
        <>
          <h3>The proposals, side by side</h3>
          <div className="committee-bids">
            {report.bids
              .slice()
              .sort((a, b) => a.debrief.rank - b.debrief.rank)
              .map((b) => (
                <BidCard
                  key={b.bidIndex}
                  bid={b}
                  recommended={report.recommended === b.bidIndex}
                  lapsed={props.lapsed.includes(b.bidIndex)}
                  selected={chosen === b.bidIndex}
                  onSelect={() => {
                    setChosen(b.bidIndex);
                    setAmount(defaultAmount(report, b.bidIndex));
                  }}
                />
              ))}
          </div>

          {props.canPropose ? (
            <>
              <h3>Award</h3>
              <div className="committee-award">
                <TextField
                  label={`Amount (${TOKEN_SYMBOL})`}
                  value={amount}
                  inputMode="decimal"
                  hint={`At most the budget cap, ${formatUnits(capMinor, TOKEN_DECIMALS)} ${TOKEN_SYMBOL}. Pre-filled with the bid's own price.`}
                  onChange={(e) => {
                    setAmount(e.target.value);
                  }}
                />
                {check?.deviation ? (
                  <div className="verify-warning" role="note">
                    This is a deviation: the ranking puts{" "}
                    {report.recommended === null ? "no eligible bid" : `bid ${report.recommended}`} first.
                    The contract will record it as one and will refuse it without a rationale of at
                    least {MIN_DEVIATION_RATIONALE_CHARS} characters.
                  </div>
                ) : null}
                <TextAreaField
                  label="Rationale"
                  rows={3}
                  value={rationale}
                  hint={
                    check?.deviation
                      ? `${[...rationale].length} of ${MIN_DEVIATION_RATIONALE_CHARS} characters. It is published on chain.`
                      : "Optional when you award the top eligible bid. It is published on chain."
                  }
                  onChange={(e) => {
                    setRationale(e.target.value);
                  }}
                />
                {check !== null && check.errors.length > 0 ? (
                  <ul className="committee-errors">
                    {check.errors.map((m) => (
                      <li key={m}>{m}</li>
                    ))}
                  </ul>
                ) : null}
                <div className="committee-actions">
                  <Button
                    onClick={() => void send("propose_award")}
                    loading={sending}
                    disabled={
                      sending || sent !== null || chosen === null || check === null || check.errors.length > 0
                    }
                  >
                    Propose this award
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => void send("close_without_award")}
                    loading={sending}
                    disabled={sending || sent !== null || [...rationale].length < MIN_DEVIATION_RATIONALE_CHARS}
                  >
                    Close without awarding
                  </Button>
                </div>
                <p className="verify-detail">
                  Closing without an award returns the whole escrow to the buyer and needs a
                  rationale too, for the same reason: a tender that takes bids and ends in nothing
                  owes the bidders an explanation.
                </p>
              </div>
            </>
          ) : null}

          {props.pending ? (
            <>
              <h3>Pending proposal</h3>
              <p className="verify-detail">
                Bid {props.pending.bidIndex ?? "none"} for{" "}
                {formatUnits(props.pending.amountMinor, TOKEN_DECIMALS)} {TOKEN_SYMBOL}.{" "}
                {props.pending.approvals.length} of {props.approvalsRequired} approval(s):{" "}
                {props.pending.approvals.join(", ") || "none yet"}.
              </p>
              <Button onClick={() => void send("approve_award")} loading={sending} disabled={sending || sent !== null}>
                Approve this proposal
              </Button>
            </>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

/** A bid's own asking price, which is what an award is normally for. */
function defaultAmount(report: CommitteeReport, bidIndex: number | null, override?: string): string {
  if (override !== undefined) return plainUnits(override, TOKEN_DECIMALS);
  if (bidIndex === null) return "";
  const bid = report.bids.find((b) => b.bidIndex === bidIndex);
  const price = bid?.proposal?.["price_minor"];
  if (typeof price !== "string") return "";
  try {
    return plainUnits(price, TOKEN_DECIMALS);
  } catch {
    return "";
  }
}

function BidCard({
  bid,
  recommended,
  lapsed,
  selected,
  onSelect,
}: {
  bid: CommitteeBid;
  recommended: boolean;
  lapsed: boolean;
  selected: boolean;
  onSelect: () => void;
}) {
  const p = bid.proposal;
  const flags = explainFlags(bid.debrief.flags);
  const price = typeof p?.["price_minor"] === "string" ? (p["price_minor"] as string) : null;
  return (
    <article className={`committee-bid${selected ? " is-selected" : ""}`}>
      <header className="committee-bid-head">
        <div>
          <span className="verify-name">{bid.bidder}</span>
          <span className="verify-detail">
            Rank {bid.debrief.rank} of {bid.debrief.of}
            {recommended ? ", top eligible" : ""}
            {lapsed ? ", lapsed" : ""}
          </span>
        </div>
        <span className="debrief-bp">{formatBp(bid.debrief.total_bp)}</span>
      </header>

      <dl className="committee-bid-facts">
        <div>
          <dt>Price</dt>
          <dd>
            {price === null ? "not readable" : `${formatUnits(price, TOKEN_DECIMALS)} ${TOKEN_SYMBOL}`}
          </dd>
        </div>
        <div>
          <dt>Delivery</dt>
          <dd>{typeof p?.["delivery_days"] === "number" ? `${String(p["delivery_days"])} days` : "not readable"}</dd>
        </div>
        <div>
          <dt>Eligible</dt>
          <dd>{bid.debrief.eligible ? "Yes" : "No"}</dd>
        </div>
      </dl>

      {flags.length > 0 ? (
        <div className="debrief-flags">
          {flags.map((f) => (
            <div key={f.label} className="debrief-flag">
              <span className="debrief-flag-label">{f.label}</span>
              <span className="verify-detail">{f.meaning}</span>
            </div>
          ))}
        </div>
      ) : null}

      {p !== null ? (
        <details className="committee-proposal">
          <summary>Read the proposal</summary>
          {["methodology", "track_record"].map((field) =>
            typeof p[field] === "string" ? (
              <div key={field}>
                <h4>{field.replaceAll("_", " ")}</h4>
                <p className="committee-proposal-text">{p[field] as string}</p>
              </div>
            ) : null,
          )}
        </details>
      ) : (
        <p className="verify-detail">This bid did not decrypt, so there is no text to read.</p>
      )}

      <Button variant={selected ? "primary" : "secondary"} size="small" onClick={onSelect} disabled={lapsed}>
        {selected ? "Selected" : "Select for award"}
      </Button>
    </article>
  );
}
