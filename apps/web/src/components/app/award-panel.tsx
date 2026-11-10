"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { CONTRACT_ID, NETWORK, TOKEN_DECIMALS, TOKEN_SYMBOL } from "../../config/demo.ts";
import { TGAS, useWallet } from "../../lib/wallet/wallet-provider.tsx";
import { formatUnits, formatUtc, hasPassed } from "../../lib/tender/format.ts";
import { Button } from "../ui/button.tsx";
import { TextField } from "../ui/field.tsx";
import { Badge, type BadgeTone } from "../ui/badge.tsx";
import { CopyButton } from "../ui/copy-button.tsx";
import { Icon } from "../ui/icon.tsx";

/**
 * The winner's side of an award: see it, choose where the money goes, accept.
 *
 * Route 1 (a NEAR account) is the whole of T11. Route 2, another chain through NEAR Intents, is
 * T13; until it lands this page says so plainly rather than offering a control that does nothing.
 */

const EXPLORER = NETWORK === "mainnet" ? "https://nearblocks.io" : "https://testnet.nearblocks.io";

export interface AwardPanelProps {
  tenderId: number;
  /** The awarded bidder's account, or null when nothing is awarded yet. */
  winner: string | null;
  amountMinor: string;
  rationale: string;
  deviation: boolean;
  approvals: string[];
  approvalsRequired: number;
  approvedAtNs: string | null;
  acceptByNs: string | null;
  /** The shape `get_tender` returns for `payout_state`. */
  payoutState: unknown;
  payoutAccount: string | null;
  status: string;
}

function payoutLabel(state: unknown): { label: string; title: string; detail: string; tone: BadgeTone } {
  if (state === "Paid") {
    return { label: "Paid", title: "Payment complete", detail: "The winner was paid from escrow. Any remaining budget was returned to the buyer. No further action is needed.", tone: "success" };
  }
  if (state === "PayoutRefunded") {
    return { label: "Refunded", title: "Payment refunded", detail: "The escrow went back to the buyer.", tone: "neutral" };
  }
  if (typeof state === "object" && state !== null && "PayingOut" in state) {
    return { label: "Paying out", title: "Payment in progress", detail: "The winner accepted. The transfer has been sent and is waiting to settle.", tone: "violet" };
  }
  if (typeof state === "object" && state !== null && "PayoutFailed" in state) {
    const reason = (state as { PayoutFailed: { reason: string } }).PayoutFailed.reason;
    return {
      label: "Payout failed",
      title: "Payment needs attention",
      detail: `The transfer did not go through (${reason}). The escrow is untouched and anyone may retry it.`,
      tone: "danger",
    };
  }
  return { label: "Not started", title: "Awaiting acceptance", detail: "Once the committee has approved, the winner chooses a payout account and accepts the award.", tone: "neutral" };
}

export function AwardPanel(props: AwardPanelProps) {
  const wallet = useWallet();
  const [account, setAccount] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hash, setHash] = useState<string | null>(null);
  const pending = useRef(false);

  const isWinner = wallet.accountId !== null && wallet.accountId === props.winner;
  const approved = props.approvedAtNs !== null;
  const lapsed = props.acceptByNs !== null && hasPassed(props.acceptByNs);
  const payout = payoutLabel(props.payoutState);
  const canAccept = isWinner && approved && !lapsed && props.status === "Awarded";
  const awaitingAcceptance = approved && props.status === "Awarded" && !lapsed;

  async function accept() {
    if (pending.current || hash !== null || !canAccept) return;
    pending.current = true;
    setSending(true);
    setError(null);
    try {
      const target = account.trim() === "" ? (wallet.accountId ?? "") : account.trim();
      const out = await wallet.signAndSend({
        receiverId: CONTRACT_ID,
        actions: [
          {
            methodName: "accept_award",
            args: { tender_id: props.tenderId, payout: { Near: { account: target } } },
            gas: TGAS(100),
            deposit: "0",
          },
        ],
      });
      setHash(out.hash);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      pending.current = false;
      setSending(false);
    }
  }

  if (props.winner === null) {
    return (
      <section className="panel ui-paper award-empty" aria-labelledby="award-heading">
        <Icon name="document" size={28} />
        <h2 id="award-heading">No award yet</h2>
        <p>The committee has not selected a winner. The decision, amount and payout will appear here once recorded.</p>
        <Link className="ui-button ui-button--secondary" href={`/tenders/${props.tenderId}`}>View tender <Icon name="arrow" /></Link>
      </section>
    );
  }

  return (
    <div className="award-layout">
      <section className="panel ui-paper award-overview" aria-labelledby="award-heading">
        <div className="award-status" data-tone={payout.tone}>
          <span className="award-status-icon"><Icon name={payout.tone === "success" ? "check" : payout.tone === "danger" ? "warning" : "clock"} size={22} /></span>
          <div>
            <h2 id="award-heading">{!approved ? "Awaiting committee approval" : lapsed && props.status === "Awarded" ? "Acceptance window expired" : payout.title}</h2>
            <p>{!approved ? "The proposed award still needs enough committee approvals before the winner can accept." : lapsed && props.status === "Awarded" ? "The winner did not accept before the deadline. The committee can select the next bid." : payout.detail}</p>
          </div>
        </div>

        <dl className="award-amount">
          <dt>Award amount</dt>
          <dd>{formatUnits(props.amountMinor, TOKEN_DECIMALS)} <span>{TOKEN_SYMBOL}</span></dd>
        </dl>
        <dl className="award-parties">
          <div>
            <dt>Awarded to</dt>
            <dd><a className="inline-link" href={`${EXPLORER}/address/${props.winner}`} target="_blank" rel="noreferrer noopener">{props.winner}<Icon name="external" size={16} /></a><CopyButton value={props.winner} label="Copy winner account" compact /></dd>
          </div>
          {props.payoutAccount !== null && <div><dt>Payout account</dt><dd><a className="inline-link" href={`${EXPLORER}/address/${props.payoutAccount}`} target="_blank" rel="noreferrer noopener">{props.payoutAccount}<Icon name="external" size={16} /></a></dd></div>}
          <div><dt>Payout status</dt><dd><Badge tone={payout.tone}>{payout.label}</Badge></dd></div>
        </dl>

        {awaitingAcceptance && props.acceptByNs !== null && <p className="award-deadline"><Icon name="clock" size={17} /> Accept by {formatUtc(props.acceptByNs)}</p>}

      {hash !== null ? (
        <div className="award-receipt" role="status">
          <p>Acceptance recorded.{" "}
          <a href={`${EXPLORER}/txns/${hash}`} target="_blank" rel="noreferrer noopener">
            View transaction <Icon name="external" size={15} />
          </a></p>
          <Button variant="secondary" size="small" onClick={() => window.location.reload()}>Refresh payout status <Icon name="refresh" size={16} /></Button>
        </div>
      ) : null}

      {canAccept ? (
        <section className="award-accept" aria-labelledby="accept-heading">
          <h3 id="accept-heading">Accept and get paid</h3>
          <div className="committee-award">
            <TextField
              label="NEAR account to pay"
              value={account}
              disabled={sending || hash !== null}
              placeholder={wallet.accountId ?? ""}
              hint="Leave blank to use the account you are connected with. It must be registered with the token contract."
              onChange={(e) => {
                setAccount(e.target.value);
              }}
            />
            <Button onClick={() => void accept()} loading={sending} disabled={sending || hash !== null}>
              {sending ? "Waiting for wallet approval" : hash !== null ? "Acceptance sent" : `Accept ${formatUnits(props.amountMinor, TOKEN_DECIMALS)} ${TOKEN_SYMBOL}`}
            </Button>
            {error !== null ? <p className="ui-field-error" role="alert">{error}</p> : null}
            <p className="verify-detail">Payouts on this demo use a NEAR account.</p>
          </div>
        </section>
      ) : awaitingAcceptance && !isWinner ? (
        <div className="award-wallet-note"><Icon name="wallet" size={20} /><p>Only {props.winner} can accept this award. Connect that wallet to continue.</p></div>
      ) : null}
        <div className="award-links">
          <Link className="ui-button ui-button--primary" href={`/tenders/${props.tenderId}/verify`}>Verify public evidence <Icon name="arrow" size={17} /></Link>
          <Link className="ui-button ui-button--ghost" href={`/tenders/${props.tenderId}`}>View tender</Link>
        </div>
      </section>

      <section className="panel ui-paper award-decision" aria-labelledby="decision-heading">
        <div className="award-section-label"><Icon name="document" size={18} /><span>Committee decision</span></div>
        <h2 id="decision-heading">How it was decided</h2>
        <dl className="award-decision-facts">
          <div><dt>Approvals</dt><dd><strong>{props.approvals.length} of {props.approvalsRequired}</strong><span>{approved ? "Approval threshold met" : "More approvals needed"}</span></dd></div>
          {props.approvals.length > 0 && <div><dt>Approved by</dt><dd>{props.approvals.map((member) => <span key={member}>{member}</span>)}</dd></div>}
          {props.approvedAtNs !== null && <div><dt>Approved on</dt><dd>{formatUtc(props.approvedAtNs)}</dd></div>}
        </dl>
        <div className="award-rationale" data-deviation={props.deviation}>
          <Badge tone={props.deviation ? "warning" : "neutral"} icon={props.deviation ? "warning" : "check"}>{props.deviation ? "Deviation from ranking" : "Follows the ranking"}</Badge>
          <h3>{props.deviation ? "Why a different bid was selected" : "Committee note"}</h3>
          {props.deviation && <p>The selected bid was not the top eligible bid. A written rationale is required and recorded on chain.</p>}
          {props.rationale.trim() !== "" ? <blockquote>{props.rationale}</blockquote> : <p>No additional note was recorded.</p>}
        </div>
      </section>
    </div>
  );
}
