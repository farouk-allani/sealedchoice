"use client";

import { useState } from "react";
import { CONTRACT_ID, NETWORK, TOKEN_DECIMALS, TOKEN_SYMBOL } from "../../config/demo.ts";
import { TGAS, useWallet } from "../../lib/wallet/wallet-provider.tsx";
import { formatUnits, formatUtc, hasPassed } from "../../lib/tender/format.ts";
import { Button } from "../ui/button.tsx";
import { TextField } from "../ui/field.tsx";

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
  status: string;
}

function payoutLabel(state: unknown): { label: string; detail: string } {
  if (state === "Paid") {
    return { label: "Paid", detail: "The escrow paid the winner, and any remainder went back to the buyer." };
  }
  if (state === "PayoutRefunded") {
    return { label: "Refunded", detail: "The escrow went back to the buyer." };
  }
  if (typeof state === "object" && state !== null && "PayingOut" in state) {
    return { label: "Paying out", detail: "The transfer has been sent and the contract is waiting for it to settle." };
  }
  if (typeof state === "object" && state !== null && "PayoutFailed" in state) {
    const reason = (state as { PayoutFailed: { reason: string } }).PayoutFailed.reason;
    return {
      label: "Payout failed",
      detail: `The transfer did not go through (${reason}). The escrow is untouched and anyone may retry it.`,
    };
  }
  return { label: "Not started", detail: "Nothing has been sent yet." };
}

export function AwardPanel(props: AwardPanelProps) {
  const wallet = useWallet();
  const [account, setAccount] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hash, setHash] = useState<string | null>(null);

  const isWinner = wallet.accountId !== null && wallet.accountId === props.winner;
  const approved = props.approvedAtNs !== null;
  const lapsed = props.acceptByNs !== null && hasPassed(props.acceptByNs);
  const payout = payoutLabel(props.payoutState);
  const canAccept = isWinner && approved && !lapsed && props.status === "Awarded";

  async function accept() {
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
      setSending(false);
    }
  }

  if (props.winner === null) {
    return (
      <section className="verify-panel" aria-labelledby="award-heading">
        <h2 id="award-heading">Award</h2>
        <p className="verify-lead">
          Nothing has been awarded yet. The committee decides, and the decision and its reason are
          recorded on chain when it does.
        </p>
      </section>
    );
  }

  return (
    <section className="verify-panel" aria-labelledby="award-heading">
      <h2 id="award-heading">Award</h2>

      <dl className="debrief-summary">
        <div>
          <dt>Winner</dt>
          <dd className="award-account">{props.winner}</dd>
        </div>
        <div>
          <dt>Amount</dt>
          <dd>
            {formatUnits(props.amountMinor, TOKEN_DECIMALS)} {TOKEN_SYMBOL}
          </dd>
        </div>
        <div>
          <dt>Payout</dt>
          <dd>{payout.label}</dd>
        </div>
      </dl>
      <p className="verify-detail">{payout.detail}</p>

      <h3>How it was decided</h3>
      <p className="verify-detail">
        {props.approvals.length} of {props.approvalsRequired} committee approval(s)
        {props.approvals.length > 0 ? `: ${props.approvals.join(", ")}` : ""}.{" "}
        {approved
          ? `Approved, and the winner has until ${props.acceptByNs === null ? "the deadline" : formatUtc(props.acceptByNs)} to accept.`
          : "Not yet approved by enough members."}
      </p>
      {props.deviation ? (
        <div className="verify-warning" role="note">
          This award did not go to the top eligible bid. The committee gave this reason, and the
          contract would not have taken the award without one: {props.rationale}
        </div>
      ) : props.rationale.trim() !== "" ? (
        <p className="verify-detail">Committee note: {props.rationale}</p>
      ) : null}

      {lapsed && props.status === "Awarded" ? (
        <div className="verify-warning" role="note">
          The acceptance window has passed. The committee can award the next bid instead, and this
          one cannot be awarded again.
        </div>
      ) : null}

      {hash !== null ? (
        <p className="verify-note" role="status">
          Accepted.{" "}
          <a href={`${EXPLORER}/txns/${hash}`} target="_blank" rel="noreferrer noopener">
            {hash.slice(0, 10)}...
          </a>{" "}
          Reload to see the payout settle.
        </p>
      ) : null}

      {canAccept ? (
        <>
          <h3>Accept and get paid</h3>
          <div className="committee-award">
            <TextField
              label="NEAR account to pay"
              value={account}
              placeholder={wallet.accountId ?? ""}
              hint="Leave blank to use the account you are connected with. It must be registered with the token contract."
              onChange={(e) => {
                setAccount(e.target.value);
              }}
            />
            <Button onClick={() => void accept()} loading={sending} disabled={sending}>
              Accept {formatUnits(props.amountMinor, TOKEN_DECIMALS)} {TOKEN_SYMBOL}
            </Button>
            {error !== null ? <p className="ui-field-error">{error}</p> : null}
            <p className="verify-detail">
              Paying out to another chain through NEAR Intents is not wired up here yet. Until it
              is, this page offers the NEAR route only rather than a control that would not work.
            </p>
          </div>
        </>
      ) : props.status === "Awarded" && !isWinner ? (
        <p className="verify-detail">
          Only {props.winner} can accept this award. Connect that wallet to do it.
        </p>
      ) : null}
    </section>
  );
}
