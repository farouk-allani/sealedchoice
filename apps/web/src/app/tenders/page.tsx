import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import {
  FEATURED_TENDER_ID,
  TOKEN_DECIMALS,
  TOKEN_SYMBOL,
} from "../../config/demo.ts";
import { listTenders } from "../../lib/near/views.ts";
import type { Tender } from "../../lib/near/schemas.ts";
import { formatUnits, hasPassed, nsToDate } from "../../lib/tender/format.ts";
import { statusOf } from "../../lib/tender/status.ts";
import { parseRubric, tenderTitle } from "../../lib/tender/view-model.ts";
import { EmptyState } from "../../components/ui/empty-state.tsx";
import { TenderDirectory } from "../../components/app/tender-directory.tsx";
import { Icon } from "../../components/ui/icon.tsx";
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
      <div className="directory-intro">
        <div className="page-head">
          <h1>
            Clear briefs.
            <br />
            Sealed bids.
          </h1>
          <p>
            Find a tender, understand how it will be scored, and send a sealed
            proposal. Every brief is published before bidding begins.
          </p>
          <Link
            className="ui-button ui-button--primary ui-button--medium"
            href="/tenders/new"
          >
            <Icon name="plus" size={18} /> Create a tender
          </Link>
        </div>
        <Link href={`/tenders/${FEATURED_TENDER_ID}`} className="demo-feature">
          <div>
            <span className="demo-feature-label">New to SealedChoice?</span>
            <h2>
              See a tender
              <br />
              from bid to payout.
            </h2>
            <p>Explore a real, completed tender on testnet.</p>
            <span className="demo-feature-action">
              Explore the demo <Icon name="arrow" size={17} />
            </span>
          </div>
          <Image
            src="/visuals/blender/result-ranked-vault-poster.webp"
            width={240}
            height={204}
            alt=""
            unoptimized
          />
        </Link>
      </div>

      {error ? (
        <div className="page-error" role="alert">
          <h2>The chain could not be read</h2>
          <p>{error}</p>
          <p>
            Nothing is wrong with the tenders themselves. Reload to try the RPC
            again.
          </p>
          <Link
            className="ui-button ui-button--secondary ui-button--small"
            href="/tenders"
          >
            Try again
          </Link>
        </div>
      ) : tenders.length === 0 ? (
        <EmptyState
          icon="document"
          title="No tenders yet"
          description="Once a buyer creates one, it appears here with its rubric and deadline."
        />
      ) : (
        <TenderDirectory
          tenders={tenders.map((tender) => ({
            ...toCard(tender),
            id: tender.id,
            acceptingBids:
              tender.status === "Open" && !hasPassed(tender.deadline_ns),
          }))}
        />
      )}
    </>
  );
}
