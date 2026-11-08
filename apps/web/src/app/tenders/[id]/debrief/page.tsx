import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTender } from "../../../../lib/near/views.ts";
import { parseRubric, tenderTitle } from "../../../../lib/tender/view-model.ts";
import { DebriefPanel } from "../../../../components/app/debrief-panel.tsx";
import { Icon } from "../../../../components/ui/icon.tsx";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Your debrief",
};

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function DebriefPage({ params }: PageProps) {
  const { id } = await params;
  if (!/^[0-9]{1,9}$/.test(id)) notFound();
  const tenderId = Number(id);

  // Server-rendered shell so the page has a real title and reads without JavaScript. Everything
  // that touches a key happens in the browser, which is the point of the page.
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
    // The panel fetches the chain itself and reports its own error in a line a reader can act on.
  }
  if (missing) notFound();

  return (
    <div className="page">
      <nav className="breadcrumb" aria-label="Breadcrumb">
        <Link href="/tenders">Tenders</Link>
        <Link href={`/tenders/${id}`}>Tender {id}</Link>
        <span aria-current="page">Your debrief</span>
      </nav>

      <header className="page-head">
        <p className="page-eyebrow">
          <span className="ui-reference">Tender {id}</span>
        </p>
        <h1>{title}</h1>
        <p className="page-lead">
          Every bidder gets the same detail about their own bid: what each model said, which quotes
          counted, what was capped and why, and where they came. It is encrypted to a key only your
          wallet can derive, so no one else can read it.
        </p>
        <p className="page-actions">
          <Link className="ui-button ui-button--quiet" href={`/tenders/${id}`}>
            <Icon name="arrow" />
            Back to the tender
          </Link>
          <Link className="ui-button ui-button--quiet" href={`/tenders/${id}/verify`}>
            <Icon name="arrow" />
            The public checks
          </Link>
        </p>
      </header>

      <DebriefPanel tenderId={tenderId} />
    </div>
  );
}
