import Link from "next/link";
import { ATTACKS, attackTransactionUrl, attackRequestUrl } from "../../config/attacks.ts";
import { AttackReplay } from "../../components/app/attack-replay.tsx";
import { Badge } from "../../components/ui/badge.tsx";

export const metadata = { title: "Recorded attack attempts" };

export default function AttacksPage() {
  return <>
    <nav className="breadcrumbs" aria-label="Breadcrumb"><Link href="/tenders">Tenders</Link><span>Attack evidence</span></nav>
    <div className="page-head"><span className="page-eyebrow">Recorded on testnet</span>
      <h1>Try to break the process.</h1>
      <p>{ATTACKS.records.length} measured attempts against a dedicated tender. Follow each transaction to inspect what was refused and which check enforced it.</p>
    </div>
    <dl className="stat-row ui-paper">
      <div className="stat"><dt>Recorded attempts</dt><dd>{ATTACKS.records.length}</dd></div>
      <div className="stat"><dt>Network</dt><dd>{ATTACKS.network}</dd></div>
      <div className="stat"><dt>Tender</dt><dd><Link href={`/tenders/${ATTACKS.tender_id}`}>#{ATTACKS.tender_id}</Link></dd></div>
      <div className="stat"><dt>Recorded</dt><dd>{ATTACKS.recorded_at.slice(0, 10)}</dd></div>
    </dl>
    <p className="attack-context">These are recorded outcomes on {ATTACKS.contract_id}. A prompt-injection flag asks the committee to review the text; it does not prove that every model resisted it. The contract and secret-row owner accounts remain unlocked pending the final deployment.</p>
    <ol className="attack-records" aria-label="Recorded attack attempts">
      {ATTACKS.records.map((record) => <li key={record.id} className="panel ui-paper" value={record.id}>
        <div className="attack-record-heading"><span className="ui-reference">Attempt {String(record.id).padStart(2, "0")}</span>
          <Badge tone={record.layer === "evaluator" ? "warning" : "success"}>{record.layer === "evaluator" ? "Flagged for review" : "Refused"}</Badge></div>
        <h2>{record.title}</h2><p>{record.detail}</p>
        <dl className="attack-facts"><div><dt>Observed outcome</dt><dd><code>{record.outcome}</code></dd></div>
          <div><dt>Enforced by</dt><dd>{record.layer === "runtime" ? "NEAR contract runtime" : record.layer === "outlayer" ? "OutLayer secret access" : record.layer === "evaluator" ? "Evaluator code" : "Tender contract"}</dd></div>
          <div><dt>Signed by</dt><dd className="mono">{record.signer}</dd></div></dl>
        <div className="attack-links"><a className="inline-link" href={attackTransactionUrl(record.tx_hash)} target="_blank" rel="noreferrer">Inspect transaction <span className="mono">{record.tx_hash.slice(0, 8)}</span></a>
          {record.request_id && (record.layer === "outlayer"
            ? <span>OutLayer request {record.request_id}. Refusal in transaction receipts.</span>
            : <a className="inline-link" href={attackRequestUrl(record.request_id)} target="_blank" rel="noreferrer">OutLayer request {record.request_id}</a>)}</div>
      </li>)}
    </ol>
    <section className="panel ui-paper"><h2>What this run establishes</h2>
      <p>The required caller, time, ciphertext, committee and winner checks rejected these calls. Model judgments can vary. An injection flag does not make a bid ineligible or lower its score. The committee must review the text before deciding.</p>
      <p>Attempt 2, a different evaluator build, is covered by the earlier gate evidence and was not rerun here. These outcomes do not cover collusion, false claims, a biased rubric or compromised owner keys.</p>
      <Link className="inline-link" href={`/tenders/${ATTACKS.tender_id}/verify`}>Check the tender evidence</Link>
    </section>
    <AttackReplay records={ATTACKS.records} />
  </>;
}
