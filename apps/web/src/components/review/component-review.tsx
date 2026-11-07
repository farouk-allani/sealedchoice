"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { BRAND } from "@tender/shared";
import { BrandMark } from "../brand-mark.tsx";
import { Badge } from "../ui/badge.tsx";
import { Button, ButtonLink } from "../ui/button.tsx";
import { CopyButton } from "../ui/copy-button.tsx";
import { Dialog } from "../ui/dialog.tsx";
import { EmptyState, SkeletonRows } from "../ui/empty-state.tsx";
import { SelectField, TextField } from "../ui/field.tsx";
import { Icon } from "../ui/icon.tsx";
import { Tabs } from "../ui/tabs.tsx";
import { Lifecycle } from "../app/lifecycle.tsx";
import { RankingTable } from "../app/ranking-table.tsx";
import { TenderCard, type TenderCardData } from "../app/tender-card.tsx";
import { Notice, TransactionNotice } from "../app/transaction-notice.tsx";
import {
  DEMO_RANKING,
  DEMO_TENDER,
  explorerTx,
} from "../../config/evidence.ts";
import {
  PREVIEW_CRITERIA,
  PREVIEW_LIFECYCLE,
  PREVIEW_TENDER,
  REVIEW_SECTIONS,
} from "../../content/component-preview.ts";
import { PreviewBidForm, type PreviewBid } from "./preview-bid-form.tsx";
import {
  TypographyPreview,
  type TypographyPreset,
} from "./typography-preview.tsx";

type DialogKind = "tender" | "create" | "bid" | "rubric" | "typography" | null;

function RubricPreview() {
  return (
    <div className="review-rubric ui-paper">
      <div className="review-panel-intro">
        <h3>Published scoring criteria</h3>
        <p>Criteria and weights are published before bidding opens.</p>
      </div>
      <div className="review-rubric-table">
        <div className="review-rubric-head">
          <span>Criterion</span>
          <span>Scoring method</span>
          <span>Weight</span>
        </div>
        {PREVIEW_CRITERIA.map((criterion) => (
          <div key={criterion.name}>
            <strong>{criterion.name}</strong>
            <span>{criterion.method}</span>
            <strong>{criterion.weight}%</strong>
          </div>
        ))}
      </div>
      <Notice title="Fixed before bidding" tone="info">
        The published rubric cannot be edited after a tender is created.
      </Notice>
    </div>
  );
}

export function ComponentReview() {
  const [typography, setTypography] = useState<TypographyPreset>("public");
  const [activeSection, setActiveSection] = useState("workspace");
  const [workspaceTab, setWorkspaceTab] = useState("overview");
  const [tenderState, setTenderState] =
    useState<TenderCardData["status"]>("sealed");
  const [feedbackTab, setFeedbackTab] = useState("pending");
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [draftName, setDraftName] = useState(
    "Security review of a DAO treasury module",
  );
  const [savedDraft, setSavedDraft] = useState("");
  const [bid, setBid] = useState<PreviewBid | null>(null);
  const [receiptSaved, setReceiptSaved] = useState(false);

  useEffect(() => {
    const sections = REVIEW_SECTIONS.map(({ id }) =>
      document.getElementById(id),
    ).filter((node): node is HTMLElement => !!node);
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActiveSection(visible[0].target.id);
      },
      { rootMargin: "-100px 0px -25% 0px", threshold: 0 },
    );
    sections.forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, []);

  const tender = {
    ...PREVIEW_TENDER,
    status: tenderState,
    deadlineLabel: tenderState === "sealed" ? "Closes" : "Closed",
  };
  const lifecycle = PREVIEW_LIFECYCLE.map((step, index) => ({
    ...step,
    state:
      tenderState === "paid"
        ? ("complete" as const)
        : tenderState === "evaluated"
          ? index < 4
            ? ("complete" as const)
            : index === 4
              ? ("current" as const)
              : ("upcoming" as const)
          : step.state,
  }));

  function reviewBid(value: PreviewBid) {
    setBid(value);
    setReceiptSaved(false);
    setDialog("bid");
  }

  function downloadReceipt() {
    if (!bid) return;
    const file = new Blob(
      [
        JSON.stringify(
          {
            preview: true,
            notice:
              "Illustrative UI receipt. No encryption or transaction performed.",
            ...bid,
          },
          null,
          2,
        ),
      ],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = url;
    link.download = "sealed-bid-preview.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setReceiptSaved(true);
  }

  const dialogTitle =
    dialog === "typography"
      ? "Typography"
      : dialog === "create"
        ? "Create a tender"
        : dialog === "bid"
          ? "Review your bid"
          : dialog === "rubric"
            ? "Published rubric"
            : "Tender overview";
  const dialogDescription =
    dialog === "typography"
      ? "Compare fonts on the same components. Your form values stay in place."
      : dialog === "create"
        ? "Start with a clear title. This saves a preview draft in this page only."
        : dialog === "bid"
          ? "Check the details before the encryption and signing step in the app. This preview does not send a bid."
          : dialog === "rubric"
            ? "An illustrative rubric for the sample security review."
            : "An illustrative tender for reviewing the interface.";

  return (
    <div className="app-theme review-page" data-typography={typography}>
      <a className="review-skip" href="#review-main">
        Skip to components
      </a>
      <header className="review-header">
        <div className="review-header-inner">
          <div className="review-header-left">
            <Link
              href="/"
              className="review-brand"
              aria-label={`${BRAND.name} home`}
            >
              <BrandMark />
              <span>{BRAND.name}</span>
            </Link>
            <span className="review-library-label">Interface review</span>
          </div>
          <div className="review-header-right ui-paper">
            <Button
              variant="ghost"
              size="small"
              onClick={() => setDialog("typography")}
            >
              Typography
            </Button>
            <ButtonLink href="/" size="small" aria-label="Landing page">
              <span className="review-return-label">Landing page</span>
              <Icon name="external" size={16} />
            </ButtonLink>
          </div>
        </div>
      </header>
      <div className="review-frame">
        <aside className="review-rail">
          <div className="review-rail-sticky">
            <p className="review-nav-label">In this library</p>
            <nav aria-label="Component sections">
              {REVIEW_SECTIONS.map((section) => (
                <a
                  href={`#${section.id}`}
                  key={section.id}
                  aria-current={
                    activeSection === section.id ? "location" : undefined
                  }
                  onClick={() => setActiveSection(section.id)}
                >
                  {section.label}
                </a>
              ))}
            </nav>
            <div className="review-rail-note">
              <p>
                SealedChoice
                <br />
                Component review
              </p>
            </div>
          </div>
        </aside>
        <main id="review-main" className="review-main">
          <div className="review-intro">
            <div>
              <h1>App components.</h1>
              <p>Tender records, forms and evaluation states.</p>
            </div>
            <div className="review-intro-note">
              <span>Interactive preview</span>
              <p>Sample data unless marked as recorded.</p>
            </div>
          </div>

          <section id="workspace" className="review-section">
            <div className="review-section-heading">
              <div>
                <h2>Tender workspace</h2>
                <p>Open bidding, committee review and settlement.</p>
              </div>
              <span className="review-specimen-label">Composed components</span>
            </div>
            <div className="review-workspace">
              <Tabs
                label="Tender workspace preview"
                value={workspaceTab}
                onChange={setWorkspaceTab}
                items={[
                  {
                    id: "overview",
                    label: "Overview",
                    content: (
                      <>
                        <div className="review-workspace-grid">
                          <TenderCard
                            tender={tender}
                            artwork
                            action={
                              <Button
                                size="small"
                                variant="secondary"
                                onClick={() => setDialog("tender")}
                              >
                                View tender
                              </Button>
                            }
                          />
                          <div className="review-state-picker">
                            <div>
                              <h3>Lifecycle state</h3>
                              <p>Choose a state to preview.</p>
                            </div>
                            <div
                              className="review-state-buttons"
                              role="group"
                              aria-label="Tender preview state"
                            >
                              {(
                                [
                                  {
                                    id: "sealed",
                                    label: "Bidding open",
                                    detail: "Encrypted and accepting bids",
                                    icon: "lock",
                                  },
                                  {
                                    id: "evaluated",
                                    label: "Evaluated",
                                    detail: "Ready for committee review",
                                    icon: "document",
                                  },
                                  {
                                    id: "paid",
                                    label: "Paid",
                                    detail: "Award accepted and settled",
                                    icon: "check",
                                  },
                                ] as const
                              ).map((state) => (
                                <button
                                  type="button"
                                  key={state.id}
                                  aria-pressed={tenderState === state.id}
                                  onClick={() => setTenderState(state.id)}
                                >
                                  <span className="review-state-option-copy">
                                    <strong>{state.label}</strong>
                                    <span>{state.detail}</span>
                                  </span>
                                  <span className="review-state-check">
                                    {tenderState === state.id && (
                                      <Icon name="check" size={15} />
                                    )}
                                  </span>
                                </button>
                              ))}
                            </div>
                          </div>
                        </div>
                        <Lifecycle steps={lifecycle} />
                      </>
                    ),
                  },
                  { id: "rubric", label: "Rubric", content: <RubricPreview /> },
                  {
                    id: "activity",
                    label: "Activity",
                    count: 3,
                    content: (
                      <div className="review-activity ui-paper">
                        <div className="review-panel-intro">
                          <h3>Tender activity</h3>
                          <p>
                            Illustrative lifecycle events, presented in order.
                          </p>
                        </div>
                        {[
                          {
                            title: "Rubric published",
                            description:
                              "Criteria and weights fixed before bidding.",
                            icon: "document",
                          },
                          {
                            title: "Budget funded",
                            description: "15,000 tUSDC deposited in escrow.",
                            icon: "wallet",
                          },
                          {
                            title: "Bid received",
                            description:
                              "Encrypted content stored. Three bids received.",
                            icon: "lock",
                          },
                        ].map((event, index) => (
                          <div key={event.title}>
                            <span className="review-activity-index">
                              {index + 1}
                            </span>
                            <div>
                              <strong>{event.title}</strong>
                              <p>{event.description}</p>
                            </div>
                            <Icon
                              name={
                                event.icon as "document" | "wallet" | "lock"
                              }
                              size={19}
                            />
                          </div>
                        ))}
                      </div>
                    ),
                  },
                ]}
              />
            </div>
          </section>

          <section id="actions" className="review-section">
            <div className="review-section-heading">
              <div>
                <h2>Buttons &amp; dialogs</h2>
                <p>Primary actions, supporting actions and confirmation.</p>
              </div>
              <span className="review-specimen-label">
                Buttons / Dialogs / Copy
              </span>
            </div>
            <div className="review-actions-grid">
              <div className="review-action-primary">
                <span className="review-example-label">
                  Primary and secondary
                </span>
                <div>
                  <Button onClick={() => setDialog("create")}>
                    <Icon name="plus" size={17} />
                    Create tender
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => setDialog("rubric")}
                  >
                    View rubric
                  </Button>
                </div>
              </div>
              <div className="review-action-utility">
                <span className="review-example-label">Copy and download</span>
                <div>
                  <CopyButton
                    value={JSON.stringify(PREVIEW_CRITERIA, null, 2)}
                    label="Copy rubric"
                  />
                  <Button
                    variant="ghost"
                    size="small"
                    onClick={() => {
                      setBid({
                        price: "12000",
                        deliveryDays: "21",
                        methodology: "Example methodology",
                      });
                      setReceiptSaved(false);
                      setDialog("bid");
                    }}
                  >
                    <Icon name="download" size={16} />
                    Receipt preview
                  </Button>
                </div>
              </div>
              <div className="review-action-states">
                <span className="review-example-label">
                  Busy and unavailable
                </span>
                <div>
                  <Button loading size="small">
                    Encrypting bid
                  </Button>
                  <Button disabled variant="secondary" size="small">
                    Submit bid
                  </Button>
                </div>
                <p>Loading prevents repeated activation.</p>
              </div>
            </div>
            {savedDraft && (
              <div className="review-draft-notice">
                <Notice live tone="success" title="Preview draft saved">
                  {savedDraft}. This draft stays in the current page session.
                </Notice>
              </div>
            )}
          </section>

          <section id="inputs" className="review-section">
            <div className="review-section-heading">
              <div>
                <h2>Forms &amp; validation</h2>
                <p>Bid details, field limits and validation errors.</p>
              </div>
              <span className="review-specimen-label">
                Inputs / Select / Checkbox
              </span>
            </div>
            <div className="review-input-grid">
              <PreviewBidForm onReview={reviewBid} />
              <div className="review-field-states">
                <h3>Validation examples</h3>
                <p>An over-budget price and fields fixed at creation.</p>
                <TextField
                  label="Invalid price example"
                  value="18,000"
                  readOnly
                  trailing="tUSDC"
                  error="Price exceeds the 15,000 tUSDC budget cap."
                />
                <TextField
                  label="Buyer account"
                  defaultValue="buyer.example.testnet"
                  disabled
                  hint="The buyer is fixed after creation."
                />
                <SelectField
                  label="Settlement asset"
                  disabled
                  value="tusdc"
                  options={[{ value: "tusdc", label: "Test USDC (tUSDC)" }]}
                />
                <div className="review-field-note">
                  <p>
                    In the app, bid content is encrypted in the browser before
                    submission.
                  </p>
                </div>
              </div>
            </div>
          </section>

          <section id="evaluation" className="review-section">
            <div className="review-section-heading">
              <div>
                <h2>Ranking &amp; evidence</h2>
                <p>Recorded scores and the committee decision.</p>
              </div>
              <Badge tone="success" icon="check">
                Recorded result
              </Badge>
            </div>
            <div className="review-ranking ui-paper">
              <div className="review-ranking-heading">
                <div>
                  <h3>Evaluation results</h3>
                  <p>
                    Tender {DEMO_TENDER.id} / Recorded testnet demonstration
                  </p>
                </div>
                <a
                  href={explorerTx(DEMO_TENDER.proposeAwardTx)}
                  target="_blank"
                  rel="noreferrer"
                  className="ui-text-link"
                >
                  Award record
                  <Icon name="external" size={15} />
                </a>
              </div>
              <RankingTable
                rows={DEMO_RANKING}
                caption={`Scores from tender ${DEMO_TENDER.id}'s accepted on-chain result. Model scores vary between runs.`}
              />
              <div className="review-ranking-footer">
                <p>
                  Models score written criteria. Code checks and ranks. The
                  committee awards.
                </p>
              </div>
            </div>
          </section>

          <section id="feedback" className="review-section">
            <div className="review-section-heading">
              <div>
                <h2>Feedback &amp; status</h2>
                <p>Pending requests, receipts and recovery.</p>
              </div>
              <span className="review-specimen-label">
                Status / Notices / Empty states
              </span>
            </div>
            <div className="review-statuses">
              <Badge tone="violet">Bidding open</Badge>
              <Badge tone="neutral">Closed</Badge>
              <Badge tone="violet">Evaluating</Badge>
              <Badge tone="neutral">Evaluated</Badge>
              <Badge tone="success" icon="check">
                Awarded
              </Badge>
              <Badge tone="success" icon="check">
                Paid
              </Badge>
              <Badge tone="warning" icon="warning">
                Flagged
              </Badge>
              <Badge tone="danger" icon="close">
                Failed
              </Badge>
            </div>
            <div className="review-feedback-demo">
              <div className="review-feedback-heading">
                <h3>Transaction feedback</h3>
                <span>State previews</span>
              </div>
              <Tabs
                label="Transaction feedback preview"
                value={feedbackTab}
                onChange={setFeedbackTab}
                items={[
                  {
                    id: "pending",
                    label: "Waiting",
                    content: <TransactionNotice state="pending" />,
                  },
                  {
                    id: "confirmed",
                    label: "Confirmed",
                    content: <TransactionNotice state="confirmed" />,
                  },
                  {
                    id: "rejected",
                    label: "Declined",
                    content: (
                      <TransactionNotice
                        state="rejected"
                        retry={
                          <Button
                            variant="secondary"
                            size="small"
                            onClick={(event) => {
                              const tabs =
                                event.currentTarget.closest(".ui-tabs");
                              setFeedbackTab("pending");
                              requestAnimationFrame(() => {
                                tabs
                                  ?.querySelector<HTMLButtonElement>(
                                    '[role="tab"][aria-selected="true"]',
                                  )
                                  ?.focus();
                              });
                            }}
                          >
                            <Icon name="refresh" size={14} />
                            Try again
                          </Button>
                        }
                      />
                    ),
                  },
                ]}
              />
            </div>
            <div className="review-empty-grid">
              <div>
                <span className="review-example-label">Empty</span>
                <EmptyState
                  title="No tenders yet"
                  description="Publish the scope and rubric, then open bidding to suppliers."
                  action={
                    <Button
                      variant="secondary"
                      size="small"
                      onClick={() => setDialog("create")}
                    >
                      <Icon name="plus" size={15} />
                      Create tender
                    </Button>
                  }
                />
              </div>
              <div>
                <span className="review-example-label">Loading</span>
                <SkeletonRows />
                <p className="review-skeleton-note">
                  A stable layout while tender data arrives.
                </p>
              </div>
            </div>
          </section>
          <footer className="review-footer">
            <div>
              <BrandMark />
              <span>
                {BRAND.name}
                <span>Component library / v0.2</span>
              </span>
            </div>
            <ButtonLink href="/" variant="ghost" size="small">
              Back to the landing page
              <Icon name="external" size={15} />
            </ButtonLink>
          </footer>
        </main>
      </div>
      <Dialog
        open={dialog !== null}
        onClose={() => setDialog(null)}
        title={dialogTitle}
        description={dialogDescription}
      >
        {dialog === "typography" ? (
          <>
            <TypographyPreview value={typography} onChange={setTypography} />
            <div className="ui-dialog-actions">
              <Button onClick={() => setDialog(null)}>
                Back to components
              </Button>
            </div>
          </>
        ) : dialog === "create" ? (
          <form
            className="review-create-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (!draftName.trim()) return;
              setSavedDraft(draftName.trim());
              setDialog(null);
            }}
          >
            <TextField
              label="Tender title"
              value={draftName}
              onChange={(event) => setDraftName(event.target.value)}
              maxLength={160}
              required
            />
            <div className="ui-dialog-actions">
              <Button variant="secondary" onClick={() => setDialog(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={!draftName.trim()}>
                Save preview draft
              </Button>
            </div>
          </form>
        ) : dialog === "rubric" ? (
          <>
            <RubricPreview />
            <div className="ui-dialog-actions">
              <CopyButton
                value={JSON.stringify(PREVIEW_CRITERIA, null, 2)}
                label="Copy rubric"
              />
              <Button onClick={() => setDialog(null)}>Done</Button>
            </div>
          </>
        ) : dialog === "bid" && bid ? (
          <>
            <dl className="review-summary">
              <div>
                <dt>Bid price</dt>
                <dd>{bid.price} tUSDC</dd>
              </div>
              <div>
                <dt>Delivery</dt>
                <dd>{bid.deliveryDays} days</dd>
              </div>
              <div>
                <dt>Methodology</dt>
                <dd>{bid.methodology}</dd>
              </div>
            </dl>
            {receiptSaved && (
              <Notice live tone="success" title="Preview receipt prepared">
                Your browser was asked to save the JSON file.
              </Notice>
            )}
            <div className="ui-dialog-actions">
              <Button variant="secondary" onClick={() => setDialog(null)}>
                Back to preview
              </Button>
              <Button onClick={downloadReceipt}>
                <Icon name="download" size={16} />
                Save preview receipt
              </Button>
            </div>
          </>
        ) : (
          <>
            <dl className="review-summary">
              <div>
                <dt>Tender</dt>
                <dd>{tender.title}</dd>
              </div>
              <div>
                <dt>Budget cap</dt>
                <dd>
                  {tender.budget} {tender.currency}
                </dd>
              </div>
              <div>
                <dt>State</dt>
                <dd>
                  {tenderState === "sealed"
                    ? "Bidding open"
                    : tenderState === "evaluated"
                      ? "Evaluated"
                      : "Paid"}
                </dd>
              </div>
              <div>
                <dt>Deadline</dt>
                <dd>12 November 2026, 18:00 UTC</dd>
              </div>
            </dl>
            <div className="ui-dialog-actions">
              <Button onClick={() => setDialog(null)}>Close preview</Button>
            </div>
          </>
        )}
      </Dialog>
    </div>
  );
}
