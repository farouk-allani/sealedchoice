"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { TenderCard } from "./tender-card.tsx";
import type { TenderCardData } from "./tender-card.tsx";
import { Icon } from "../ui/icon.tsx";
import { Button } from "../ui/button.tsx";
import { SelectField } from "../ui/select-field.tsx";

type DirectoryTender = TenderCardData & { id: number; acceptingBids: boolean };
type Filter = "all" | "open" | "review" | "finished";
const filters: { id: Filter; label: string }[] = [
  { id: "all", label: "All tenders" },
  { id: "open", label: "Open for bids" },
  { id: "review", label: "In review" },
  { id: "finished", label: "Completed" },
];

function matches(tender: DirectoryTender, filter: Filter) {
  if (filter === "open") return tender.acceptingBids;
  if (filter === "review")
    return ["Evaluating", "Evaluated", "Awarded", "PayingOut"].includes(
      tender.status,
    );
  if (filter === "finished")
    return [
      "Paid",
      "ClosedNoAward",
      "Cancelled",
      "NoBids",
      "EvalFailed",
      "Failed",
    ].includes(tender.status);
  return true;
}

export function TenderDirectory({ tenders }: { tenders: DirectoryTender[] }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState("newest");
  const visible = useMemo(() => {
    const term = query.trim().toLowerCase();
    return tenders
      .filter(
        (tender) =>
          matches(tender, filter) &&
          `${tender.title} ${tender.buyer} ${tender.reference}`
            .toLowerCase()
            .includes(term),
      )
      .sort((a, b) =>
        sort === "deadline"
          ? Number(b.acceptingBids) - Number(a.acceptingBids) ||
            Date.parse(a.deadline) - Date.parse(b.deadline)
          : b.id - a.id,
      );
  }, [tenders, query, filter, sort]);

  return (
    <section className="directory" aria-labelledby="directory-heading">
      <div className="directory-heading">
        <h2 id="directory-heading">
          Explore tenders <span>{tenders.length}</span>
        </h2>
        <p>No wallet needed to explore</p>
      </div>
      <div className="directory-tools">
        <div className="directory-search">
          <Icon name="document" size={18} />
          <label className="ui-sr-only" htmlFor="tender-search">
            Search tenders
          </label>
          <input
            id="tender-search"
            type="search"
            placeholder="Search by title, buyer or tender number"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <SelectField
          label="Sort by"
          value={sort}
          onValueChange={setSort}
          options={[
            { value: "newest", label: "Newest first" },
            { value: "deadline", label: "Closing soonest" },
          ]}
        />
      </div>
      <div className="directory-filter-row">
        <div
          className="directory-filters"
          role="group"
          aria-label="Filter tenders"
        >
          {filters.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={filter === item.id}
              onClick={() => setFilter(item.id)}
            >
              {item.label}
              <span>
                {tenders.filter((tender) => matches(tender, item.id)).length}
              </span>
            </button>
          ))}
        </div>
        <span className="directory-count" role="status">
          {visible.length} {visible.length === 1 ? "tender" : "tenders"}
          {query.trim() ? " found" : " shown"}
        </span>
      </div>
      {visible.length > 0 ? (
        <div className="tender-grid">
          {visible.map((tender) => (
            <TenderCard
              key={tender.id}
              tender={tender}
              action={
                <Link
                  className="ui-button ui-button--secondary ui-button--small"
                  href={`/tenders/${tender.id}`}
                >
                  View tender <Icon name="arrow" size={16} />
                </Link>
              }
            />
          ))}
        </div>
      ) : (
        <div className="directory-empty">
          <Icon name="document" size={30} />
          <h3>
            {filter === "open" && !query.trim()
              ? "No tenders are open for bids right now"
              : "No matching tenders"}
          </h3>
          <p>
            {filter === "open" && !query.trim()
              ? "You can still explore completed tenders and see how bids were evaluated."
              : "Try another title, buyer or status to find what you need."}
          </p>
          <Button
            variant="secondary"
            onClick={() => {
              setQuery("");
              setFilter("all");
            }}
          >
            Show all tenders
          </Button>
        </div>
      )}
    </section>
  );
}
