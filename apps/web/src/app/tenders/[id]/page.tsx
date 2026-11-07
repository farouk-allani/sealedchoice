import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { TOKEN_DECIMALS, TOKEN_SYMBOL } from "../../../config/demo.ts";
import { CHAIN, explorerAccount } from "../../../config/evidence.ts";
import { getAttempts, getTenderDetail } from "../../../lib/near/views.ts";
import type { Attempt, BidView, Tender } from "../../../lib/near/schemas.ts";
import { attemptFailureReason, attemptOutcomeName } from "../../../lib/near/schemas.ts";
import {
  formatBp,
  formatNear,
  formatRelative,
  formatUnits,
  formatUtc,
  hasPassed,
  shortHash,
} from "../../../lib/tender/format.ts";
import { canBid, lifecycleSteps, statusOf } from "../../../lib/tender/status.ts";
import {
  parseResult,
  parseRubric,
  rankedBids,
  rankingRows,
  tenderTitle,
} from "../../../lib/tender/view-model.ts";
import { Badge } from "../../../components/ui/badge.tsx";
import { CopyButton } from "../../../components/ui/copy-button.tsx";
import { Lifecycle } from "../../../components/app/lifecycle.tsx";
import { RankingTable } from "../../../components/app/ranking-table.tsx";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
}

function parseId(raw: string): number | null {
  if (!/^[0-9]{1,9}$/.test(raw)) return null;
  const id = Number(raw);
  return id >= 1 ? id : null;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  const tenderId = parseId(id);
  if (tenderId === null) return { title: "Tender" };
  try {
    const detail = await getTenderDetail(tenderId);
    if (!detail) return { title: `Tender ${tenderId}` };
    const { rubric } = parseRubric(detail.tender.rubric_json);
    return {
      title: tenderTitle(rubric, tenderId),
      description: rubric?.scope?.slice(0, 160) ?? `Tender ${tenderId} on ${CHAIN.tenderContract}.`,
    };
  } catch {
    return { title: `Tender ${tenderId}` };
  }
}

function Hash({ value, label }: { value: string; label?: string }) {
  return (
    <span className="hash-row">
      <span className="mono" title={value}>
        {shortHash(value)}
      </span>
      <CopyButton value={value} label={label ?? "Copy"} compact />
    </span>
  );
}

function RubricPanel({ rubricJson }: { rubricJson: string }) {
  const { rubric, error } = parseRubric(rubricJson);

  if (!rubric) {
    return (
      <section className="panel ui-paper">
        <h2>Rubric</h2>
        <p>{error}</p>
        <pre className="mono">{rubricJson}</pre>
      </section>
    );
  }

  const total = rubric.criteria.reduce((sum, c) => sum + c.weight_bp, 0);

  return (
    <section className="panel ui-paper">
      <h2>Rubric</h2>
      <p>
        Published before bidding and fixed at creation. Its hash is what the evaluator echoes back,
        so a changed rubric could not produce an accepted result.
      </p>
      <p className="panel-note">{rubric.scope}</p>
      <div className="table-scroll">
        <table className="data-table">
          <caption>
            {rubric.criteria.length} criteria, weights summing to {formatBp(total)} percent
          </caption>
          <thead>
            <tr>
              <th scope="col">Criterion</th>
              <th scope="col">Scored by</th>
              <th scope="col">Weight</th>
            </tr>
          </thead>
          <tbody>
            {rubric.criteria.map((criterion) => (
              <tr key={criterion.id}>
                <th scope="row">
                  <strong>
                    {criterion.type === "price_lowest_ratio" ? "Price" : criterion.question}
                  </strong>
                  {criterion.type === "qualitative" && (
                    <ul className="criteria-anchors">
                      {Object.entries(criterion.anchors).map(([score, text]) => (
                        <li key={score}>
                          <b>{score}</b>
                          <span>{text}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </th>
                <td>
                  {criterion.type === "price_lowest_ratio"
                    ? "Code, from the price"
                    : "Models, checked by code"}
                </td>
                <td className="criteria-weight">{formatBp(criterion.weight_bp)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="panel-note">
        Qualitative criteria are scored by {rubric.models.length} models and aggregated by{" "}
        {rubric.aggregation.qualitative === "lower_median" ? "the lower median" : rubric.aggregation.qualitative}
        , needing at least {rubric.aggregation.min_valid_outputs} valid outputs. Price and the
        ranking are integer arithmetic, never a model.
      </p>
    </section>
  );
}

function BidsPanel({ tender, bids }: { tender: Tender; bids: BidView[] }) {
  const sealed = !hasPassed(tender.deadline_ns);
  if (bids.length === 0) {
    return (
      <section className="panel ui-paper">
        <h2>Bids</h2>
        <p>No bid has been submitted yet.</p>
      </section>
    );
  }

  return (
    <section className="panel ui-paper">
      <h2>Bids</h2>
      <p>
        {sealed
          ? "Every bid is encrypted to a key that exists only inside the TEE. What is on chain until the deadline is ciphertext and its hash."
          : "The bid set was frozen at close with a Merkle root, so nothing could be added or dropped afterwards."}
      </p>
      <div className="table-scroll">
        <table className="data-table">
          <caption>
            {bids.length} slot{bids.length === 1 ? "" : "s"} used, {tender.active_slots.length}{" "}
            still active
          </caption>
          <thead>
            <tr>
              <th scope="col">Slot</th>
              <th scope="col">Bidder</th>
              <th scope="col">Submitted</th>
              <th scope="col">Ciphertext</th>
              <th scope="col">Bond</th>
            </tr>
          </thead>
          <tbody>
            {bids.map((bid) => (
              <tr key={bid.slot}>
                <td>{bid.slot}</td>
                <td>
                  <a
                    className="inline-link"
                    href={explorerAccount(bid.bidder)}
                    target="_blank"
                    rel="noreferrer noopener"
                  >
                    {bid.bidder}
                  </a>
                  {bid.withdrawn && <> (withdrawn)</>}
                </td>
                <td title={formatUtc(bid.submitted_at_ns)}>{formatRelative(bid.submitted_at_ns)}</td>
                <td>
                  <Hash value={bid.ciphertext_sha256} label="Copy ciphertext hash" />
                  <span className="cell-sub">{bid.ciphertext_len} bytes</span>
                </td>
                <td>
                  {formatNear(bid.bond)} NEAR
                  {bid.bond_settled && <> (settled)</>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function AttemptsPanel({ attempts }: { attempts: Attempt[] }) {
  if (attempts.length === 0) return null;
  return (
    <section className="panel ui-paper">
      <h2>Evaluation attempts</h2>
      <p>
        At most three are allowed and every one is recorded, successful or not. Only one result is
        ever accepted.
      </p>
      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">Attempt</th>
              <th scope="col">Started</th>
              <th scope="col">Outcome</th>
            </tr>
          </thead>
          <tbody>
            {attempts.map((attempt) => {
              const name = attemptOutcomeName(attempt.outcome);
              const reason = attemptFailureReason(attempt.outcome);
              return (
                <tr key={attempt.n}>
                  <td>{attempt.n}</td>
                  <td title={formatUtc(attempt.started_at_ns)}>
                    {formatRelative(attempt.started_at_ns)}
                  </td>
                  <td>
                    <Badge
                      tone={name === "Accepted" ? "success" : name === "Failed" ? "danger" : "violet"}
                    >
                      {name}
                    </Badge>
                    {reason && <span className="cell-sub">Refused: {reason}</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default async function TenderPage({ params }: PageProps) {
  const { id } = await params;
  const tenderId = parseId(id);
  if (tenderId === null) notFound();

  let detail: Awaited<ReturnType<typeof getTenderDetail>> = null;
  let attempts: Attempt[] = [];
  let error: string | null = null;
  try {
    [detail, attempts] = await Promise.all([getTenderDetail(tenderId), getAttempts(tenderId)]);
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  if (error) {
    return (
      <div className="page-error" role="alert">
        <h2>The chain could not be read</h2>
        <p>{error}</p>
      </div>
    );
  }
  if (!detail) notFound();

  const { tender, bids, result } = detail;
  const { rubric } = parseRubric(tender.rubric_json);
  const status = statusOf(tender.status);
  const compact = parseResult(result);
  const ranked = rankedBids(compact, bids, tender.frozen?.slots ?? null, tender.award);

  return (
    <>
      <div className="page-head-row">
        <div className="page-head">
          <span className="page-eyebrow">
            <span className="ui-reference">Tender {tender.id}</span>
            <Badge tone={status.tone}>{status.label}</Badge>
          </span>
          <h1>{tenderTitle(rubric, tender.id)}</h1>
          <p>{status.detail}</p>
        </div>
        {canBid(tender) && (
          <div className="page-head-actions">
            <Link
              className="ui-button ui-button--primary ui-button--medium"
              href={`/tenders/${tender.id}/bid`}
            >
              Submit a sealed bid
            </Link>
          </div>
        )}
      </div>

      <dl className="stat-row ui-paper">
        <div className="stat">
          <dt>Budget cap</dt>
          <dd>
            {formatUnits(tender.budget_cap, TOKEN_DECIMALS)} <small>{TOKEN_SYMBOL}</small>
          </dd>
        </div>
        <div className="stat">
          <dt>Escrowed</dt>
          <dd>
            {formatUnits(tender.escrowed, TOKEN_DECIMALS)} <small>{TOKEN_SYMBOL}</small>
          </dd>
        </div>
        <div className="stat">
          <dt>Bond per bid</dt>
          <dd>
            {formatNear(tender.bond)} <small>NEAR</small>
          </dd>
        </div>
        <div className="stat">
          <dt>Sealed bids</dt>
          <dd>{tender.active_slots.length}</dd>
        </div>
        <div className="stat">
          <dt>{hasPassed(tender.deadline_ns) ? "Closed" : "Closes"}</dt>
          <dd title={formatUtc(tender.deadline_ns)}>
            <small>{formatRelative(tender.deadline_ns)}</small>
          </dd>
        </div>
      </dl>

      <div className="tender-columns">
        <div>
          {compact && ranked.length > 0 && (
            <section className="panel ui-paper">
              <h2>Result</h2>
              <p>
                Scored once by the pinned evaluator inside the TEE, on attempt {compact.attempt}.
                Price and the ranking are code. The committee decides the award.
              </p>
              <RankingTable
                rows={rankingRows(ranked)}
                caption={`Totals in basis points from the accepted on-chain result for tender ${tender.id}.`}
              />
              <p className="panel-note">
                Model scores are not reproducible between runs. What is recorded is this run,
                signed and checkable from the stored bytes.
              </p>
            </section>
          )}

          <RubricPanel rubricJson={tender.rubric_json} />
          <BidsPanel tender={tender} bids={bids} />
          <AttemptsPanel attempts={attempts} />
        </div>

        <div>
          <section className="panel ui-paper">
            <h2>Progress</h2>
            <Lifecycle
              layout="vertical"
              steps={lifecycleSteps({
                status: tender.status,
                deadline_ns: tender.deadline_ns,
                bidCount: tender.active_slots.length,
                attempts,
                award: tender.award,
                hasKey: tender.tender_pubkey !== null,
                escrowed: tender.escrowed,
              })}
            />
          </section>

          <section className="panel ui-paper">
            <h2>What is recorded</h2>
            <dl className="facts">
              <dt>Buyer</dt>
              <dd>
                <a
                  className="inline-link"
                  href={explorerAccount(tender.buyer)}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  {tender.buyer}
                </a>
              </dd>
              <dt>Deadline</dt>
              <dd>{formatUtc(tender.deadline_ns)}</dd>
              <dt>Rubric hash</dt>
              <dd>
                <Hash value={tender.rubric_hash} label="Copy rubric hash" />
              </dd>
              {tender.tender_pubkey && (
                <>
                  <dt>Tender key</dt>
                  <dd>
                    <Hash value={tender.tender_pubkey} label="Copy tender key" />
                  </dd>
                </>
              )}
              {tender.frozen && (
                <>
                  <dt>Bid set root</dt>
                  <dd>
                    <Hash value={tender.frozen.root} label="Copy Merkle root" />
                  </dd>
                </>
              )}
              {compact && (
                <>
                  <dt>Evidence bundle</dt>
                  <dd>
                    <Hash value={compact.bundle} label="Copy bundle hash" />
                  </dd>
                </>
              )}
              <dt>Evaluator build</dt>
              <dd>
                <Hash value={tender.evaluator.wasm_sha256} label="Copy evaluator hash" />
              </dd>
              <dt>Committee</dt>
              <dd>
                {tender.committee.map((member) => member.account).join(", ")} (
                {tender.approvals_required} approval
                {tender.approvals_required === 1 ? "" : "s"} needed)
              </dd>
            </dl>
            <p className="panel-note">
              Everything here was fixed when the tender was created and cannot be changed by
              anyone, including the buyer.
            </p>
          </section>
        </div>
      </div>
    </>
  );
}
