import { FLAGS, type FlagName } from "@tender/shared";
import { Badge } from "../ui/badge.tsx";
import { bpToString } from "../../config/evidence.ts";

export type RankingRow = {
  rank: number;
  label: string;
  note: string;
  totalBp: number;
  outcome: "awarded" | "ranked" | "flagged";
  /** Every flag the on-chain result set for this bid, not just the first (decodeFlags). */
  flags?: readonly FlagName[];
};

export function RankingTable({
  rows,
  caption,
}: {
  rows: readonly RankingRow[];
  caption: string;
}) {
  return (
    <div
      className="ui-table-scroll"
      role="region"
      aria-label="Bid ranking"
      tabIndex={0}
    >
      <table className="ranking-table">
        <caption>{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Rank</th>
            <th scope="col">Supplier bid</th>
            <th scope="col">Score / 100</th>
            <th scope="col">Outcome</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.rank} data-awarded={row.outcome === "awarded"}>
              <td>
                <span className="ranking-position">{row.rank}</span>
              </td>
              <th scope="row">
                <strong>{row.label}</strong>
                <span>{row.note}</span>
              </th>
              <td>
                <span
                  className="ranking-score"
                  title={`${row.totalBp} basis points, from the on-chain result`}
                >
                  {bpToString(row.totalBp)}
                </span>
                <meter
                  min={0}
                  max={10000}
                  value={row.totalBp}
                  aria-label={`${row.label} score`}
                />
              </td>
              <td>
                <Badge
                  tone={
                    row.outcome === "awarded"
                      ? "success"
                      : row.outcome === "flagged"
                        ? "warning"
                        : "neutral"
                  }
                  icon={
                    row.outcome === "awarded"
                      ? "check"
                      : row.outcome === "flagged"
                        ? "warning"
                        : undefined
                  }
                >
                  {row.outcome === "awarded"
                    ? "Awarded"
                    : row.outcome === "flagged"
                      ? "Flagged"
                      : "Ranked"}
                </Badge>
                {row.flags?.map((flag) => (
                  <details className="ranking-flag" key={flag}>
                    <summary>Why flagged?</summary>
                    <p>
                      {FLAGS[flag].meaning} {FLAGS[flag].effect}
                    </p>
                  </details>
                ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
