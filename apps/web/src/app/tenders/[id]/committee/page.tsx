import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTender } from "../../../../lib/near/views.ts";
import { parseRubric, tenderTitle } from "../../../../lib/tender/view-model.ts";
import { CommitteePanel } from "../../../../components/app/committee-panel.tsx";
import { Icon } from "../../../../components/ui/icon.tsx";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Committee",
};

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function CommitteePage({ params }: PageProps) {
  const { id } = await params;
  if (!/^[0-9]{1,9}$/.test(id)) notFound();
  const tenderId = Number(id);

  const tender = await getTender(tenderId);
  if (tender === null) notFound();
  const { rubric } = parseRubric(tender.rubric_json);

  // A proposal is only possible while the contract will take one. The panel still opens the report
  // in any later state, because a member reading what was decided is as legitimate as deciding.
  const canPropose = tender.status === "Evaluated";
  const award = tender.award;
  const pending =
    award !== null && award.approved_at_ns === null
      ? {
          bidIndex: award.bid_index,
          amountMinor: award.amount,
          rationale: award.rationale,
          approvals: award.approvals,
        }
      : null;

  return (
    <div className="page">
      <nav className="breadcrumbs" aria-label="Breadcrumb">
        <Link href="/tenders">Tenders</Link>
        <Icon name="chevron" size={15} />
        <Link href={`/tenders/${id}`}>Tender {id}</Link>
        <Icon name="chevron" size={15} />
        <span aria-current="page">Committee</span>
      </nav>

      <header className="page-head">
        <p className="page-eyebrow">
          <span className="ui-reference">Tender {id}</span>
        </p>
        <h1>{tenderTitle(rubric, tenderId)}</h1>
        <p className="page-lead">
          The committee is the only group that can read every proposal in full, and the only one
          that can award. Code decided eligibility and the scores; this decision is a human one,
          and the contract records who made it and why.
        </p>
        <p className="page-actions">
          <Link className="ui-button ui-button--quiet" href={`/tenders/${id}`}>
            <Icon name="arrow" />
            Back to the tender
          </Link>
        </p>
      </header>

      <CommitteePanel
        tenderId={tenderId}
        budgetCapMinor={tender.budget_cap}
        lapsed={award?.lapsed ?? []}
        canPropose={canPropose}
        pending={pending}
        approvalsRequired={tender.approvals_required}
      />
    </div>
  );
}
