import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTender } from "../../../../lib/near/views.ts";
import { formatUtc, hasPassed } from "../../../../lib/tender/format.ts";
import { canBid, statusOf } from "../../../../lib/tender/status.ts";
import { parseRubric, tenderTitle } from "../../../../lib/tender/view-model.ts";
import { BidForm } from "../../../../components/app/bid-form.tsx";
import { Icon } from "../../../../components/ui/icon.tsx";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Submit a sealed bid",
  robots: { index: false, follow: false },
};

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function BidPage({ params }: PageProps) {
  const { id } = await params;
  if (!/^[0-9]{1,9}$/.test(id)) notFound();
  const tenderId = Number(id);

  let tender: Awaited<ReturnType<typeof getTender>> = null;
  let error: string | null = null;
  try {
    tender = await getTender(tenderId);
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  if (error) {
    return (
      <div className="page-error" role="alert">
        <h2>The chain could not be read</h2>
        <p>{error}</p>
      </div>
    );
  }
  if (!tender) notFound();

  const { rubric } = parseRubric(tender.rubric_json);
  const status = statusOf(tender.status);
  const closed = hasPassed(tender.deadline_ns);

  const head = (
    <>
      <nav className="breadcrumbs" aria-label="Breadcrumb">
        <Link href="/tenders">Tenders</Link>
        <Icon name="chevron" size={15} />
        <Link href={`/tenders/${tender.id}`}>Tender {tender.id}</Link>
        <Icon name="chevron" size={15} />
        <span aria-current="page">Your bid</span>
      </nav>
      <div className="page-head">
        <h1>Prepare your sealed bid</h1>
        <p>{tenderTitle(rubric, tender.id)}</p>
      </div>
    </>
  );

  // The contract refuses a late bid anyway (I2). Saying so here saves a wallet prompt and a fee.
  if (!canBid(tender) || closed || !tender.tender_pubkey) {
    return (
      <>
        {head}
        <div className="panel ui-paper">
          <h2>This tender is not taking bids</h2>
          <p>{status.detail}</p>
          {closed && (
            <p>The deadline passed on {formatUtc(tender.deadline_ns)}.</p>
          )}
          <div className="form-actions">
            <Link
              className="ui-button ui-button--primary ui-button--medium"
              href={`/tenders/${tender.id}`}
            >
              Back to the tender
            </Link>
          </div>
        </div>
      </>
    );
  }

  if (!rubric) {
    return (
      <>
        {head}
        <div className="page-error" role="alert">
          <h2>The rubric could not be read</h2>
          <p>
            This page will not take a bid against a rubric it cannot show you in
            full. Open the tender to see the stored rubric as it is.
          </p>
        </div>
      </>
    );
  }

  return (
    <>
      {head}
      <div className="bid-columns">
        <BidForm
          tenderId={tender.id}
          tenderPubkey={tender.tender_pubkey}
          budgetCapMinor={tender.budget_cap}
          bondYocto={tender.bond}
          maxDeliveryDays={rubric.max_delivery_days}
          deadlineUtc={formatUtc(tender.deadline_ns)}
        />

        <aside className="panel ui-paper">
          <h2>What you are bidding against</h2>
          <p>{rubric.scope}</p>
          <dl className="facts">
            {rubric.criteria.map((criterion) => (
              <div key={criterion.id} style={{ display: "contents" }}>
                <dt>
                  {criterion.type === "price_lowest_ratio"
                    ? "Price"
                    : criterion.id}
                </dt>
                <dd>
                  {criterion.weight_bp / 100}% of the total
                  {criterion.type === "qualitative" && (
                    <> ({criterion.question})</>
                  )}
                </dd>
              </div>
            ))}
          </dl>
          <p className="panel-note">
            Eligibility is checked by code before anything is scored: price
            within the cap, delivery within {rubric.max_delivery_days} days,
            both text fields present and inside their byte limits, and the
            account inside the bid matching the one that submits it.
          </p>
          <p className="panel-note">
            Instructions aimed at the scorer belong in no bid. Text that reads
            as one is flagged for the committee and the bid is read by a human.
          </p>
        </aside>
      </div>
    </>
  );
}
