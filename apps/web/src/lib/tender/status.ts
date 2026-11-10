// How a tender's state is shown. One map, so the list, the tender page and the bid page cannot
// drift apart, and so no status reaches a reader as a raw enum name.
//
// Wording follows CLAUDE.md: what happened, in plain words, with no claim the code cannot back.
import type { BadgeTone } from "../../components/ui/badge.tsx";
import type { LifecycleStep } from "../../components/app/lifecycle.tsx";
import type { Attempt, Award, Status, Tender } from "../near/schemas.ts";
import { attemptFailureReason, attemptOutcomeName, payoutStateName } from "../near/schemas.ts";
import { formatUtc } from "./format.ts";

export interface StatusPresentation {
  label: string;
  tone: BadgeTone;
  /** One sentence a reader who knows nothing about the protocol can act on. */
  detail: string;
}

export const STATUS_PRESENTATION: Record<Status, StatusPresentation> = {
  PendingKey: {
    label: "Preparing",
    tone: "neutral",
    detail: "Waiting for the TEE to return the key that bids are encrypted to.",
  },
  AwaitingFunds: {
    label: "Awaiting escrow",
    tone: "neutral",
    detail: "The key is set. The buyer has not funded the budget yet, so bidding has not opened.",
  },
  Open: {
    label: "Bidding open",
    tone: "violet",
    detail: "Sealed bids are being accepted until the deadline.",
  },
  Cancelled: {
    label: "Cancelled",
    tone: "neutral",
    detail: "The buyer cancelled before any bid was submitted.",
  },
  NoBids: {
    label: "No bids",
    tone: "neutral",
    detail: "The deadline passed with no bid to evaluate.",
  },
  Evaluating: {
    label: "Evaluating",
    tone: "violet",
    detail: "The bid set is frozen and the pinned evaluator is scoring it inside the TEE.",
  },
  Evaluated: {
    label: "Evaluated",
    tone: "success",
    detail: "The result is on chain. The committee decides the award.",
  },
  EvalFailed: {
    label: "Evaluation needs a retry",
    tone: "danger",
    detail: "An evaluation attempt failed. Bids stay frozen and funds remain held. Another attempt can be requested.",
  },
  Failed: {
    label: "Failed",
    tone: "danger",
    detail: "The tender ended without an accepted evaluation. The contract starts refunds of any remaining escrow, unsettled bonds and unused evaluation fees.",
  },
  Awarded: {
    label: "Awarded",
    tone: "success",
    detail: "The committee awarded the tender. The winner has to accept it.",
  },
  PayingOut: {
    label: "Paying out",
    tone: "violet",
    detail: "The winner accepted. The escrow is being transferred.",
  },
  Paid: {
    label: "Paid",
    tone: "success",
    detail: "The winner was paid from escrow and any remainder went back to the buyer.",
  },
  ClosedNoAward: {
    label: "Closed, no award",
    tone: "neutral",
    detail: "The committee closed the tender without awarding it.",
  },
};

export function statusOf(status: Status): StatusPresentation {
  return STATUS_PRESENTATION[status];
}

/** Statuses in which the evaluation has run and a result exists to read. */
export function hasResult(tender: Pick<Tender, "status" | "result_json">): boolean {
  return tender.result_json !== null;
}

/** Whether this account may still submit a bid. */
export function canBid(tender: Pick<Tender, "status">): boolean {
  return tender.status === "Open";
}

type StepState = LifecycleStep["state"];

/** Order the lifecycle runs in. A tender visits a prefix of this, then one ending. */
const ORDER: Status[] = ["PendingKey", "AwaitingFunds", "Open", "Evaluating", "Evaluated", "Awarded", "Paid"];

function stateFor(step: Status, current: Status): StepState {
  const here = ORDER.indexOf(step);
  const now = ORDER.indexOf(current);
  // A status off the happy path (cancelled, failed, no bids) leaves the earlier steps complete
  // and everything after it upcoming, which is what actually happened.
  if (now < 0) return here <= ORDER.indexOf("Open") ? "complete" : "upcoming";
  if (here < now) return "complete";
  // Paid is the end of the line: the last step is finished, not in progress.
  if (here === now) return current === "Paid" ? "complete" : "current";
  return "upcoming";
}

export interface LifecycleInput {
  status: Status;
  deadline_ns: string;
  bidCount: number;
  attempts: Attempt[];
  award: Award | null;
  hasKey: boolean;
  escrowed: string;
}

/**
 * The timeline as the tender page shows it. Each step says what happened rather than naming a
 * state machine transition, and the detail carries the evidence when there is any.
 */
export function lifecycleSteps(input: LifecycleInput): LifecycleStep[] {
  const { status } = input;
  const lastAttempt = input.attempts.at(-1);
  const failed = input.attempts
    .map((a) => attemptFailureReason(a.outcome))
    .filter((reason): reason is string => reason !== null);

  const steps: LifecycleStep[] = [
    {
      label: "Created",
      detail: "The rubric, deadline, bond and committee were fixed and cannot change.",
      state: "complete",
    },
    {
      label: "Key set",
      detail: input.hasKey
        ? "The TEE returned the public key that bids are encrypted to."
        : "Waiting for the TEE to return the tender key.",
      state: input.hasKey ? "complete" : stateFor("PendingKey", status),
    },
    {
      label: "Funded",
      detail:
        BigInt(input.escrowed) > 0n
          ? "The budget is held in escrow by the contract."
          : status === "Paid" || status === "ClosedNoAward"
            ? "The escrow has been settled."
            : "Waiting for the buyer to fund the escrow.",
      state: stateFor("AwaitingFunds", status) === "current" ? "current" : "complete",
    },
    {
      label: "Bidding",
      detail:
        status === "Open"
          ? `Open until ${formatUtc(input.deadline_ns)}.`
          : input.bidCount === 1
            ? "One sealed bid was submitted."
            : `${input.bidCount} sealed bids were submitted.`,
      state: stateFor("Open", status),
    },
    {
      label: "Closed and evaluated",
      detail:
        lastAttempt && attemptOutcomeName(lastAttempt.outcome) === "Accepted"
          ? input.attempts.length === 1
            ? "The evaluator ran once and the contract accepted its result."
            : `The contract accepted attempt ${input.attempts.length} of at most 3.`
          : failed.length > 0
            ? `Attempts refused so far: ${failed.join(", ")}.`
            : "The bid set is frozen with its Merkle root and the evaluator has been called.",
      state: stateFor("Evaluating", status),
    },
    {
      label: "Awarded",
      detail: awardDetail(input.award, status),
      state: stateFor("Awarded", status),
    },
    {
      label: "Paid",
      detail: payoutDetail(input.award, status),
      state: stateFor("Paid", status),
    },
  ];

  return steps;
}

function awardDetail(award: Award | null, status: Status): string {
  if (status === "ClosedNoAward") return "The committee closed the tender without awarding it.";
  if (!award) return "The committee has not decided yet.";
  if (award.bid_index === null) return "The committee proposed closing without an award.";
  const approvals = award.approvals.length;
  const deviation = award.deviation ? ", a deviation from the ranking with a written rationale" : "";
  return `Bid ${award.bid_index + 1} was awarded with ${approvals} approval${approvals === 1 ? "" : "s"}${deviation}.`;
}

function payoutDetail(award: Award | null, status: Status): string {
  if (!award) return "Nothing has been paid.";
  switch (payoutStateName(award.payout_state)) {
    case "Paid":
      return "The winner was paid from escrow and the remainder returned to the buyer.";
    case "PayingOut":
      return "The transfer is in flight.";
    case "PayoutFailed":
      return "The transfer failed and can be retried.";
    case "PayoutRefunded":
      return "The escrow went back to the buyer.";
    default:
      return status === "Awarded"
        ? "Waiting for the winner to accept the award."
        : "Nothing has been paid.";
  }
}
