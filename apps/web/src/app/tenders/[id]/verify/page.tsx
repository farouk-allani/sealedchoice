import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTender } from "../../../../lib/near/views.ts";
import { parseRubric, tenderTitle } from "../../../../lib/tender/view-model.ts";
import { VerifyPanel } from "../../../../components/app/verify-panel.tsx";
import { Icon } from "../../../../components/ui/icon.tsx";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Verify this tender",
};

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function VerifyPage({ params }: PageProps) {
  const { id } = await params;
  if (!/^[0-9]{1,9}$/.test(id)) notFound();
  const tenderId = Number(id);

  // The page shell is server-rendered so it reads without JavaScript and the title is real. The
  // checks themselves run in the reader's browser, which is the whole point of them.
  let title = `Tender ${id}`;
  let missing = false;
  try {
    const tender = await getTender(tenderId);
    if (tender === null) missing = true;
    else {
      const { rubric } = parseRubric(tender.rubric_json);
      title = tenderTitle(rubric, tenderId);
    }
  } catch {
    // A failed read here must not hide the panel: it fetches the chain itself and will report
    // its own error in a line a reader can act on.
  }
  if (missing) notFound();

  return (
    <div className="page">
      <nav className="breadcrumb" aria-label="Breadcrumb">
        <Link href="/tenders">Tenders</Link>
        <Link href={`/tenders/${id}`}>Tender {id}</Link>
        <span aria-current="page">Verify</span>
      </nav>

      <header className="page-head">
        <p className="page-eyebrow">
          <span className="ui-reference">Tender {id}</span>
        </p>
        <h1>{title}</h1>
        <p className="page-lead">
          Everything below is checked from public evidence: the contract on NEAR, the published
          evidence bundle and the evaluator build the tender pinned before bidding opened. Nothing
          here asks you to trust this site.
        </p>
        <p className="page-actions">
          <Link className="ui-button ui-button--quiet" href={`/tenders/${id}`}>
            <Icon name="arrow" />
            Back to the tender
          </Link>
        </p>
      </header>

      <VerifyPanel tenderId={tenderId} />
    </div>
  );
}
