import type { TenderCardData } from "../components/app/tender-card.tsx";
import type { LifecycleStep } from "../components/app/lifecycle.tsx";

// Illustrative fixtures for /components only. These are not live tender records.
export const PREVIEW_TENDER: TenderCardData = {
  reference: "Tender 001",
  title: "Security review of a DAO treasury module",
  buyer: "Example buyer",
  description:
    "A manual review of the Rust contracts, a written report, and one retest of fixes.",
  status: "sealed",
  budget: "15,000",
  currency: "tUSDC",
  bids: 3,
  deadlineLabel: "Closes",
  deadline: "2026-11-12T18:00:00Z",
};

export const PREVIEW_LIFECYCLE: readonly LifecycleStep[] = [
  { label: "Created", detail: "Rubric published", state: "complete" },
  { label: "Funded", detail: "Budget in escrow", state: "complete" },
  { label: "Bidding open", detail: "Bids stay encrypted", state: "current" },
  { label: "Evaluated", detail: "After the deadline", state: "upcoming" },
  { label: "Awarded", detail: "Committee decision", state: "upcoming" },
  { label: "Paid", detail: "Winner accepts", state: "upcoming" },
];

export const PREVIEW_CRITERIA = [
  { name: "Price", method: "Lowest eligible price ratio", weight: 40 },
  {
    name: "Methodology",
    method: "Three model scores, checked quotes",
    weight: 35,
  },
  {
    name: "Track record",
    method: "Three model scores, checked quotes",
    weight: 25,
  },
] as const;

export const REVIEW_SECTIONS = [
  { id: "workspace", label: "Workspace", icon: "layers" },
  { id: "actions", label: "Actions", icon: "plus" },
  { id: "inputs", label: "Form controls", icon: "document" },
  { id: "evaluation", label: "Evaluation", icon: "shield" },
  { id: "feedback", label: "Feedback", icon: "info" },
] as const;
