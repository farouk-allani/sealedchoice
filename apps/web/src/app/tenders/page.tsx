import type { Metadata } from "next";
import Link from "next/link";
import { TOKEN_DECIMALS, TOKEN_SYMBOL } from "../../config/demo.ts";
import { listTenders } from "../../lib/near/views.ts";
import type { Tender } from "../../lib/near/schemas.ts";
import { formatUnits, hasPassed, nsToDate } from "../../lib/tender/format.ts";
import { statusOf } from "../../lib/tender/status.ts";
import { parseRubric, tenderTitle } from "../../lib/tender/view-model.ts";
import { EmptyState } from "../../components/ui/empty-state.tsx";
import { TenderCard } from "../../components/app/tender-card.tsx";
import type { TenderCardData } from "../../components/app/tender-card.tsx";

export const metadata: Metadata = {
  title: "Tenders",
  description: "Every tender on the contract, with its status and deadline.",
};

// Chain state changes without a deploy, so this page is never prerendered.
export const dynamic = "force-dynamic";

function toCard(tender: Tender): TenderCardData {
  const { rubric } = parseRubric(tender.rubric_json);
  return {
    reference: `Tender ${tender.id}`,
    title: tenderTitle(rubric, tender.id),
    buyer: tender.buyer,
    description: statusOf(tender.status).detail,
    status: tender.status,
    budget: formatUnits(tender.budget_cap, TOKEN_DECIMALS),
    currency: TOKEN_SYMBOL,
    bids: tender.active_slots.length,
    deadlineLabel: hasPassed(tender.deadline_ns) ? "Closed" : "Closes",
    deadline: nsToDate(tender.deadline_ns).toISOString(),
  };
}

export default async function TendersPage() {
  let tenders: Tender[] = [];
  let error: string | null = null;
  try {
    tenders = await listTenders({ limit: 50 });
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  return (
    <>
      <div className="page-head">
        <h1>Tenders</h1>
        <p>
          Every tender this contract holds. Anyone can read all of it: the rubric was published
          before bidding, the bids are sealed until the deadline, and the result is recorded on
          chain. No wallet is needed to look.
        </p>
      </div>

      {error ? (
        <div className="page-error" role="alert">
          <h2>The chain could not be read</h2>
          <p>{error}</p>
          <p>Nothing is wrong with the tenders themselves. Reload to try the RPC again.</p>
        </div>
      ) : tenders.length === 0 ? (
        <EmptyState
          icon="document"
          title="No tenders yet"
          description="Once a buyer creates one, it appears here with its rubric and deadline."
        />
      ) : (
        <div className="tender-grid">
          {[...tenders].reverse().map((tender) => (
            <TenderCard
              key={tender.id}
              tender={toCard(tender)}
              action={
                <Link
                  className="ui-button ui-button--secondary ui-button--small"
                  href={`/tenders/${tender.id}`}
                >
                  Open tender
                </Link>
              }
            />
          ))}
        </div>
      )}
    </>
  );
}
