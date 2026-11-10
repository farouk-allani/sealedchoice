"use client";

import { useState } from "react";
import type { AttackRecord } from "@tender/shared";
import { attackRequestUrl, attackTransactionUrl } from "../../config/attacks.ts";
import { Badge } from "../ui/badge.tsx";
import { Icon } from "../ui/icon.tsx";

type Filter = "all" | "refused" | "flagged";

export function AttackRecords({ records }: { records: AttackRecord[] }) {
  const [filter, setFilter] = useState<Filter>("all");
  const flagged = records.filter((record) => record.layer === "evaluator").length;
  const filters: { id: Filter; label: string; count: number }[] = [
    { id: "all", label: "All attempts", count: records.length },
    { id: "refused", label: "Refused", count: records.length - flagged },
    { id: "flagged", label: "Flagged for review", count: flagged },
  ];
  const visible = records.filter((record) => filter === "all" || (filter === "flagged") === (record.layer === "evaluator"));

  return (
    <section className="attack-results" aria-labelledby="attack-results-title">
      <div className="attack-results-heading">
        <h2 id="attack-results-title">Recorded attempts</h2>
        <p aria-live="polite">Showing {visible.length} of {records.length}</p>
      </div>
      <div className="attack-filters" role="group" aria-label="Filter recorded attempts">
        {filters.map((item) => (
          <button key={item.id} type="button" aria-pressed={filter === item.id} aria-controls="attack-records" onClick={() => setFilter(item.id)}>
            {item.label}<span>{item.count}</span>
          </button>
        ))}
      </div>
      <ol className="attack-records" id="attack-records" aria-label="Recorded attack attempts">
        {visible.map((record) => {
          const isFlagged = record.layer === "evaluator";
          const layer = record.layer === "runtime" ? "NEAR contract runtime" : record.layer === "outlayer" ? "OutLayer secret access" : isFlagged ? "Evaluator code" : "Tender contract";
          return (
            <li key={record.id} className="panel ui-paper" value={record.id}>
              <div className="attack-record-heading">
                <span className="ui-reference">Attempt {String(record.id).padStart(2, "0")}</span>
                <Badge tone={isFlagged ? "warning" : "success"} icon={isFlagged ? "warning" : "check"}>{isFlagged ? "Flagged for review" : "Refused"}</Badge>
              </div>
              <h3>{record.title}</h3>
              <p className="attack-description">{record.detail}</p>
              <div className="attack-enforcement"><Icon name={isFlagged ? "warning" : "shield"} size={16} /><span>{layer}</span></div>
              <details className="attack-evidence">
                <summary>Technical evidence <Icon name="down" size={16} /></summary>
                <dl className="attack-facts">
                  <div><dt>Observed outcome</dt><dd><code>{record.outcome}</code></dd></div>
                  <div><dt>Signed by</dt><dd className="mono">{record.signer}</dd></div>
                </dl>
                {record.request_id && (record.layer === "outlayer"
                  ? <p>OutLayer request {record.request_id}. Refusal recorded in transaction receipts.</p>
                  : <a className="inline-link" href={attackRequestUrl(record.request_id)} target="_blank" rel="noreferrer noopener">OutLayer request {record.request_id} <Icon name="external" size={15} /></a>)}
              </details>
              <a className="attack-transaction" href={attackTransactionUrl(record.tx_hash)} target="_blank" rel="noreferrer noopener">
                <span>Inspect transaction</span><span className="mono">{record.tx_hash.slice(0, 8)}<Icon name="external" size={16} /></span>
              </a>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
