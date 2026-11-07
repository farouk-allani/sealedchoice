import Image from "next/image";
import type { ReactNode } from "react";
import { Badge } from "../ui/badge.tsx";
import type { BadgeTone } from "../ui/badge.tsx";

export type TenderCardData = {
  reference: string;
  title: string;
  buyer: string;
  description: string;
  status: "sealed" | "evaluated" | "paid";
  budget: string;
  currency: string;
  bids: number;
  deadlineLabel: string;
  deadline: string;
};

const statuses = {
  sealed: { label: "Bidding open", tone: "violet" },
  evaluated: { label: "Evaluated", tone: "neutral" },
  paid: { label: "Paid", tone: "success" },
} as const satisfies Record<
  TenderCardData["status"],
  { label: string; tone: BadgeTone }
>;

export function TenderCard({
  tender,
  action,
  artwork = false,
}: {
  tender: TenderCardData;
  action: ReactNode;
  artwork?: boolean;
}) {
  const status = statuses[tender.status];
  return (
    <article
      className={`tender-card ui-paper ${artwork ? "tender-card--featured" : ""}`}
    >
      {artwork && (
        <Image
          className="tender-card-art"
          src="/visuals/blender/result-ranked-vault-poster.webp"
          width={240}
          height={204}
          alt=""
          unoptimized
        />
      )}
      <div className="tender-card-top">
        <span className="ui-reference">{tender.reference}</span>
        <Badge tone={status.tone}>{status.label}</Badge>
      </div>
      <div className="tender-card-copy">
        <p className="tender-card-buyer">{tender.buyer}</p>
        <h3>{tender.title}</h3>
        <p>{tender.description}</p>
      </div>
      <dl className="tender-card-facts">
        <div>
          <dt>Budget cap</dt>
          <dd>
            {tender.budget} <span>{tender.currency}</span>
          </dd>
        </div>
        <div>
          <dt>Sealed bids</dt>
          <dd>{tender.bids}</dd>
        </div>
      </dl>
      <div className="tender-card-bottom">
        <span>
          {tender.deadlineLabel}{" "}
          <time dateTime={tender.deadline}>
            {new Intl.DateTimeFormat("en-GB", {
              day: "numeric",
              month: "short",
              timeZone: "UTC",
            }).format(new Date(tender.deadline))}
          </time>
        </span>
        {action}
      </div>
    </article>
  );
}
