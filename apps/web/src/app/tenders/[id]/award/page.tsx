import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTender, getBids } from "../../../../lib/near/views.ts";
import { parseRubric, tenderTitle } from "../../../../lib/tender/view-model.ts";
import { AwardPanel } from "../../../../components/app/award-panel.tsx";
import { Icon } from "../../../../components/ui/icon.tsx";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Award",
};

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function AwardPage({ params }: PageProps) {
  const { id } = await params;
  if (!/^[0-9]{1,9}$/.test(id)) notFound();
  const tenderId = Number(id);

  const tender = await getTender(tenderId);
  if (tender === null) notFound();
  const { rubric } = parseRubric(tender.rubric_json);
  const award = tender.award;

  // `bid_index` indexes the frozen set, not a storage slot (D-033). Resolving it any other way
  // names the wrong bidder as soon as a bid has been withdrawn before close.
  let winner: string | null = null;
  if (award?.bid_index != null && tender.frozen !== null) {
    const slot = tender.frozen.slots[award.bid_index];
    if (slot !== undefined) {
      const bids = await getBids(tenderId);
      winner = bids.find((b) => b.slot === slot)?.bidder ?? null;
    }
  }

  return (
    <div className="page award-page">
      <nav className="breadcrumbs" aria-label="Breadcrumb">
        <Link href="/tenders">Tenders</Link>
        <Icon name="chevron" size={15} />
        <Link href={`/tenders/${id}`}>Tender {id}</Link>
        <Icon name="chevron" size={15} />
        <span aria-current="page">Award</span>
      </nav>

      <header className="page-head">
        <p className="page-eyebrow">
          <span className="ui-reference">Tender {id}</span>
        </p>
        <h1>Award & payout</h1>
        <p className="award-tender-title">{tenderTitle(rubric, tenderId)}</p>
      </header>

      <AwardPanel
        tenderId={tenderId}
        winner={winner}
        amountMinor={award?.amount ?? "0"}
        rationale={award?.rationale ?? ""}
        deviation={award?.deviation ?? false}
        approvals={award?.approvals ?? []}
        approvalsRequired={tender.approvals_required}
        approvedAtNs={award?.approved_at_ns ?? null}
        acceptByNs={award?.accept_by_ns ?? null}
        payoutState={award?.payout_state ?? "None"}
        payoutAccount={award?.payout && "Near" in award.payout ? award.payout.Near.account : null}
        status={tender.status}
      />
    </div>
  );
}
